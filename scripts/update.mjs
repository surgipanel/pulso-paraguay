#!/usr/bin/env node
// Corrida editorial completa: medios → artículos del día → agrupación → redacción → edición → archivos JSON.
// Uso: node scripts/update.mjs [--force] [--check-sources] [--dry-run]
import { AI_MODEL, DUPLICATE_RUN_GUARD_HOURS, MAX_CLUSTERS_TO_AI, MAX_EVENTS_PER_DAY, SELECT_MIN_PER_CATEGORY, TIMEZONE } from "../src/config.mjs";
import { SOURCES } from "../src/sources.mjs";
import { fetchAllSources, probeImage } from "../src/fetch.mjs";
import { clusterCategory } from "../src/heuristics.mjs";
import { clusterArticles, scoreCluster } from "../src/cluster.mjs";
import { resolveAiMode, summarizeClusters } from "../src/summarize.mjs";
import { mergeEdition } from "../src/edition.mjs";
import {
  appendRun, readEdition, readLatest, readRuns, rebuildEditionIndex, writeEdition, writeLatest, writeSources,
} from "../src/store.mjs";
import { asuncionDate, hoursBetween, slotFor } from "../src/text.mjs";

const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const CHECK_ONLY = args.has("--check-sources");
const DRY_RUN = args.has("--dry-run");

const log = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
};

