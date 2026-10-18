// Construcción y actualización de la edición del día: fusiona lo nuevo con lo ya publicado,
// no duplica acontecimientos y respeta el máximo diario.
import { EDITION_MIN_PER_CATEGORY, MAX_EVENTS_PER_DAY, MAX_PER_CATEGORY, TIMEZONE } from "./config.mjs";
import { eventId } from "./summarize.mjs";
import { fold, nameTokens, tokens } from "./text.mjs";

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
  if (t >= 0.5 || (t >= 0.34 && s >= 0.3)) return true;
  // Mismo protagonista, misma sección y resúmenes parecidos: el mismo hecho contado con otras
  // palabras (p. ej. "Vicesecretario … Landau visita Paraguay" y "Subsecretario Landau llega a
  // Paraguay"). Calibrado con las ediciones reales: hechos distintos pero cercanos (la crecida en
  // Ayolas y en Cerrito) quedan por debajo.
  if (existing.category !== candidate.category) return false;
  const a = nameTokens(existing.title);
  const shared = [...nameTokens(candidate.title)].some((x) => x.length >= 5 && a.has(x));
  return shared && s >= 0.18;
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
  // Un aviso de servicio que ya venció baja al fondo (no se muestra como vigente).
  const expiredPenalty = ev.expiresAt && new Date(ev.expiresAt) < now ? -6 : 0;
  return distinct * 3 + Math.min(ev.sources.length, 4) + recency + scopePenalty + expiredPenalty;
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
        match.expiresAt = cand.expiresAt ?? match.expiresAt ?? null;
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
      // También puede repetirse dentro de esta misma corrida (dos grupos del mismo hecho).
      const twin = fresh.find((f) => sameEvent(f, cand));
      if (twin) {
        const merged = mergeSources(twin.sources, cand.sources);
        if (cand.sources.length > twin.sources.length) Object.assign(twin, { ...cand, sources: merged });
        else twin.sources = merged;
        skipped += 1;
      } else {
        fresh.push(cand);
      }
    }
  }

  // Lugar disponible hoy: máximo diario menos lo ya publicado.
  const room = Math.max(0, MAX_EVENTS_PER_DAY - events.length);
  fresh.sort((a, b) => scoreEvent(b, now) - scoreEvent(a, now));
  const perCategory = new Map();
  for (const e of events) perCategory.set(e.category, (perCategory.get(e.category) ?? 0) + 1);
  const chosen = [];
  const chosenSet = new Set();
  const deferred = [];
  const take = (cand) => {
    chosen.push(cand);
    chosenSet.add(cand);
    perCategory.set(cand.category, (perCategory.get(cand.category) ?? 0) + 1);
  };
  // 1) Reserva: cada sección hasta su mínimo, para que ninguna quede vacía.
  for (const cand of fresh) {
    if (chosen.length >= room) break;
    if ((perCategory.get(cand.category) ?? 0) < EDITION_MIN_PER_CATEGORY) take(cand);
  }
  // 2) El resto por relevancia, con tope por sección.
  for (const cand of fresh) {
    if (chosen.length >= room) break;
    if (chosenSet.has(cand)) continue;
    if ((perCategory.get(cand.category) ?? 0) >= MAX_PER_CATEGORY) {
      deferred.push(cand);
      continue;
    }
    take(cand);
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
      expiresAt: cand.expiresAt ?? null,
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
