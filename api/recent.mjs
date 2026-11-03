import { route } from "../src/editor/auth.mjs";
import { recentManual } from "../src/editor/newsroom.mjs";

export default route({ method: "GET" }, async ({ res }) => res.status(200).json({ items: await recentManual() }));
