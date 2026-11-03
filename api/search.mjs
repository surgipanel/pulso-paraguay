import { publicError, route } from "../src/editor/auth.mjs";
import { searchNews } from "../src/editor/newsroom.mjs";

export default route({}, async ({ res, body }) => {
  const q = String(body.q ?? "").trim();
  if (q.length < 3 || q.length > 200) throw publicError(400, "Escribí un tema de entre 3 y 200 caracteres");
  return res.status(200).json({ results: await searchNews(q) });
});
