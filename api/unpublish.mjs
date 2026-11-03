import { publicError, route } from "../src/editor/auth.mjs";
import { dispatchManual } from "../src/editor/newsroom.mjs";

export default route({}, async ({ res, body, session }) => {
  if (!/^ev-[a-z0-9]+$/.test(String(body.id)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) throw publicError(400, "Pedido no válido");
  await dispatchManual({ action: "unpublish", editor: session.name, id: body.id, date: body.date });
  return res.status(202).json({ ok: true });
});
