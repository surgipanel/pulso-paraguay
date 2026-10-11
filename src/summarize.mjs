// Redacción de título, resumen y puntos clave por acontecimiento.
// Dos modos: "ia" (Claude, vía @anthropic-ai/sdk) y "extractivo" (sin IA: extractos del medio).
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  AI_MODE, AI_MODEL, CATEGORIES, CATEGORY_IDS, CLUSTERS_PER_AI_CALL, SUMMARY_MAX_WORDS, SUMMARY_MIN_WORDS,
} from "./config.mjs";
import { fold, sentences, shortId, tokens, truncateWords, wordCount } from "./text.mjs";
import { categoryHint, majority, scopeHint } from "./heuristics.mjs";

// ---------- Modo ----------

export function resolveAiMode(env = process.env) {
  if (AI_MODE === "off") return { mode: "extractivo", reason: "PULSO_AI_MODE=off" };
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) {
    return { mode: "extractivo", reason: "sin ANTHROPIC_API_KEY en el entorno" };
  }
  return { mode: "ia", reason: `modelo ${AI_MODEL}` };
}

// ---------- Modo extractivo (sin IA) ----------

export function extractiveEvent(cluster) {
  // Nota principal: la más "central" (su título comparte más palabras con los demás títulos);
  // empate → la de extracto más largo. Evita que una reacción lateral encabece el hecho.
  const titleTokens = cluster.articles.map((a) => new Set(tokens(a.title)));
  const centrality = (i) => {
    let s = 0;
    titleTokens.forEach((set, j) => {
      if (i === j) return;
      let inter = 0;
      for (const t of titleTokens[i]) if (set.has(t)) inter++;
      s += inter / (titleTokens[i].size + set.size - inter || 1);
    });
    return s;
  };
  const arts = cluster.articles
    .map((a, i) => ({ a, c: centrality(i) }))
    .sort((x, y) => y.c - x.c || (y.a.excerpt?.length ?? 0) - (x.a.excerpt?.length ?? 0))
    .map((x) => x.a);
  const main = arts[0];
  const pool = arts.filter((a) => a.excerpt).flatMap((a) => sentences(a.excerpt));
  const summaryParts = [];
  let count = 0;
  for (const s of pool) {
    if (count >= SUMMARY_MIN_WORDS) break;
    summaryParts.push(s);
    count += wordCount(s);
  }
  let summary = summaryParts.join(" ");
  if (wordCount(summary) > SUMMARY_MAX_WORDS) summary = truncateWords(summary, SUMMARY_MAX_WORDS);
  if (!summary) summary = `Sin extracto disponible del medio. Consultá la nota original: ${main.title}`;

  const keyPoints = [];
  const seen = new Set();
  for (const a of arts) {
    const first = sentences(a.excerpt ?? "")[0];
    const k = first ? fold(first).slice(0, 60) : null;
    if (first && !seen.has(k)) {
      seen.add(k);
      keyPoints.push(truncateWords(first, 36));
    }
    if (keyPoints.length >= 4) break;
  }
  if (!keyPoints.length) keyPoints.push(main.title);

  return {
    clusterId: cluster.id,
    articleIds: cluster.articles.map((a) => a.id),
    title: main.title,
    summary,
    keyPoints,
    category: majority(cluster.articles.map(categoryHint), "pais"),
    scope: majority(cluster.articles.map(scopeHint), "paraguay"),
    summaryKind: "extractivo",
    model: null,
  };
}

// ---------- Modo IA ----------

const EventSchema = z.object({
  cluster_id: z.string(),
  article_ids: z.array(z.string()),
  title: z.string(),
  summary: z.string(),
  key_points: z.array(z.string()),
  category: z.enum(CATEGORY_IDS),
  scope: z.enum(["paraguay", "internacional"]),
});
const OutputSchema = z.object({ events: z.array(EventSchema) });

const SYSTEM_PROMPT = `Sos el editor de Pulso Paraguay, un diario digital que agrupa la cobertura de los medios paraguayos en acontecimientos y los explica con texto propio.

Recibís grupos candidatos de notas (cada grupo trae notas de uno o más medios que probablemente cubren el mismo hecho). Para cada grupo devolvés uno o más acontecimientos.

Reglas editoriales (obligatorias):
1. Un acontecimiento = un hecho concreto. Si un grupo mezcla hechos distintos (aunque sean del mismo tema), dividilo en varios acontecimientos y asigná cada nota al que corresponde. No fusiones hechos distintos. No dejes notas sin asignar salvo que no sean noticia (publicidad, horóscopo, etc.); en ese caso omitilas.
2. Usá SOLO la información que aparece en los títulos y extractos recibidos. No inventes datos, cifras, nombres ni contexto. Si los extractos son escasos, el resumen es más corto y general, nunca inventado.
3. Título propio: claro, informativo, en español de Paraguay, máximo 14 palabras, sin mayúsculas sostenidas ni signos de exclamación. No copies el título de ningún medio.
4. Resumen propio: entre ${SUMMARY_MIN_WORDS} y ${SUMMARY_MAX_WORDS} palabras, un solo párrafo, redacción neutra. No copies frases enteras de las notas.
5. Puntos clave: entre 2 y 4, una oración corta cada uno, hechos verificables en los extractos.
6. Atribuí siempre denuncias, acusaciones y versiones ("según la Fiscalía", "denunció el senador X", "de acuerdo con ABC Color"). Nunca presentes una acusación como hecho probado.
7. Distinguí con precisión: un proyecto de ley no es una ley; media sanción no es sanción; una imputación no es una condena; un anuncio no es una ejecución.
8. Categoría: una de ${CATEGORIES.map((c) => `${c.id} (${c.label})`).join(", ")}. "pais" cubre sociedad, sucesos, salud, educación, interior y temas internacionales con impacto local.
9. scope: "paraguay" si el hecho ocurre en Paraguay o involucra directamente al país; "internacional" si no.

Devolvé únicamente JSON con el formato pedido.`;

