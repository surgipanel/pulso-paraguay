import { readSession, route } from "../src/editor/auth.mjs";

export default route({ method: "GET", auth: false }, async ({ req, res }) => {
  const session = await readSession(req).catch(() => null);
  return res.status(200).json({ clientId: process.env.GOOGLE_CLIENT_ID ?? null, user: session ? { name: session.name, email: session.email } : null });
});
