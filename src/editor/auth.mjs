// Acceso al panel de editor: inicio de sesión con Google, solo para las cuentas autorizadas en
// EDITOR_EMAILS. Sin esa variable, nadie entra.
import { createHash } from "node:crypto";
import { SignJWT, createRemoteJWKSet, jwtVerify } from "jose";

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const COOKIE = "ep_editor";
const SESSION_HOURS = 12;

// Clave que firma la sesión: se deriva del permiso de GitHub (un secreto largo que el panel ya
// necesita), así hay una variable menos que cargar. Cambiar ese permiso cierra todas las sesiones.
const secretKey = () => {
  const s = process.env.SESSION_SECRET || process.env.GITHUB_TOKEN;
  if (!s || s.length < 20) throw new Error("Falta configurar GITHUB_TOKEN");
  return createHash("sha256").update(`elprocer-editor-session:${s}`).digest();
};

// Gmail ignora los puntos y lo que sigue a "+": dr.miguelmussi y drmiguelmussi son la misma cuenta.
export function normalizeEmail(email) {
  const [user, domain] = String(email ?? "").trim().toLowerCase().split("@");
  if (!user || !domain) return "";
  if (domain === "gmail.com" || domain === "googlemail.com") return `${user.split("+")[0].replace(/\./g, "")}@gmail.com`;
  return `${user}@${domain}`;
}

export function isAllowed(email) {
  const list = String(process.env.EDITOR_EMAILS ?? "").split(",").map(normalizeEmail).filter(Boolean);
  return list.includes(normalizeEmail(email));
}

export async function verifyGoogleCredential(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("Falta configurar GOOGLE_CLIENT_ID");
  const { payload } = await jwtVerify(credential, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
  });
  if (!payload.email_verified) throw new Error("La cuenta de Google no tiene el correo verificado");
  return { email: payload.email, name: payload.given_name || payload.name || "Editor" };
}

export async function issueSession(user) {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secretKey());
}

export const sessionCookie = (token) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function readSession(req) {
  const raw = String(req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw.slice(COOKIE.length + 1), secretKey());
    // La lista se vuelve a mirar en cada pedido: quitar a alguien de EDITOR_EMAILS corta su acceso.
    return isAllowed(payload.email) ? { email: payload.email, name: payload.name } : null;
  } catch {
    return null;
  }
}

// Envoltura de cada ruta: método, sesión, origen y errores en un solo lugar.
export function route({ method = "POST", auth = true }, handler) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== method) return res.status(405).json({ error: "Método no permitido" });
    try {
      if (method !== "GET") {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: "Origen no permitido" });
      }
      const session = auth ? await readSession(req) : null;
      if (auth && !session) return res.status(401).json({ error: "Tenés que iniciar sesión" });
      const body = typeof req.body === "object" && req.body ? req.body : {};
      return await handler({ req, res, body, session });
    } catch (err) {
      console.error(err);
      return res.status(err.status ?? 500).json({ error: err.publicMessage ?? err.message ?? "Error inesperado" });
    }
  };
}

export function publicError(status, message) {
  return Object.assign(new Error(message), { status, publicMessage: message });
}