function clusterPayload(cluster) {
  return {
    cluster_id: cluster.id,
    notas: cluster.articles.map((a) => ({
      id: a.id,
      medio: a.sourceName,
      titulo: a.title,
      extracto: a.excerpt || "(el medio no provee extracto)",
      fecha: a.publishedAt,
    })),
  };
}

function validateEvents(parsed, clusters) {
  const byCluster = new Map(clusters.map((c) => [c.id, c]));
  const validIds = new Map(clusters.flatMap((c) => c.articles.map((a) => [a.id, c.id])));
  const problems = [];
  const events = [];
  for (const ev of parsed.events ?? []) {
    const cluster = byCluster.get(ev.cluster_id);
    const ids = [...new Set(ev.article_ids)].filter((id) => validIds.has(id));
    if (!cluster || ids.length === 0) {
      problems.push(`evento "${ev.title}" sin notas válidas`);
      continue;
    }
    const wc = wordCount(ev.summary);
    if (wc < SUMMARY_MIN_WORDS - 5 || wc > SUMMARY_MAX_WORDS + 8) {
      problems.push(`resumen de "${ev.title}" tiene ${wc} palabras (pedido: ${SUMMARY_MIN_WORDS}-${SUMMARY_MAX_WORDS})`);
    }
    const keyPoints = ev.key_points.map((k) => k.trim()).filter(Boolean).slice(0, 4);
    if (keyPoints.length < 1) {
      problems.push(`"${ev.title}" sin puntos clave`);
      continue;
    }
    events.push({
      clusterId: cluster.id,
      articleIds: ids,
      title: ev.title.trim(),
      summary: ev.summary.trim(),
      keyPoints,
      category: ev.category,
      scope: ev.scope,
      summaryKind: "ia",
      model: AI_MODEL,
    });
  }
  return { events, problems };
}

async function summarizeBatch(client, clusters, log) {
  const payload = JSON.stringify({ grupos: clusters.map(clusterPayload) }, null, 1);
  const messages = [{ role: "user", content: `Grupos candidatos:\n${payload}` }];
  let best = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: 12000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { format: zodOutputFormat(OutputSchema), effort: "low" },
    });
    if (response.stop_reason === "refusal") {
      throw new Error(`el modelo rechazó el lote (${response.stop_details?.category ?? "sin categoría"})`);
    }
    if (!response.parsed_output) throw new Error("respuesta sin JSON válido");
    const { events, problems } = validateEvents(response.parsed_output, clusters);
    const usage = response.usage;
    log.info?.(`  IA lote: ${events.length} eventos, ${problems.length} observaciones, tokens in=${usage.input_tokens} out=${usage.output_tokens} cache=${usage.cache_read_input_tokens ?? 0}`);
    best = { events, problems, usage };
    if (problems.length === 0 || attempt === 1) break;
    // Un único reintento con las observaciones concretas.
    messages.push(
      { role: "assistant", content: JSON.stringify(response.parsed_output) },
      { role: "user", content: `Corregí estos problemas y devolvé el JSON completo de nuevo:\n- ${problems.join("\n- ")}` },
    );
  }
  return best;
}

export async function summarizeClusters(clusters, { mode, log = console } = {}) {
  const stats = { mode, aiCalls: 0, aiErrors: [], inputTokens: 0, outputTokens: 0, fallbacks: 0 };
  if (mode !== "ia") {
    return { events: clusters.map(extractiveEvent), stats };
  }
  const client = new Anthropic({ maxRetries: 2, timeout: 180_000 });
  const events = [];
  for (let i = 0; i < clusters.length; i += CLUSTERS_PER_AI_CALL) {
    const batch = clusters.slice(i, i + CLUSTERS_PER_AI_CALL);
    try {
      const result = await summarizeBatch(client, batch, log);
      stats.aiCalls += 1;
      stats.inputTokens += result.usage.input_tokens ?? 0;
      stats.outputTokens += result.usage.output_tokens ?? 0;
      events.push(...result.events);
      // Grupos que la IA no cubrió → extractivo, para no perder el hecho.
      const covered = new Set(result.events.map((e) => e.clusterId));
      for (const c of batch) {
        if (!covered.has(c.id)) {
          stats.fallbacks += 1;
          events.push(extractiveEvent(c));
        }
      }
    } catch (err) {
      const msg = err instanceof Anthropic.APIError ? `API ${err.status}: ${err.message}` : err.message;
      stats.aiErrors.push(msg);
      log.warn?.(`  IA falló en un lote (${msg}); se usa modo extractivo para ${batch.length} grupos`);
      for (const c of batch) {
        stats.fallbacks += 1;
        events.push(extractiveEvent(c));
      }
    }
  }
  return { events, stats };
}

export function eventId(event) {
  // Id estable a partir de la primera URL (ordenadas) del acontecimiento.
  const urls = event.sources.map((s) => s.url).sort();
  return "ev-" + shortId(urls[0] ?? event.title);
}
