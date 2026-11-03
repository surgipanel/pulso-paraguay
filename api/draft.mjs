import { publicError, route } from "../src/editor/auth.mjs";
import { makeDraft } from "../src/editor/newsroom.mjs";

export default route({}, async ({ res, body }) => {
  const urls = Array.isArray(body.urls) ? [...new Set(body.urls.map(String))] : [];
  if (!urls.length || urls.length > 8) throw publicError(400, "Elegí entre 1 y 8 notas");
  return res.status(200).json(await makeDraft(urls));
});
