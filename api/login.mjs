import { isAllowed, issueSession, publicError, route, sessionCookie, verifyGoogleCredential } from "../src/editor/auth.mjs";

export default route({ auth: false }, async ({ res, body }) => {
  if (typeof body.credential !== "string") throw publicError(400, "Falta la credencial de Google");
  let user;
  try {
    user = await verifyGoogleCredential(body.credential);
  } catch (err) {
    console.warn("Login rechazado:", err.message);
    throw publicError(401, "No se pudo verificar la cuenta de Google");
  }
  if (!isAllowed(user.email)) {
    console.warn("Cuenta no autorizada intentó entrar");
    throw publicError(403, "Esta cuenta no tiene acceso al panel de editor");
  }
  res.setHeader("Set-Cookie", sessionCookie(await issueSession(user)));
  return res.status(200).json({ user: { name: user.name, email: user.email } });
});
