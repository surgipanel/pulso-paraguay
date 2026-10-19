#!/usr/bin/env node
// Publica UNA noticia de la edición vigente en X (Twitter), con tarjeta de imagen propia.
// Se ejecuta al final de cada corrida editorial (5 por día → 5 posts por día).
//
// Uso: node scripts/publish-x.mjs [--dry-run] [--out ruta.png] [--event ID]
//   --dry-run   no publica: imprime el texto y guarda la tarjeta en --out (por defecto tmp/card.png)
//
// Variables: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET (sin ellas, se omite sin error)
//            X_LINK_MODE = none (por defecto) | daily (el 1.º post del día lleva enlace) | all
//            X_MAX_POSTS_PER_DAY = 5
//            X_CATEGORIES = politica (lista separada por comas; vacío o "todas" = cualquier categoría)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, exit } from "node:process";
import { renderCard, distinctSourceNames, fontsAvailable } from "../src/card.mjs";
import { credentialsFromEnv, uploadImage, createPost, xLength, whoAmI } from "../src/x-client.mjs";
import { TIMEZONE } from "../src/config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "docs", "data");
const SOCIAL = path.join(DATA, "social.json");
const SITE = "https://elprocer.com.py";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : path.join(ROOT, "tmp", "card.png");
const FORCE_EVENT = args.includes("--event") ? args[args.indexOf("--event") + 1] : null;
const LINK_MODE = (env.X_LINK_MODE || "none").trim().toLowerCase();
const MAX_PER_DAY = Math.max(1, Number.parseInt(env.X_MAX_POSTS_PER_DAY || "5", 10) || 5);
// Decisión editorial del dueño (19/10/2026): en X solo se publica Política.
const CATEGORIES = (env.X_CATEGORIES || "politica").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s && s !== "todas");

const log = (...a) => console.log("[x]", ...a);

async function readJson(p, fallback) {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return fallback; }
}
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const latestAt = (ev) => (ev.sources ?? []).map((s) => s.publishedAt).sort().at(-1) ?? ev.updatedAt ?? ev.firstSeenAt;
const asuDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

function pickEvent(events, posted, today) {
  const postedKeys = new Set(posted.map((p) => p.eventId));
  const postedTitles = new Set(posted.map((p) => fold(p.title)));
  const todays = posted.filter((p) => p.day === today);
  const lastCat = todays.at(-1)?.category;
  const now = Date.now();
  const fresh = events.filter((ev) => {
    if (CATEGORIES.length && !CATEGORIES.includes(ev.category)) return false;
    if (postedKeys.has(ev.id) || postedTitles.has(fold(ev.title))) return false;
    const t = new Date(latestAt(ev)).getTime();
    return Number.isFinite(t) && now - t < 18 * 3600e3; // nada de más de 18 h
  });
  const score = (ev) =>
    distinctSourceNames(ev).length * 10 +
    (ev.summaryKind === "ia" ? 3 : 0) +
    (ev.category !== lastCat ? 2 : 0) +
    Math.max(0, 6 - (now - new Date(latestAt(ev)).getTime()) / 3600e3) * 0.5; // recencia
  return fresh.sort((a, b) => score(b) - score(a))[0] ?? null;
}

function composeText(ev, { withLink }) {
  const link = withLink ? `${SITE}/n/${ev.id}/` : "";
  const names = distinctSourceNames(ev);
  const sources = names.length ? `Fuentes: ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` y ${names.length - 4} más` : ""}` : "";
  // Punto clave que aporte algo: se descartan los que repiten más de la mitad de las palabras del título.
  const titleWords = new Set(fold(ev.title).split(" ").filter((w) => w.length > 3));
  const overlap = (k) => { const ws = fold(k).split(" ").filter((w) => w.length > 3); return ws.length ? ws.filter((w) => titleWords.has(w)).length / ws.length : 1; };
  const point = (ev.keyPoints ?? []).find((k) => k && k.length <= 160 && overlap(k) < 0.5) ?? "";
  const parts = [ev.title.trim()];
  if (point) parts.push(`• ${point.trim()}`);
  if (sources) parts.push(sources);
  if (link) parts.push(link);
  let text = parts.join("\n\n");
  // Recorte progresivo: primero el punto clave, después las fuentes.
  if (xLength(text) > 280 && point) text = [ev.title.trim(), sources, link].filter(Boolean).join("\n\n");
  if (xLength(text) > 280 && sources) text = [ev.title.trim(), link].filter(Boolean).join("\n\n");
  if (xLength(text) > 280) text = [...ev.title.trim()].slice(0, 276).join("") + "…";
  return text;
}

