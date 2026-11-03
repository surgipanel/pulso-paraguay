// Lee una nota elegida por el editor: título, medio, fecha, foto y texto. El texto es solo insumo
// para el redactor; no se publica.
import { fetchText, metaContent, probeImage } from "../fetch.mjs";
import { SOURCES } from "../sources.mjs";
import { imageKey } from "../images.mjs";
import { canonicalUrl, decodeEntities, excerptOf, parseDate, shortId, squeeze, stripHtml } from "../text.mjs";

const MATERIAL_CHARS = 3000;
const SITE = "https://elprocer.com.py";

// Solo direcciones públicas: el panel no puede usarse para leer servidores internos.
export function checkPublicUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
  if (isIp || host === "localhost" || !host.includes(".") || /\.(local|internal|localhost)$/.test(host)) return null;
  return u.toString();
}

function jsonLdNodes(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n) => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === "object") {
          out.push(n);
          if (n["@graph"]) walk(n["@graph"]);
        }
      };
      walk(JSON.parse(m[1].trim()));
    } catch {
      // JSON-LD mal formado: se sigue con lo demás.
    }
  }
  return out;
}

function bodyText(html, nodes) {
  const fromLd = nodes.map((n) => n.articleBody).find((b) => typeof b === "string" && b.length > 200);
  if (fromLd) return fromLd;
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const scope = clean.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? clean;
  return [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => squeeze(stripHtml(m[1])))
    .filter((p) => p.length > 60)
    .join(" ");
}

export async function genericImageKeys() {
  try {
    const res = await fetch(`${SITE}/data/generic-images.json?t=${Date.now()}`);
    return new Set((await res.json()).keys ?? []);
  } catch {
    return new Set();
  }
}

export async function readArticle(rawUrl, generic = new Set()) {
  const url = checkPublicUrl(rawUrl);
  if (!url) throw new Error("La dirección no es válida");
  const { body: html, finalUrl } = await fetchText(url, { retries: 0, timeoutMs: 12_000, accept: "text/html" });
  const finalChecked = checkPublicUrl(finalUrl || url) ?? url;
  const head = html.slice(0, 300_000);
  const nodes = jsonLdNodes(html);
  const host = new URL(finalChecked).hostname.replace(/^www\./, "");
  const known = SOURCES.find((s) => s.homepage && new URL(s.homepage).hostname.replace(/^www\./, "") === host);

  const clean = (s) => squeeze(decodeEntities(stripHtml(s ?? "")));
  const title = clean(nodes.map((n) => n.headline).find((h) => typeof h === "string")) ||
    clean(metaContent(head, ["og:title", "twitter:title"])) ||
    clean(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  if (!title) throw new Error("No se pudo leer el título de la nota");

  const description = clean(metaContent(head, ["og:description", "description", "twitter:description"]));
  const material = excerptOf(`${description} ${bodyText(html, nodes)}`, MATERIAL_CHARS);

  const dateRaw = metaContent(head, ["article:published_time", "og:article:published_time", "date", "pubdate"]) ||
    nodes.map((n) => n.datePublished).find(Boolean) ||
    head.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  const publishedAt = parseDate(dateRaw);

  const rawImage = decodeEntities(metaContent(head, ["og:image", "twitter:image"]) || "");
  const image = rawImage && !generic.has(imageKey(rawImage)) ? await probeImage(new URL(rawImage, finalChecked).toString()).catch(() => null) : null;

  const canonical = canonicalUrl(finalChecked);
  return {
    id: shortId(canonical),
    url: canonical,
    title,
    excerpt: excerptOf(material, 700),
    material,
    sourceId: known?.id ?? host,
    sourceName: known?.name ?? (clean(metaContent(head, ["og:site_name"])) || host),
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
    image,
  };
}
