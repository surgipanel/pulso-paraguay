import { clearCookie, route } from "../src/editor/auth.mjs";

export default route({ auth: false }, async ({ res }) => {
  res.setHeader("Set-Cookie", clearCookie());
  return res.status(200).json({ ok: true });
});
