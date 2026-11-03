import { publicError, route } from "../src/editor/auth.mjs";
import { saveOwnImage } from "../src/editor/newsroom.mjs";

export default route({}, async ({ res, body }) => {
  if (typeof body.image !== "string") throw publicError(400, "Falta la foto");
  return res.status(201).json({ url: await saveOwnImage(body.image) });
});
