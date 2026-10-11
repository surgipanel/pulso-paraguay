// Descarga y parseo de feeds (RSS, Atom, sitemap de noticias) con reintentos limitados.
import { XMLParser } from "fast-xml-parser";
import { FETCH_RETRIES, FETCH_TIMEOUT_MS, STALE_HOURS, USER_AGENT, WINDOW_HOURS } from "./config.mjs";
import { canonicalUrl, decodeEntities, excerptOf, hoursBetween, parseDate, shortId, squeeze, stripHtml } from "./text.mjs";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "__cdata",
  textNodeName: "#text",
  processEntities: true,
  trimValues: true,
});

// Decodifica respetando la codificación declarada (El Nacional publica en ISO-8859-1).
function decodeBody(buf, contentType) {
  const head = buf.subarray(0, 400).toString("latin1");
  const declared = head.match(/^\s*<\?xml[^>]*encoding=["']([\w-]+)["']/i)?.[1];
  const header = contentType.match(/charset="?([\w-]+)/i)?.[1];
  const charset = (declared || header || "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url, { timeoutMs = FETCH_TIMEOUT_MS, retries = FETCH_RETRIES, accept = "*/*" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: { "user-agent": USER_AGENT, accept, "accept-language": "es-PY,es;q=0.9" },
      });
      const body = decodeBody(Buffer.from(await res.arrayBuffer()), res.headers.get("content-type") || "");
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        lastErr.httpStatus = res.status;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break; // no reintentar 4xx
      } else {
        return { body, httpStatus: res.status, finalUrl: res.url };
      }
    } catch (err) {
      lastErr = err.name === "AbortError" ? new Error(`timeout tras ${timeoutMs} ms`) : err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(1500 * (attempt + 1));
  }
  throw lastErr ?? new Error("fallo desconocido");
}

function text(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === "object") {
    if (node.__cdata != null) return text(node.__cdata);
    if (node["#text"] != null) return text(node["#text"]);
    if (node["@_href"]) return String(node["@_href"]);
  }
  return "";
}

function asArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

// Imagen de portada de una nota, tomada del feed (media:content, media:thumbnail, enclosure o
// primer <img> del contenido). Siempre es la URL original del medio: no se copia el archivo.
function imageFromItem(it) {
  const candidates = [];
  for (const m of [...asArray(it["media:content"]), ...asArray(it["media:thumbnail"])]) {
    const url = m?.["@_url"];
    const type = m?.["@_type"] ?? "";
    const medium = m?.["@_medium"] ?? "";
    if (url && (type.startsWith("image/") || medium === "image" || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url) || (!type && !medium))) candidates.push(url);
  }
  for (const e of asArray(it.enclosure)) {
    const url = e?.["@_url"];
    if (url && (e?.["@_type"] ?? "").startsWith("image/")) candidates.push(url);
  }
  const html = `${text(it["content:encoded"])} ${text(it.description)} ${text(it.content)} ${text(it.summary)}`;
  const m = decodeEntities(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m) candidates.push(m[1]);
  return normalizeImageUrl(candidates[0]);
}

function normalizeImageUrl(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (u.startsWith("//")) u = "https:" + u;
  if (u.startsWith("http://")) u = "https://" + u.slice(7);
  if (!/^https:\/\//.test(u)) return null;
  if (/\.(svg|gif)(\?|$)/i.test(u) || /(\/|_)(logo|placeholder|default|avatar|icon)/i.test(u)) return null;
  return u;
}

function parseRss(xml) {
  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel ?? doc?.["rdf:RDF"] ?? null;
  if (!channel) throw new Error("no parece un RSS");
  return asArray(channel.item).map((it) => ({
    title: squeeze(stripHtml(text(it.title))),
    url: text(it.link) || text(it.guid),
    publishedAt: parseDate(text(it.pubDate) || text(it["dc:date"]) || text(it.published)),
    body: text(it.description) || text(it["content:encoded"]) || "",
    fullBody: text(it["content:encoded"]) || "",
    image: imageFromItem(it),
  }));
}

function parseAtom(xml) {
  const doc = parser.parse(xml);
  const feed = doc?.feed;
  if (!feed) throw new Error("no parece un Atom");
  return asArray(feed.entry).map((e) => {
    const links = asArray(e.link);
    const alt = links.find((l) => !l?.["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
    return {
      title: squeeze(stripHtml(text(e.title))),
      url: alt?.["@_href"] ? String(alt["@_href"]) : text(e.id),
      publishedAt: parseDate(text(e.published) || text(e.updated)),
      body: text(e.summary) || text(e.content) || "",
      fullBody: text(e.content) || "",
      image: imageFromItem(e),
    };
  });
}

async function parseNewsSitemap(xml) {
  const doc = parser.parse(xml);
  // Puede ser un índice (sitemapindex) → seguir cada sub-sitemap.
  if (doc?.sitemapindex) {
    const locs = asArray(doc.sitemapindex.sitemap).map((s) => text(s.loc)).filter(Boolean);
    const all = [];
    for (const loc of locs.slice(0, 4)) {
      try {
        const { body } = await fetchText(loc, { accept: "application/xml,text/xml" });
        all.push(...(await parseNewsSitemap(body)));
      } catch (err) {
        console.warn(`  sub-sitemap ${loc}: ${err.message}`);
      }
    }
    return all;
  }
  const urls = asArray(doc?.urlset?.url);
  return urls.map((u) => {
    const news = u["news:news"] ?? {};
    return {
      title: squeeze(stripHtml(text(news["news:title"]))),
      url: text(u.loc),
      publishedAt: parseDate(text(news["news:publication_date"]) || text(u.lastmod)),
      body: "",
      fullBody: "",
      keywords: text(news["news:keywords"]),
      image: normalizeImageUrl(text(asArray(u["image:image"])[0]?.["image:loc"])),
    };
  });
}

function metaContent(head, names) {
  for (const name of names) {
    const m =
      head.match(new RegExp(`<meta\\s+(?:property|name)=["']${name}["']\\s+content=["']([^"']*)["']`, "i")) ||
      head.match(new RegExp(`<meta\\s+content=["']([^"']*)["']\\s+(?:property|name)=["']${name}["']`, "i"));
    if (m) return m[1];
  }
  return "";
}

// Lee la meta description y la imagen pública (og:image) de una nota; no el artículo completo.
async function fetchOgMeta(url) {
  const { body } = await fetchText(url, { retries: 0, accept: "text/html" });
  const head = body.slice(0, 200_000);
  return {
    description: squeeze(stripHtml(metaContent(head, ["og:description", "description"]))),
    image: normalizeImageUrl(decodeEntities(metaContent(head, ["og:image", "twitter:image"]))),
  };
}

function statusFromItems(items, now) {
  const fresh = items.filter((i) => i.publishedAt && hoursBetween(i.publishedAt, now) <= WINDOW_HOURS);
  const newest = items.reduce((acc, i) => (i.publishedAt && (!acc || i.publishedAt > acc) ? i.publishedAt : acc), null);
  const undated = items.filter((i) => !i.publishedAt).length;
  let status = "ok";
  let note = "";
  if (items.length === 0) {
    status = "error";
    note = "El feed respondió pero no trae notas.";
  } else if (!newest) {
    status = "stale";
    note = "Las notas no traen fecha: no se puede verificar si son del día.";
  } else if (hoursBetween(newest, now) > STALE_HOURS) {
    status = "stale";
    note = "El feed devuelve notas antiguas; no se usa como información del día.";
  } else if (fresh.length === 0) {
    status = "quiet";
    note = `Conecta bien pero no publicó notas en las últimas ${WINDOW_HOURS} h.`;
  }
  return { status, note, fresh, newest, undated };
}

export async function fetchSource(source, { now = new Date(), log = console } = {}) {
  const started = Date.now();
  const report = {
    id: source.id, name: source.name, homepage: source.homepage, kind: source.kind, url: source.url,
    region: source.region, note: source.note ?? "", status: "error", httpStatus: null, items: 0,
    freshItems: 0, undated: 0, newestAt: null, ms: 0, error: null, checkedAt: now.toISOString(),
  };
  if (source.kind === "none" || !source.url) {
    report.status = "unavailable";
    return { report, articles: [] };
  }
  try {
    const { body, httpStatus } = await fetchText(source.url, {
      accept: "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*",
    });
    report.httpStatus = httpStatus;
    let items;
    if (source.kind === "rss") items = parseRss(body);
    else if (source.kind === "atom") items = parseAtom(body);
    else if (source.kind === "news-sitemap") items = await parseNewsSitemap(body);
    else throw new Error(`tipo desconocido: ${source.kind}`);

    items = items.filter((i) => i.title && i.url);
    // Dedupe por URL dentro del feed.
    const seen = new Set();
    items = items.filter((i) => {
      const k = canonicalUrl(i.url);
      if (seen.has(k)) return false;
      seen.add(k);
      i.url = k;
      return true;
    });

    const { status, note, fresh, newest, undated } = statusFromItems(items, now);
    report.status = status;
    if (note) report.note = note;
    report.items = items.length;
    report.freshItems = fresh.length;
    report.undated = undated;
    report.newestAt = newest ? newest.toISOString() : null;

    let usable = status === "ok" ? fresh : [];
    usable.sort((a, b) => b.publishedAt - a.publishedAt);

    // "og-description": el feed solo trae título → se lee descripción e imagen de la nota.
    // "og-image": el feed trae texto pero no imagen → se lee solo la imagen.
    if ((source.enrich === "og-description" || source.enrich === "og-image") && usable.length) {
      const limit = Math.min(usable.length, source.maxEnrich ?? 12);
      usable = usable.slice(0, limit);
      for (let i = 0; i < usable.length; i++) {
        try {
          const meta = await fetchOgMeta(usable[i].url);
          if (source.enrich === "og-description") usable[i].body = meta.description;
          if (!usable[i].image) usable[i].image = meta.image;
        } catch (err) {
          log.warn?.(`  ${source.name}: sin metadatos para ${usable[i].url} (${err.message})`);
        }
        if (i < usable.length - 1) await sleep(source.crawlDelayMs ?? 2000);
      }
    }

    const articles = usable.map((i) => ({
      id: shortId(i.url),
      sourceId: source.id,
      sourceName: source.name,
      title: i.title,
      url: i.url,
      excerpt: excerptOf(i.body || i.fullBody || "", 700),
      image: i.image ?? null,
      publishedAt: i.publishedAt.toISOString(),
      fetchedAt: now.toISOString(),
    }));
    report.ms = Date.now() - started;
    return { report, articles };
  } catch (err) {
    report.status = "error";
    report.error = err.message;
    report.httpStatus = err.httpStatus ?? report.httpStatus;
    report.ms = Date.now() - started;
    return { report, articles: [] };
  }
}

export async function fetchAllSources(sources, opts = {}) {
  const results = await Promise.all(sources.map((s) => fetchSource(s, opts)));
  return { reports: results.map((r) => r.report), articles: results.flatMap((r) => r.articles) };
}
