#!/usr/bin/env node
// Une dos versiones de docs/data/social.json sin perder registros.
// Uso: node scripts/merge-social.mjs <local.json> <remoto.json>   → escribe el resultado en <remoto.json>
// Se usa en el workflow cuando otra corrida publicó entre medio: nunca se pierde un post registrado,
// porque perder un registro hace que una corrida posterior vuelva a publicar la misma noticia.
import { readFile, writeFile } from "node:fs/promises";

const [localPath, remotePath] = process.argv.slice(2);
if (!localPath || !remotePath) {
  console.error("uso: merge-social.mjs <local.json> <remoto.json>");
  process.exit(1);
}
const read = async (p) => {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return { posts: [] }; }
};
const local = await read(localPath);
const remote = await read(remotePath);
const key = (p) => p.tweetId || `${p.eventId}|${p.at}`;
const byKey = new Map();
for (const p of [...(remote.posts ?? []), ...(local.posts ?? [])]) byKey.set(key(p), p);
const posts = [...byKey.values()].sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? ""))).slice(-400);
const merged = { ...remote, ...local, posts, updatedAt: new Date().toISOString() };
await writeFile(remotePath, JSON.stringify(merged, null, 2) + "\n");
console.log(`social.json unido: ${remote.posts?.length ?? 0} remotos + ${local.posts?.length ?? 0} locales → ${posts.length}`);
