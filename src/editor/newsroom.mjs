// Lo que hace el panel de editor: buscar en internet, preparar un borrador y mandarlo a publicar.
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL } from "../config.mjs";
import { eventId, resolveAiMode, summarizeClusters } from "../summarize.mjs";
import { publicError } from "./auth.mjs";
import { genericImageKeys, readArticle } from "./article.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "surgipanel/pulso-paraguay";
const SITE = "https://elprocer.com.py";
// Haiku admite la versión básica de la herramienta; la otra queda de respaldo.
const SEARCH_TOOLS = ["web_search_20250305", "web_search_20260209"];

function searchResults(message) {
  const found = new Map();
  let failure = null;
  for (const block of message.content) {
    if (block.type !== "web_search_tool_result") continue;
    if (!Array.isArray(block.content)) {
      failure = block.content?.error_code ?? "error";
      continue;
    }
    for (const r of block.content) {
      if (r.type === "web_search_result" && r.url && !found.has(r.url)) {
        found.set(r.url, { url: r.url, title: r.title ?? r.url, age: r.page_age ?? null, host: new URL(r.url).hostname.replace(/^www\./, "") });
      }
    }
  }
  return { results: [...found.values()].filter((r) => !r.host.endsWith("elprocer.com.py")), failure };
}

export async function searchNews(query) {
  if (!process.env.ANTHROPIC_API_KEY) throw publicError(503, "Falta configurar la clave de Anthropic en el panel");
  const client = new Anthropic({ maxRetries: 1, timeout: 45_000 });
  const today = new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", dateStyle: "long" }).format(new Date());
  const request = (type) => client.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    // La herramienta no admite el código de país PY: Paraguay se prioriza en la instrucción.
    tools: [{ type, name: "web_search", max_uses: 2, user_location: { type: "approximate", timezone: "America/Asuncion" } }],
    messages: [{
      role: "user",
      content: `Hoy es ${today}. Buscá en internet notas periodísticas recientes sobre el tema indicado entre las etiquetas. El lector está en Paraguay: priorizá medios serios, y primero los paraguayos (abc.com.py, lanacion.com.py, ultimahora.com, hoy.com.py) salvo que el tema sea claramente de otro país. Respondé solo "listo".\n<tema>${query}</tema>`,
    }],
  });
  let message;
  for (const type of SEARCH_TOOLS) {
    try {
      message = await request(type);
      break;
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError) || type === SEARCH_TOOLS.at(-1)) {
        console.error("Búsqueda falló:", err.message);
        throw publicError(502, "La búsqueda no funcionó en este momento. Probá de nuevo o pegá el enlace de la nota.");
      }
      console.warn(`Búsqueda: ${type} rechazada (${err.message}); se prueba la siguiente`);
    }
  }
  const { results, failure } = searchResults(message);
  if (!results.length && failure) throw publicError(502, `La búsqueda falló (${failure}). Probá de nuevo o pegá el enlace de la nota.`);
  return results.slice(0, 15);
}

export async function makeDraft(urls) {
  if (resolveAiMode().mode !== "ia") throw publicError(503, "Falta configurar la clave de Anthropic en el panel");
  const generic = await genericImageKeys();
  const settled = await Promise.allSettled(urls.map((u) => readArticle(u, generic)));
  const articles = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const failed = urls.filter((_, i) => settled[i].status === "rejected");
  if (!articles.length) throw publicError(422, "No se pudo leer ninguna de las notas elegidas. Algunos sitios bloquean la lectura automática: probá con otra.");

  const nowIso = new Date().toISOString();
  const forAi = articles.map((a) => ({ ...a, publishedAt: a.publishedAt ?? nowIso }));
  const cluster = { id: "editor", articles: forAi, sourceCount: new Set(forAi.map((a) => a.sourceId)).size };
  const { events } = await summarizeClusters([cluster], { mode: "ia" });
  // Si el redactor vio más de un hecho, se usa el que reúne más notas; el editor decide el resto.
  const main = [...events].sort((a, b) => b.articleIds.length - a.articleIds.length)[0];
  const used = new Set(main.articleIds);
  const chosen = articles.filter((a) => used.has(a.id));
  const leftOut = articles.filter((a) => !used.has(a.id));

  const warnings = [];
  if (failed.length) warnings.push(`No se pudieron leer ${failed.length} de las notas elegidas.`);
  if (events.length > 1) warnings.push(`El redactor detectó ${events.length} hechos distintos y usó el principal. Quedaron afuera ${leftOut.length} notas.`);
  if (main.summaryKind === "extractivo") warnings.push("La redacción con IA falló: este texto son extractos del medio. Reescribilo antes de publicar.");
  const undated = chosen.filter((a) => !a.publishedAt);
  if (undated.length) warnings.push("Hay notas sin fecha verificable: confirmá que el hecho sea actual.");

  const withImage = chosen.find((a) => a.image);
  return {
    event: {
      title: main.title,
      summary: main.summary,
      keyPoints: main.keyPoints,
      category: main.category,
      scope: main.scope ?? "paraguay",
      expiresAt: main.expiresAt ?? null,
      summaryKind: main.summaryKind === "extractivo" ? "extractivo" : "ia",
      image: withImage ? { url: withImage.image, credit: withImage.sourceName, articleUrl: withImage.url } : null,
      sources: chosen.map((a) => ({
        sourceId: a.sourceId,
        sourceName: a.sourceName,
        title: a.title,
        url: a.url,
        publishedAt: a.publishedAt ?? nowIso,
        image: a.image ?? null,
        dateUnknown: !a.publishedAt,
      })),
    },
    warnings,
  };
}

export async function dispatchManual(payload) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw publicError(503, "Falta configurar el permiso de GitHub en el panel");
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/manual.yml/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "elprocer-editor" },
    body: JSON.stringify({ ref: "main", inputs: { payload: JSON.stringify(payload) } }),
  });
  if (res.status !== 204) {
    console.error("GitHub respondió", res.status, await res.text());
    throw publicError(502, `GitHub rechazó la publicación (HTTP ${res.status}).`);
  }
}

export const previewId = (event) => eventId(event);

// Lo publicado a mano en los últimos días, tal como lo está sirviendo la web.
export async function recentManual() {
  const get = async (p) => {
    const res = await fetch(`${SITE}/data/${p}?t=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
    return res.ok ? res.json() : null;
  };
  const dates = ((await get("manual/index.json")) ?? []).slice(0, 3);
  const out = [];
  for (const date of dates) {
    const manual = await get(`manual/${date}.json`);
    for (const ev of manual?.events ?? []) {
      out.push({ id: ev.id, date, title: ev.title, category: ev.category, at: ev.firstSeenAt, url: `${SITE}/n/${ev.id}/` });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}
