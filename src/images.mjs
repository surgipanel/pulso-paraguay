// Fotos genéricas de los medios: ABC pone una misma foto de sección («Internacionales - ABC»,
// «Ciencia - ABC», fútbol internacional…) a todas las notas de agencia sin foto propia; La Nación
// y ADN Digital hacen algo parecido. No sirven como foto de un acontecimiento.
//
// Regla: una foto es genérica si aparece en notas de hechos distintos que, además, no tienen
// nada que ver entre sí (sus títulos no comparten nombres propios ni cifras). Así se distingue
// la foto de sección de ABC, repetida en 39 notas de agencia sin relación, de una foto real que
// un medio reusa en dos notas del mismo tema (la de un tenista, la de un funcionario de visita).
// Las detectadas se recuerdan en docs/data/generic-images.json para reconocerlas aunque al día
// siguiente aparezcan una sola vez.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./store.mjs";
import { STOPWORDS, fold, strongTokens } from "./text.mjs";

// Nombres propios y cifras de un título, incluida la primera palabra (donde suele ir el nombre:
// «Davidovich, en conversaciones…», «Landau responde…»).
function keyTokens(title = "") {
  const out = new Set(strongTokens(title));
  for (const raw of String(title).split(/\s+/)) {
    const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!/^[A-ZÁÉÍÓÚÑ]/.test(w)) continue;
    const f = fold(w).replace(/[^a-z0-9ñ]/g, "");
    if (f.length >= 4 && !STOPWORDS.has(f)) out.add(f);
  }
  return out;
}

const FILE = path.join(DATA_DIR, "generic-images.json");
const KEEP = 600;

// Clave estable de una foto: el nombre del archivo (igual en la dirección vieja
// www.medio/resizer/…=/cloudfront…/ID.jpg y en la nueva del CDN …/resizer/v2/ID.jpg).
export function imageKey(url) {
  if (!url) return null;
  try {
    const name = new URL(url).pathname.split("/").pop();
    return name ? name.toLowerCase() : null;
  } catch {
    return null;
  }
}

// Proporción de pares de títulos que comparten al menos un nombre propio o cifra.
function relatedness(titles) {
  const sets = titles.map((t) => keyTokens(t));
  let pairs = 0, related = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      pairs++;
      for (const t of sets[i]) if (sets[j].has(t)) { related++; break; }
    }
  }
  return pairs ? related / pairs : 1;
}

// clusters: [{ id, articles: [{ url, title, image }] }] — también sirve con acontecimientos
// publicados (cada uno como un "grupo" cuyas notas son sus fuentes).
export function detectGenericImages(clusters) {
  const seen = new Map(); // clave → { urls: Set, clusters: Set, titles: [] }
  for (const c of clusters) {
    for (const a of c.articles) {
      const k = imageKey(a.image);
      if (!k) continue;
      if (!seen.has(k)) seen.set(k, { urls: new Set(), clusters: new Set(), titles: [] });
      const o = seen.get(k);
      if (o.urls.has(a.url)) continue;
      o.urls.add(a.url);
      o.clusters.add(c.id);
      o.titles.push(a.title ?? "");
    }
  }
  const out = new Set();
  for (const [k, o] of seen) {
    if (o.urls.size >= 2 && o.clusters.size >= 2 && relatedness(o.titles) < 0.5) out.add(k);
  }
  return out;
}

export async function readGenericImages() {
  try {
    const data = JSON.parse(await readFile(FILE, "utf8"));
    return new Set(data.keys ?? []);
  } catch {
    return new Set();
  }
}

export async function writeGenericImages(keys) {
  const list = [...keys].slice(-KEEP);
  await writeFile(FILE, JSON.stringify({ updatedAt: new Date().toISOString(), keys: list }, null, 2) + "\n", "utf8");
}