// Foto referencial del acontecimiento: la de la nota cuyo título coincide con el del evento
// (modo extractivo) o, si no, la más reciente que tenga imagen. Siempre con crédito al medio.
// Cada foto se verifica antes de publicarla; si no carga, se prueba la de otra nota del mismo hecho.
async function pickImage(d) {
  const withImg = d.sources.filter((s) => s.image);
  const main = withImg.find((s) => s.title === d.title);
  const ordered = main ? [main, ...withImg.filter((s) => s !== main)] : withImg;
  for (const s of ordered.slice(0, 4)) {
    const url = await probeImage(s.image);
    if (url) return { url, credit: s.sourceName, articleUrl: s.url };
  }
  return null;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

// Elige qué grupos se redactan: primero asegura un mínimo por sección (cultura o tecnología
// rara vez son lo más cubierto y quedarían afuera), después completa por relevancia.
function selectClusters(sorted, limit, existingEvents) {
  const per = new Map();
  for (const e of existingEvents) per.set(e.category, (per.get(e.category) ?? 0) + 1);
  const picked = new Set();
  for (const c of sorted) {
    if (picked.size >= limit) break;
    const cat = clusterCategory(c);
    if ((per.get(cat) ?? 0) < SELECT_MIN_PER_CATEGORY) {
      picked.add(c);
      per.set(cat, (per.get(cat) ?? 0) + 1);
    }
  }
  for (const c of sorted) {
    if (picked.size >= limit) break;
    picked.add(c);
  }
  return sorted.filter((c) => picked.has(c));
}

function fmtAsu(d) {
  return new Intl.DateTimeFormat("es-PY", { timeZone: TIMEZONE, dateStyle: "short", timeStyle: "short" }).format(d);
}

async function main() {
  const now = new Date();
  const date = asuncionDate(now);
  const slot = slotFor(now);
  const startedAt = now.toISOString();
  const { mode: aiMode, reason: aiReason } = resolveAiMode();

  log.info(`El Prócer · corrida ${slot} · edición ${date} · ${fmtAsu(now)} (${TIMEZONE})`);
  log.info(`Redacción: ${aiMode} (${aiReason})`);

  // Guardia contra corridas duplicadas (p. ej. cron + disparo manual casi al mismo tiempo).
  if (!FORCE && !CHECK_ONLY) {
    const runs = await readRuns();
    const dup = runs.find(
      (r) => r.ok && r.edition === date && r.slot === slot && hoursBetween(new Date(r.finishedAt), now) < DUPLICATE_RUN_GUARD_HOURS,
    );
    if (dup) {
      log.info(`Ya hubo una corrida exitosa del turno "${slot}" a las ${fmtAsu(new Date(dup.finishedAt))}. Se salta (usá --force para repetir).`);
      return 0;
    }
  }

  const run = {
    startedAt, finishedAt: null, edition: date, slot, ok: false, error: null,
    aiMode, model: aiMode === "ia" ? AI_MODEL : null, articles: 0, clusters: 0, candidates: 0,
    added: 0, updated: 0, eventsTotal: null, sourcesOk: 0, sourcesTotal: SOURCES.length, ai: null, forced: FORCE,
  };

  try {
    // 1) Medios
    log.info("\n1) Consultando medios…");
    const { reports, articles: raw } = await fetchAllSources(SOURCES, { now, log });
    for (const r of reports) {
      const tag = { ok: "OK   ", stale: "VIEJO", quiet: "QUIETO", error: "ERROR", unavailable: "N/D  " }[r.status] ?? r.status;
      log.info(`  ${tag} ${r.name.padEnd(22)} notas=${String(r.items).padStart(3)} del día=${String(r.freshItems).padStart(3)} ${r.ms} ms ${r.error ? "· " + r.error : ""}${r.note && r.status !== "ok" ? " · " + r.note : ""}`);
    }
    run.sourcesOk = reports.filter((r) => r.status === "ok").length;
    // Si casi ningún medio respondió, algo está roto (red, bug): no se toca la edición vigente.
    if (run.sourcesOk < 2 && !CHECK_ONLY) throw new Error(`solo ${run.sourcesOk} medio(s) respondieron con notas del día; se conserva la edición anterior`);
    if (!DRY_RUN) await writeSources({ checkedAt: now.toISOString(), timezone: TIMEZONE, sources: reports });
    if (CHECK_ONLY) return 0;

    // 2) Artículos únicos (una misma nota puede venir por dos feeds)
    const byUrl = new Map();
    for (const a of raw) if (!byUrl.has(a.url)) byUrl.set(a.url, a);
    const articles = [...byUrl.values()];
    run.articles = articles.length;
    log.info(`\n2) ${articles.length} notas del día (${raw.length - articles.length} repetidas descartadas)`);
    if (articles.length === 0) throw new Error("ningún medio aportó notas verificables del día");

    // 3) Agrupación
    const existing = await readEdition(date);
    const known = new Set((existing?.events ?? []).flatMap((e) => e.sources.map((s) => s.url)));
    let clusters = clusterArticles(articles, { liberal: aiMode === "ia" });
    run.clusters = clusters.length;
    const withNews = clusters.filter((c) => c.articles.some((a) => !known.has(a.url)));
    withNews.sort((a, b) => scoreCluster(b, now) - scoreCluster(a, now));
    const multi = withNews.filter((c) => c.sourceCount > 1).length;
    log.info(`3) ${clusters.length} grupos; ${withNews.length} con notas nuevas (${multi} con más de un medio)`);
    if (existing) log.info(`   Edición existente: ${existing.events.length} acontecimientos (máximo diario ${MAX_EVENTS_PER_DAY})`);

    // Solo se redacta lo que puede entrar: lo ya publicado que crece + lugar disponible, con margen.
    const room = Math.max(0, MAX_EVENTS_PER_DAY - (existing?.events.length ?? 0));
    const limit = Math.min(MAX_CLUSTERS_TO_AI, room + 12);
    const selected = selectClusters(withNews, limit, existing?.events ?? []);
    run.candidates = selected.length;
    const bySection = {};
    for (const c of selected) bySection[clusterCategory(c)] = (bySection[clusterCategory(c)] ?? 0) + 1;
    log.info(`   Se redactan ${selected.length} grupos (lugar disponible hoy: ${room}) · por sección: ${JSON.stringify(bySection)}`);

    // 4) Redacción
    log.info(`\n4) Redactando (${aiMode})…`);
    const { events: drafts, stats } = await summarizeClusters(selected, { mode: aiMode, log });
    run.ai = stats;
    const articleById = new Map(articles.map((a) => [a.id, a]));
    const candidates = drafts
      .map((d) => ({
        ...d,
        sources: d.articleIds
          .map((id) => articleById.get(id))
          .filter(Boolean)
          .map((a) => ({ sourceId: a.sourceId, sourceName: a.sourceName, title: a.title, url: a.url, publishedAt: a.publishedAt, image: a.image ?? null })),
      }))
      .filter((d) => d.sources.length > 0);
    await mapLimit(candidates, 8, async (d) => { d.image = await pickImage(d); });
    log.info(`   ${candidates.length} acontecimientos redactados${stats.aiErrors.length ? ` · ${stats.aiErrors.length} lotes cayeron a modo extractivo` : ""}`);

    // 5) Edición
    const effectiveMode = stats.fallbacks > 0 && aiMode === "ia" ? (stats.fallbacks === selected.length ? "extractivo" : "mixto") : aiMode;
    const result = mergeEdition({ existing, candidates, date, slot, now, aiMode: effectiveMode, model: AI_MODEL });
    run.added = result.added;
    run.updated = result.updated;
    run.eventsTotal = result.edition.events.length;
    log.info(`\n5) Edición ${date}: ${result.edition.events.length} acontecimientos (+${result.added} nuevos, ${result.updated} actualizados, ${result.skipped} sin cambios, ${result.notPublished} quedaron fuera por el máximo diario)`);
    for (const e of result.edition.events) {
      const n = new Set(e.sources.map((s) => s.sourceId)).size;
      log.info(`   [${e.category.padEnd(10)}] ${e.title}  (${n} ${n === 1 ? "medio" : "medios"})`);
    }

    if (DRY_RUN) {
      log.info("\n--dry-run: no se escribió nada.");
      return 0;
    }

    run.finishedAt = new Date().toISOString();
    run.ok = true;
    await writeEdition(result.edition);
    const index = await rebuildEditionIndex();
    await writeLatest({
      editionDate: date,
      timezone: TIMEZONE,
      generatedAt: result.edition.generatedAt,
      eventsCount: result.edition.events.length,
      maxEvents: MAX_EVENTS_PER_DAY,
      aiMode: effectiveMode,
      model: effectiveMode === "extractivo" ? null : AI_MODEL,
      ok: true,
      message: null,
      lastSuccessAt: run.finishedAt,
      lastRun: run,
      editions: index.length,
    });
    await appendRun(run);
    log.info(`\nListo. Archivos escritos en docs/data (${fmtAsu(new Date())}).`);
    return 0;
  } catch (err) {
    run.finishedAt = new Date().toISOString();
    run.error = err.message;
    log.warn(`\nERROR: ${err.stack ?? err.message}`);
    if (!DRY_RUN && !CHECK_ONLY) {
      // Conservar la última edición válida y dejar constancia del fallo.
      const prev = await readLatest();
      await writeLatest({
        ...(prev ?? { editionDate: null, generatedAt: null, eventsCount: 0, timezone: TIMEZONE, lastSuccessAt: null }),
        ok: false,
        message: `La actualización de las ${fmtAsu(now)} falló: ${err.message}`,
        lastRun: run,
      });
      await appendRun(run);
    }
    return 1;
  }
}

process.exitCode = await main();
