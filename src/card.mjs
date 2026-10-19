// Tarjeta de imagen con la marca El Prócer para redes (1200×675, PNG).
// Sin fotos de los medios: solo titular, categoría, fuentes y la identidad del diario.
// Colores y tipografías según el Manual de Marca v1.0.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { CATEGORIES, TIMEZONE } from "./config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT_DIR = path.join(ROOT, "assets", "fonts");
const FONTS = ["Tinos-Bold.ttf", "Lato-Bold.ttf", "Lato-Regular.ttf"].map((f) => path.join(FONT_DIR, f));

const W = 1200;
const H = 675;
const PAD = 72;
const NOCHE = "#071C39";
const ROJO = "#E52531";
const DIGITAL = "#1455A4";
const GRIS = "#E3E7ED";
const MUTED = "#AAB7CB";

const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Ancho aproximado de un carácter en "em" para una serif negrita. Alcanza para partir líneas.
function charWidth(ch) {
  if (/[  ]/.test(ch)) return 0.26;
  if (/[iljtf.,:;'’!|()\[\]]/.test(ch)) return 0.3;
  if (/[mwMW]/.test(ch)) return 0.86;
  if (/[A-ZÁÉÍÓÚÑÜ0-9]/.test(ch)) return 0.68;
  return 0.52;
}
function textWidth(text, size) {
  let w = 0;
  for (const ch of text) w += charWidth(ch);
  return w * size * 1.04;
}
function wrap(text, size, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, size) <= maxWidth || !line) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}
// Elige el mayor tamaño de titular que entra en 4 líneas (o 5 para títulos muy largos).
function fitHeadline(title, maxWidth) {
  for (const size of [62, 56, 50, 46, 42, 38]) {
    const lines = wrap(title, size, maxWidth);
    if (lines.length <= 4) return { size, lines };
  }
  const lines = wrap(title, 36, maxWidth).slice(0, 5);
  return { size: 36, lines };
}

function fmtDay(date = new Date()) {
  const s = new Intl.DateTimeFormat("es-PY", { timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long" }).format(date);
  return s.toUpperCase();
}

export function distinctSourceNames(ev) {
  return [...new Map((ev.sources ?? []).map((s) => [s.sourceId, s.sourceName])).values()];
}

/** Devuelve el SVG de la tarjeta (útil para inspeccionar). */
export function cardSvg(ev, { date = new Date() } = {}) {
  const maxWidth = W - PAD * 2;
  const { size, lines } = fitHeadline(ev.title, maxWidth);
  const lineHeight = Math.round(size * 1.12);
  const headlineTop = 236;
  const kicker = `${String(CAT_LABEL[ev.category] ?? ev.category ?? "").toUpperCase()}  ·  ${fmtDay(date)}`;
  const names = distinctSourceNames(ev);
  let sourcesLine = names.length ? `Fuentes: ${names.join(" · ")}` : "";
  if (textWidth(sourcesLine, 22) > W - PAD * 2 - 260) {
    const shown = [];
    for (const n of names) {
      const trial = `Fuentes: ${[...shown, n].join(" · ")} · +${names.length - shown.length - 1}`;
      if (textWidth(trial, 22) > W - PAD * 2 - 260) break;
      shown.push(n);
    }
    sourcesLine = `Fuentes: ${shown.join(" · ")} · +${names.length - shown.length}`;
  }
  const headline = lines
    .map((l, i) => `<text x="${PAD}" y="${headlineTop + lineHeight * (i + 1)}" font-family="Tinos" font-weight="700" font-size="${size}" fill="#ffffff">${esc(l)}</text>`)
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${NOCHE}"/>
  <!-- marca -->
  <text x="${PAD}" y="104" font-family="Tinos" font-weight="700" font-size="46" fill="#ffffff" letter-spacing="-0.5">EL PRÓCER</text>
  <rect x="${PAD}" y="118" width="94" height="5" fill="${ROJO}"/>
  <rect x="${PAD + 94}" y="118" width="80" height="5" fill="${GRIS}"/>
  <rect x="${PAD + 174}" y="118" width="94" height="5" fill="${DIGITAL}"/>
  <text x="${PAD}" y="146" font-family="Lato" font-weight="700" font-size="13" fill="#ffffff" letter-spacing="4">LIBRES PARA INFORMAR</text>
  <!-- categoría y fecha -->
  <text x="${W - PAD}" y="104" text-anchor="end" font-family="Lato" font-weight="700" font-size="19" fill="${GRIS}" letter-spacing="2">${esc(kicker)}</text>
  <!-- destacado -->
  <rect x="${PAD}" y="${headlineTop - 6}" width="72" height="4" fill="${ROJO}"/>
  <!-- titular -->
  ${headline}
  <!-- pie -->
  <line x1="${PAD}" y1="${H - 86}" x2="${W - PAD}" y2="${H - 86}" stroke="#223659" stroke-width="1"/>
  <text x="${PAD}" y="${H - 48}" font-family="Lato" font-weight="400" font-size="22" fill="${MUTED}">${esc(sourcesLine)}</text>
  <text x="${W - PAD}" y="${H - 48}" text-anchor="end" font-family="Lato" font-weight="700" font-size="24" fill="#ffffff">elprocer.com.py</text>
</svg>`;
}

/** Renderiza la tarjeta a PNG (Buffer). */
export function renderCard(ev, opts = {}) {
  const svg = cardSvg(ev, opts);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Lato" },
  });
  return Buffer.from(resvg.render().asPng());
}

export function fontsAvailable() {
  try { FONTS.forEach((f) => readFileSync(f)); return true; } catch { return false; }
}
