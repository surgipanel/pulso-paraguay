// Construcción y actualización de la edición del día: fusiona lo nuevo con lo ya publicado,
// no duplica acontecimientos y respeta el máximo diario.
import { MAX_EVENTS_PER_DAY, MAX_PER_CATEGORY, TIMEZONE } from "./config.mjs";
import { eventId } from "./summarize.mjs";
import { fold, tokens } from "./text.mjs";

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function sameEvent(existing, candidate) {
  const urls = new Set(existing.sources.map((s) => s.url));
  if (candidate.sources.some((s) => urls.has(s.url))) return true;
  // Sin URL en común: títulos muy parecidos (p. ej. la IA reescribió el mismo hecho).
  const t = jaccard(tokens(existing.title), tokens(candidate.title));
  const s = jaccard(tokens(existing.summary), tokens(candidate.summary));
  return t >= 0.5 || (t >= 0.34 && s >= 0.3);
}

function mergeSources(a, b) {
  const map = new Map();
  for (const s of [...a, ...b]) if (!map.has(s.url)) map.set(s.url, s);
  return [...map.values()].sort((x, y) => new Date(y.publishedAt) - new Date(x.publishedAt));
}

function scoreEvent(ev, now) {
  const distinct = new Set(ev.sources.map((s) => s.sourceId)).size;
  const newest = Math.max(...ev.sources.map((s) => new Date(s.publishedAt).getTime()));
  const ageH = (now.getTime() - newest) / 36e5;
  const recency = Math.max(0, 2 - ageH / 12);
  const scopePenalty = ev.scope === "internacional" ? -2.5 : 0;
  return distinct * 3 + Math.min(ev.sources.length, 4) + recency + scopePenalty;
}

// candidates: eventos producidos en esta corrida, ya con `sources` resueltas.
export function mergeEdition({ existing, candidates, date, slot, now, aiMode, model }) {
  const events = existing ? existing.events.map((e) => ({ ...e })) : [];
  let added = 0, updated = 0, skipped = 0;
  const nowIso = now.toISOString();

  const fresh = [];
  for (const cand of candidates) {
    const match = events.find((e) => sameEvent(e, cand));
    if (match) {
      const merged = mergeSources(match.sources, cand.sources);
      const grew = merged.length > match.sources.length;
      if (grew) {
        // Hay cobertura nueva: se usa la redacción generada con todas las notas.
        match.title = cand.title;
        match.summary = cand.summary;
        match.keyPoints = cand.keyPoints;
        match.category = cand.category;
        match.scope = cand.scope ?? match.scope;
        match.summaryKind = cand.summaryKind;
        match.model = cand.model;
        match.sources = merged;
        match.image = cand.image ?? match.image ?? null;
        match.updatedAt = nowIso;
        match.updatedSlot = slot;
        updated += 1;
      } else {
        skipped += 1;
      }
    } else {
      fresh.push(cand);
    }
  }

  // Lugar disponible hoy: máximo diario menos lo ya publicado.
  const room = Math.max(0, MAX_EVENTS_PER_DAY - events.length);
  fresh.sort((a, b) => scoreEvent(b, now) - scoreEvent(a, now));
  const perCategory = new Map();
  for (const e of events) perCategory.set(e.category, (perCategory.get(e.category) ?? 0) + 1);
  const chosen = [];
  const deferred = [];
  for (const cand of fresh) {
    if (chosen.length >= room) break;
    const n = perCategory.get(cand.category) ?? 0;
    if (n >= MAX_PER_CATEGORY) {
      deferred.push(cand);
      continue;
    }
    perCategory.set(cand.category, n + 1);
    chosen.push(cand);
  }
  // Si sobró lugar, entran los diferidos por categoría llena.
  for (const cand of deferred) {
    if (chosen.length >= room) break;
    chosen.push(cand);
  }

  for (const cand of chosen) {
    events.push({
      id: eventId(cand),
      title: cand.title,
      summary: cand.summary,
      keyPoints: cand.keyPoints,
      category: cand.category,
      scope: cand.scope ?? "paraguay",
      summaryKind: cand.summaryKind,
      model: cand.model,
      sources: cand.sources,
      image: cand.image ?? null,
      firstSeenAt: nowIso,
      firstSlot: slot,
      updatedAt: nowIso,
      updatedSlot: slot,
    });
    added += 1;
  }

  for (const e of events) e.score = Number(scoreEvent(e, now).toFixed(2));
  events.sort((a, b) => b.score - a.score);

  const runs = [...(existing?.runs ?? []), { slot, at: nowIso, added, updated, candidates: candidates.length }];
  return {
    edition: {
      date,
      timezone: TIMEZONE,
      generatedAt: nowIso,
      aiMode,
      model: aiMode === "ia" ? model : null,
      maxEvents: MAX_EVENTS_PER_DAY,
      events,
      runs,
    },
    added,
    updated,
    skipped,
    notPublished: fresh.length - chosen.length,
  };
}

export function categoryLabelMap(categories) {
  return Object.fromEntries(categories.map((c) => [c.id, c.label]));
}

export const _test = { sameEvent, jaccard, fold };
