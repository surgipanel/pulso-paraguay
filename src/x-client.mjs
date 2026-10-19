// Cliente mínimo de la API v2 de X con OAuth 1.0a (contexto de usuario).
// Sin dependencias: firma HMAC-SHA1 con node:crypto, multipart con FormData nativo.
// Endpoints: POST /2/tweets y subida de imagen por partes (initialize → append → finalize).
import { createHmac, randomBytes } from "node:crypto";
import { env } from "node:process";

const API = "https://api.x.com";

export function credentialsFromEnv() {
  // Se recortan espacios, saltos de línea y comillas que suelen colarse al pegar los secretos.
  const clean = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "").trim();
  const c = {
    consumerKey: clean(env.X_API_KEY),
    consumerSecret: clean(env.X_API_SECRET),
    token: clean(env.X_ACCESS_TOKEN),
    tokenSecret: clean(env.X_ACCESS_SECRET),
  };
  return Object.values(c).every((v) => v) ? c : null;
}

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** Cabecera Authorization: OAuth … para method+url (+ parámetros de query si los hay). */
export function oauthHeader(creds, method, url, queryParams = {}) {
  const oauth = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.token,
    oauth_version: "1.0",
  };
  const all = { ...queryParams, ...oauth };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${enc(k)}=${enc(all[k])}`)
    .join("&");
  const base = [method.toUpperCase(), enc(url), enc(paramString)].join("&");
  const key = `${enc(creds.consumerSecret)}&${enc(creds.tokenSecret)}`;
  const signature = createHmac("sha1", key).update(base).digest("base64");
  const header = { ...oauth, oauth_signature: signature };
  return "OAuth " + Object.keys(header).sort().map((k) => `${enc(k)}="${enc(header[k])}"`).join(", ");
}

async function request(creds, method, pathname, { json, form, query } = {}) {
  const url = `${API}${pathname}`;
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  const headers = { Authorization: oauthHeader(creds, method, url, query ?? {}), "User-Agent": "ElProcer/0.2 (+https://elprocer.com.py)" };
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  else if (form) body = form;
  const res = await fetch(url + qs, { method, headers, body });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const detail = data?.detail || data?.title || data?.errors?.[0]?.message || text.slice(0, 300);
    const err = new Error(`X API ${method} ${pathname} → HTTP ${res.status}: ${detail}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Diagnóstico: identidad de las credenciales (GET /2/users/me). Lanza si X las rechaza. */
export async function whoAmI(creds) {
  const res = await request(creds, "GET", "/2/users/me");
  return res?.data ?? res;
}

/** Sube una imagen PNG/JPEG y devuelve su media id. */
export async function uploadImage(creds, buffer, mediaType = "image/png") {
  const init = await request(creds, "POST", "/2/media/upload/initialize", {
    json: { media_type: mediaType, total_bytes: buffer.length, media_category: "tweet_image" },
  });
  const id = init?.data?.id;
  if (!id) throw new Error(`X media initialize sin id: ${JSON.stringify(init).slice(0, 200)}`);
  const form = new FormData();
  form.append("segment_index", "0");
  form.append("media", new Blob([buffer], { type: mediaType }), "card.png");
  await request(creds, "POST", `/2/media/upload/${id}/append`, { form });
  let fin = await request(creds, "POST", `/2/media/upload/${id}/finalize`, { json: {} });
  let info = fin?.data?.processing_info;
  for (let i = 0; info && info.state !== "succeeded" && i < 10; i++) {
    if (info.state === "failed") throw new Error(`X media processing failed: ${JSON.stringify(info)}`);
    await new Promise((r) => setTimeout(r, Math.max(1, info.check_after_secs ?? 1) * 1000));
    fin = await request(creds, "GET", "/2/media/upload", { query: { command: "STATUS", media_id: id } });
    info = fin?.data?.processing_info;
  }
  return id;
}

/** Publica un post; devuelve { id, text }. */
export async function createPost(creds, text, mediaIds = []) {
  const body = { text };
  if (mediaIds.length) body.media = { media_ids: mediaIds.map(String) };
  const res = await request(creds, "POST", "/2/tweets", { json: body });
  return res?.data ?? res;
}

/** Longitud según X: URLs cuentan 23; el resto, un carácter por punto de código (alcanza para español). */
export function xLength(text) {
  const urlRe = /https?:\/\/\S+/g;
  const urls = text.match(urlRe) ?? [];
  const rest = text.replace(urlRe, "");
  return [...rest].length + urls.length * 23;
}
