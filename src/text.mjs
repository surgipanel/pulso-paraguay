// Utilidades de texto: limpieza de HTML, normalización en español, tokens, fechas en Asunción.
import { TIMEZONE } from "./config.mjs";

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  hellip: "…", laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", iquest: "¿", iexcl: "¡",
};

export function decodeEntities(text = "") {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m);
}

export function stripHtml(html = "") {
  let text = String(html);
  // Los feeds de Arc (ABC, La Nación) traen HTML escapado dentro del CDATA: dos pasadas.
  for (let i = 0; i < 2; i++) {
    text = decodeEntities(text);
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|li|h\d|br|tr)>/gi, " \n")
      .replace(/<br\s*\/?>/gi, " \n")
      .replace(/<[^>]+>/g, " ");
  }
  return text.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

export function squeeze(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

export function words(text = "") {
  return squeeze(text).split(" ").filter(Boolean);
}

export function wordCount(text = "") {
  return words(text).length;
}

export function truncateWords(text, max) {
  const w = words(text);
  if (w.length <= max) return w.join(" ");
  return w.slice(0, max).join(" ").replace(/[,;:\-–—]$/, "") + "…";
}

// Extracto: primeras oraciones de un texto, limitado en caracteres (nunca el artículo completo).
export function excerptOf(text, maxChars = 700) {
  const clean = squeeze(stripHtml(text));
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (lastStop > maxChars * 0.5 ? cut.slice(0, lastStop + 1) : cut.replace(/\s+\S*$/, "") + "…").trim();
}

export function sentences(text = "") {
  return squeeze(text)
    .split(/(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡"“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function fold(text = "") {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export const STOPWORDS = new Set(
  `a al algo algunas algunos ante antes aquel aquella aquellas aquello aquellos aqui asi aun aunque bajo bien cada casi como con contra cual cuales cuando cuanto de del desde donde dos durante e el ella ellas ellos en entre era eran es esa esas ese eso esos esta estaba estaban estamos estan estar este esto estos fue fueron ha habia habian hace hacen hacer hacia han hasta hay hoy la las le les lo los luego mas me mi mientras misma mismo mucho muy nada ni no nos nosotros nuestra nuestro o otra otras otro otros para pero poco por porque que quien quienes se sea segun ser si sin sino sobre solo son su sus tal tambien tanto te tiene tienen toda todas todo todos tras tu un una unas uno unos usted ya yo
  sera seran sido siendo estuvo mediante via ayer manana noche tarde dia dias semana semanas mes meses ano anos
  dijo dice dijeron afirmo afirma aseguro asegura senalo senala indico indica explico explica sostuvo sostiene informo informa anuncio anuncia confirmo confirma
  nuevo nueva nuevos nuevas gran grandes mayor menor primer primera segundo segunda ultimo ultima ultimos ultimas parte partes
  paraguay paraguayo paraguaya paraguayos paraguayas pais nacional asuncion
  video fotos foto nota leer mira mire`.split(/\s+/),
);

export function tokens(text = "") {
  return fold(text)
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d{1,2}$/.test(t));
}

// Tokens "fuertes" de un título: nombres propios (mayúscula inicial en el original) y números.
export function strongTokens(title = "") {
  const out = new Set();
  const parts = String(title).split(/\s+/);
  parts.forEach((raw, i) => {
    const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!w) return;
    const f = fold(w).replace(/[^a-z0-9ñ]/g, "");
    if (f.length < 3 || STOPWORDS.has(f)) return;
    const isNumber = /\d/.test(f);
    const isProper = i > 0 && /^[A-ZÁÉÍÓÚÑ]/.test(w);
    if (isNumber || isProper) out.add(f);
  });
  return out;
}

// Nombres propios y cifras de un título, incluida la primera palabra (donde suele ir el nombre:
// «Davidovich, en conversaciones…», «Landau responde…»). Sirve para saber si dos títulos hablan
// de lo mismo aunque estén redactados distinto.
export function nameTokens(title = "") {
  const out = new Set(strongTokens(title));
  for (const raw of String(title).split(/s+/)) {
    const w = raw.replace(/^[^p{L}p{N}]+|[^p{L}p{N}]+$/gu, "");
    if (!/^[A-ZÁÉÍÓÚÑ]/.test(w)) continue;
    const f = fold(w).replace(/[^a-z0-9ñ]/g, "");
    if (f.length >= 4 && !STOPWORDS.has(f)) out.add(f);
  }
  return out;
}

// ---------- Fechas (zona America/Asuncion) ----------

const dtfParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

export function asuncionParts(date = new Date()) {
  const parts = Object.fromEntries(dtfParts.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

export function asuncionDate(date = new Date()) {
  return asuncionParts(date).date;
}

export function slotFor(date = new Date()) {
  return asuncionParts(date).hour < 12 ? "manana" : "tarde";
}

export function parseDate(value) {
  if (!value) return null;
  const d = new Date(String(value).trim());
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function hoursBetween(a, b) {
  return Math.abs(a.getTime() - b.getTime()) / 36e5;
}

export function shortId(text) {
  // FNV-1a 32 bits → base36. Suficiente para ids estables de artículos/acontecimientos.
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0");
}

export function canonicalUrl(url = "") {
  try {
    const u = new URL(String(url).trim());
    u.protocol = "https:";
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|outputType$)/i.test(k)) u.searchParams.delete(k);
    }
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return String(url).trim();
  }
}
