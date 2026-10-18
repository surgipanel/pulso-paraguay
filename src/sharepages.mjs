// Página propia por acontecimiento: docs/n/<id>/index.html.
// WhatsApp, Facebook y X no leen lo que va después del "#" en un enlace, así que con las rutas
// de la web (#/noticia/…) todas las noticias se compartían con la misma tarjeta genérica.
// Cada página es una copia de docs/index.html con el título, el resumen y la foto de la noticia
// en las etiquetas de vista previa (og:*), y abre la noticia dentro de la web como siempre.
// También genera docs/sitemap.xml para que los buscadores encuentren cada noticia.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "./config.mjs";

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docs");
export const SITE_URL = "https://elprocer.com.py";
const LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

const attr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const safeId = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "");

export const sharePath = (ev) => `/n/${safeId(ev.id)}/`;
export const shareUrl = (ev) => SITE_URL + sharePath(ev);

function setMeta(html, key, value) {
  const re = new RegExp(`(<meta ${key} content=")[^"]*(")`);
  if (!re.test(html)) throw new Error(`plantilla sin <meta ${key}>`);
  return html.replace(re, `$1${attr(value)}$2`);
}

function shortDescription(text, max = 220) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

export function renderSharePage(template, ev, date) {
  const id = safeId(ev.id);
  const title = `${ev.title} | El Prócer`;
  const description = shortDescription(ev.summary);
  const image = ev.image?.url || `${SITE_URL}/img/seccion-${LABEL[ev.category] ? ev.category : "pais"}.png`;
  const published = ev.firstSeenAt || ev.updatedAt || "";
  let html = template;
  html = html.replace(/<meta charset="utf-8" \/>/, `<meta charset="utf-8" />\n  <base href="/" />`);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${attr(title)}</title>`);
  html = setMeta(html, 'name="description"', description);
  html = setMeta(html, 'property="og:title"', title);
  html = setMeta(html, 'property="og:description"', description);
  html = setMeta(html, 'property="og:type"', "article");
  html = setMeta(html, 'property="og:url"', shareUrl(ev));
  html = setMeta(html, 'property="og:image"', image);
  html = setMeta(html, 'property="og:image:alt"', ev.title);
  html = setMeta(html, 'name="twitter:title"', title);
  html = setMeta(html, 'name="twitter:image"', image);
  // La foto del medio tiene otras medidas que la imagen genérica del sitio.
  html = html.replace(/\s*<meta property="og:image:(width|height)" content="[^"]*" \/>/g, "");
  html = html.replace(
    /(<meta property="og:url" content="[^"]*" \/>)/,
    `$1\n  <link rel="canonical" href="${attr(shareUrl(ev))}" />` +
      (published ? `\n  <meta property="article:published_time" content="${attr(published)}" />` : "") +
      `\n  <meta property="article:section" content="${attr(LABEL[ev.category] ?? "")}" />` +
      `\n  <meta name="twitter:description" content="${attr(description)}" />`,
  );
  // Al abrir el enlace, la web muestra esta noticia (sin cambiar de página).
  const route = `#/noticia/${id}?e=${safeId(date)}`;
  html = html.replace(
    '<script src="app.js"></script>',
    `<script>if (!location.hash) history.replaceState(null, "", location.pathname + location.search + "${route}");</script>\n  <script src="app.js"></script>`,
  );
  return html;
}

export async function writeSharePages(editions) {
  const template = await readFile(path.join(DOCS, "index.html"), "utf8");
  let count = 0;
  for (const ed of editions) {
    for (const ev of ed.events ?? []) {
      const dir = path.join(DOCS, "n", safeId(ev.id));
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "index.html"), renderSharePage(template, ev, ed.date), "utf8");
      count++;
    }
  }
  return count;
}

// Sitemap con la portada y todas las noticias del archivo.
export async function writeSitemap(index, loadEdition) {
  const urls = [`  <url><loc>${SITE_URL}/</loc><changefreq>hourly</changefreq></url>`];
  for (const { date } of index) {
    const ed = await loadEdition(date);
    for (const ev of ed?.events ?? []) {
      urls.push(`  <url><loc>${attr(shareUrl(ev))}</loc><lastmod>${attr((ev.updatedAt || ev.firstSeenAt || date).slice(0, 10))}</lastmod></url>`);
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  await writeFile(path.join(DOCS, "sitemap.xml"), xml, "utf8");
  return urls.length;
}
