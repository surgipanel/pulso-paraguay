#!/usr/bin/env node
// Publicación manual desde el panel de editor: agrega o retira una noticia sin esperar a la
// corrida del bot. La dispara el workflow manual.yml con el pedido en MANUAL_PAYLOAD.
// Escribe docs/data/manual/ y docs/n/<id>/; no toca nada de lo que escribe el bot.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ManualPayload } from "../src/editor/schema.mjs";
import { eventId } from "../src/summarize.mjs";
import { scoreEvent } from "../src/edition.mjs";
import { renderSharePage } from "../src/sharepages.mjs";
import { MANUAL_DIR, readLatest, readManual, writeManual } from "../src/store.mjs";
import { asuncionDate } from "../src/text.mjs";

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docs");
const LOG = path.join(MANUAL_DIR, "log.json");

async function appendLog(entry) {
  let log = [];
  try { log = JSON.parse(await readFile(LOG, "utf8")); } catch {}
  log.unshift(entry);
  await writeFile(LOG, JSON.stringify(log.slice(0, 200), null, 2) + "\n", "utf8");
}

async function main() {
  const payload = ManualPayload.parse(JSON.parse(process.env.MANUAL_PAYLOAD ?? "{}"));
  const now = new Date();
  const nowIso = now.toISOString();

  if (payload.action === "unpublish") {
    const manual = await readManual(payload.date);
    const ev = manual.events.find((e) => e.id === payload.id);
    if (!ev) {
      console.log(`Nada que retirar: ${payload.id} no está en ${payload.date}.`);
      return;
    }
    manual.events = manual.events.filter((e) => e.id !== payload.id);
    await writeManual(manual);
    await rm(path.join(DOCS, "n", payload.id), { recursive: true, force: true });
    await appendLog({ action: "unpublish", id: payload.id, date: payload.date, title: ev.title, editor: payload.editor, at: nowIso });
    console.log(`Retirada: ${ev.title}`);
    return;
  }

  // Se publica en la edición que la web está mostrando ahora mismo, para que aparezca ya.
  const latest = await readLatest();
  const date = latest?.editionDate ?? asuncionDate(now);
  const manual = await readManual(date);
  const id = eventId(payload.event);
  const previous = manual.events.find((e) => e.id === id);
  const event = {
    ...payload.event,
    id,
    manual: true,
    model: null,
    image: payload.event.image ?? null,
    expiresAt: payload.event.expiresAt ?? null,
    firstSeenAt: previous?.firstSeenAt ?? nowIso,
    firstSlot: "manual",
    updatedAt: nowIso,
    updatedSlot: "manual",
  };
  event.score = Number(scoreEvent(event, now).toFixed(2));
  manual.events = [event, ...manual.events.filter((e) => e.id !== id)];
  await writeManual(manual);

  const template = await readFile(path.join(DOCS, "index.html"), "utf8");
  const dir = path.join(DOCS, "n", id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.html"), renderSharePage(template, event, date), "utf8");
  await appendLog({ action: "publish", id, date, title: event.title, editor: payload.editor, at: nowIso });
  console.log(`Publicada en la edición ${date}: ${event.title} (${id})`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
});
