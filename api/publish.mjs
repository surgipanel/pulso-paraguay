import { publicError, route } from "../src/editor/auth.mjs";
import { ManualEvent } from "../src/editor/schema.mjs";
import { dispatchManual, previewId } from "../src/editor/newsroom.mjs";

export default route({}, async ({ res, body, session }) => {
  const parsed = ManualEvent.safeParse(body.event);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw publicError(400, `Revisá el borrador: ${first.path.join(".")}: ${first.message}`);
  }
  await dispatchManual({ action: "publish", editor: session.name, event: parsed.data });
  const id = previewId(parsed.data);
  return res.status(202).json({ id, url: `https://elprocer.com.py/n/${id}/` });
});
