// Persistencia en archivos JSON dentro de docs/data (lo que publica GitHub Pages).
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUN_LOG_KEEP } from "./config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(here, "..", "docs", "data");
export const EDITIONS_DIR = path.join(DATA_DIR, "editions");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export const editionPath = (date) => path.join(EDITIONS_DIR, `${date}.json`);

export async function readEdition(date) {
  return readJson(editionPath(date), null);
}

export async function writeEdition(edition) {
  await writeJson(editionPath(edition.date), edition);
}

export async function readLatest() {
  return readJson(path.join(DATA_DIR, "latest.json"), null);
}

export async function writeLatest(latest) {
  await writeJson(path.join(DATA_DIR, "latest.json"), latest);
}

export async function writeSources(report) {
  await writeJson(path.join(DATA_DIR, "sources.json"), report);
}

export async function readRuns() {
  return readJson(path.join(DATA_DIR, "runs.json"), []);
}

export async function appendRun(run) {
  const runs = await readRuns();
  runs.unshift(run);
  await writeJson(path.join(DATA_DIR, "runs.json"), runs.slice(0, RUN_LOG_KEEP));
}

export async function rebuildEditionIndex() {
  await mkdir(EDITIONS_DIR, { recursive: true });
  const files = (await readdir(EDITIONS_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const index = [];
  for (const f of files) {
    const ed = await readJson(path.join(EDITIONS_DIR, f), null);
    if (!ed) continue;
    index.push({
      date: ed.date,
      events: ed.events.length,
      generatedAt: ed.generatedAt,
      aiMode: ed.aiMode,
      headline: ed.events[0]?.title ?? null,
    });
  }
  index.sort((a, b) => (a.date < b.date ? 1 : -1));
  await writeJson(path.join(EDITIONS_DIR, "index.json"), index);
  return index;
}