async function main() {
  const latest = await readJson(path.join(DATA, "latest.json"), null);
  if (!latest?.editionDate) { log("sin edición publicada; nada que postear"); return; }
  const edition = await readJson(path.join(DATA, "editions", `${latest.editionDate}.json`), null);
  const events = edition?.events ?? [];
  const social = await readJson(SOCIAL, { posts: [] });
  const today = asuDay();
  const todayCount = social.posts.filter((p) => p.day === today && p.ok).length;
  if (!DRY && todayCount >= MAX_PER_DAY) { log(`ya se publicaron ${todayCount} posts hoy (máx. ${MAX_PER_DAY}); se omite`); return; }

  const ev = FORCE_EVENT ? events.find((e) => e.id === FORCE_EVENT) : pickEvent(events, social.posts, today);
  if (!ev) { log(`no hay ninguna noticia nueva para publicar${CATEGORIES.length ? ` en ${CATEGORIES.join(", ")}` : ""}`); return; }

  const withLink = LINK_MODE === "all" || (LINK_MODE === "daily" && todayCount === 0);
  const text = composeText(ev, { withLink });
  if (!fontsAvailable()) throw new Error("faltan las fuentes en assets/fonts");
  const png = renderCard(ev);
  log(`elegida: ${ev.id} · ${distinctSourceNames(ev).length} medios · ${ev.category}`);
  log(`texto (${xLength(text)} caracteres):\n${text}`);

  if (DRY) {
    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, png);
    log(`modo prueba: tarjeta guardada en ${OUT}; no se publicó nada`);
    return;
  }
  const creds = credentialsFromEnv();
  if (!creds) { log("sin credenciales de X (X_API_KEY…); se omite la publicación"); return; }

  const record = { day: today, eventId: ev.id, title: ev.title, category: ev.category, edition: latest.editionDate, at: new Date().toISOString(), withLink, ok: false, tweetId: null, withImage: true, error: null };
  const lastErr = social.posts.at(-1)?.error || "";
  try {
    // Si la publicación anterior falló por autenticación, primero se verifica la identidad de las claves.
    if (/HTTP 40[13]/.test(lastErr)) {
      try {
        const me = await whoAmI(creds);
        log(`credenciales válidas: @${me?.username ?? "?"}`);
      } catch (e) {
        throw new Error(`Credenciales rechazadas por X (${String(e.message).slice(0, 120)}). Revisar los cuatro secretos X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET en GitHub; el Access Token debe decir "Read and Write".`);
      }
    }
    let mediaIds = [];
    try {
      mediaIds = [await uploadImage(creds, png, "image/png")];
    } catch (e) {
      // La imagen no debe frenar la noticia: se publica solo texto y se deja constancia.
      log(`aviso: no se pudo subir la tarjeta (${String(e.message).slice(0, 160)}); se publica sin imagen`);
      record.withImage = false;
      record.imageError = String(e.message).slice(0, 200);
    }
    const post = await createPost(creds, text, mediaIds);
    record.ok = true;
    record.tweetId = post?.id ?? null;
    log(`publicado: https://x.com/i/web/status/${record.tweetId}${record.withImage ? "" : " (sin imagen)"}`);
  } catch (err) {
    record.error = String(err.message).slice(0, 300);
    log(`ERROR al publicar: ${record.error}`);
  }
  social.posts.push(record);
  social.posts = social.posts.slice(-400);
  social.updatedAt = new Date().toISOString();
  await writeFile(SOCIAL, JSON.stringify(social, null, 2) + "\n");
  if (!record.ok) exit(2);
}

main().catch((err) => { console.error("[x] fallo:", err); exit(1); });
