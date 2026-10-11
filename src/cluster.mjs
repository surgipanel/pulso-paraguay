// Agrupación de artículos que cubren el mismo acontecimiento.
// Primera pasada determinista: similitud léxica (TF-IDF) + nombres propios/cifras compartidos
// + palabras raras compartidas + cercanía temporal. La IA recibe estos grupos candidatos y puede
// dividirlos si mezclan hechos distintos; por eso en modo IA se agrupa con un poco más de soltura.
import { hoursBetween, strongTokens, tokens } from "./text.mjs";
import { majority, scopeHint } from "./heuristics.mjs";

const MAX_GAP_HOURS = 36;
const MAX_CLUSTER = 10;
const RARE_DF = 4; // una palabra es "rara" si aparece en 4 notas o menos del día

const THRESHOLDS = {
  conservative: { pure: 0.45, mid: 0.3, low: 0.25 }, // modo extractivo: nadie divide después
  liberal: { pure: 0.4, mid: 0.25, low: 0.2 }, // modo IA: la IA separa lo que no corresponda
};

function vectorize(article, df, n) {
  const counts = new Map();
  for (const t of tokens(article.title)) counts.set(t, (counts.get(t) ?? 0) + 2);
  for (const t of tokens(article.excerpt ?? "")) counts.set(t, (counts.get(t) ?? 0) + 1);
  let norm = 0;
  const vec = new Map();
  for (const [t, c] of counts) {
    const idf = Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;
    const w = (1 + Math.log(c)) * idf;
    vec.set(t, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of vec) vec.set(t, w / norm);
  return vec;
}

function cosine(a, b) {
  let s = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const [t, w] of small) {
    const v = big.get(t);
    if (v) s += w * v;
  }
  return s;
}

export function clusterArticles(articles, { liberal = false } = {}) {
  const T = liberal ? THRESHOLDS.liberal : THRESHOLDS.conservative;
  const n = articles.length;
  const df = new Map();
  const tokenSets = articles.map((a) => new Set([...tokens(a.title), ...tokens(a.excerpt ?? "")]));
  for (const set of tokenSets) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  const vecs = articles.map((a) => vectorize(a, df, n));
  // Nombres propios/cifras del título; la primera palabra cuenta solo si es poco frecuente.
  const strong = articles.map((a) => {
    const set = strongTokens(a.title);
    const first = tokens(a.title.split(/\s+/)[0] ?? "")[0];
    if (first && (df.get(first) ?? 0) <= 6) set.add(first);
    return set;
  });
  const rare = tokenSets.map((set) => new Set([...set].filter((t) => (df.get(t) ?? 0) <= RARE_DF && !/^\d{1,2}$/.test(t))));
  const dates = articles.map((a) => new Date(a.publishedAt));

  const parent = articles.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (hoursBetween(dates[i], dates[j]) > MAX_GAP_HOURS) continue;
      const cos = cosine(vecs[i], vecs[j]);
      if (cos < T.low) continue;
      let shared = 0;
      for (const t of strong[i]) if (strong[j].has(t)) shared++;
      let rareShared = 0;
      for (const t of rare[i]) if (rare[j].has(t)) rareShared++;
      const linked =
        cos >= T.pure ||
        (cos >= T.mid && (shared >= 1 || rareShared >= 1)) ||
        (cos >= T.low && shared >= 1 && rareShared >= 1);
      if (linked) pairs.push([cos + shared * 0.05 + rareShared * 0.03, i, j]);
    }
  }
  // Unir los pares más fuertes primero y no dejar crecer grupos gigantes (deriva temática).
  pairs.sort((a, b) => b[0] - a[0]);
  const size = new Map();
  for (const [, i, j] of pairs) {
    const a = find(i), b = find(j);
    if (a === b) continue;
    const sa = size.get(a) ?? 1, sb = size.get(b) ?? 1;
    if (sa + sb > MAX_CLUSTER) continue;
    parent[b] = a;
    size.set(a, sa + sb);
  }

  const groups = new Map();
  articles.forEach((a, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(a);
  });

  return [...groups.values()].map((members) => {
    members.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const sources = new Set(members.map((m) => m.sourceId));
    return {
      id: members.map((m) => m.id).sort().join("+").slice(0, 60),
      articles: members,
      sourceCount: sources.size,
      newestAt: members[0].publishedAt,
    };
  });
}

// Puntaje para ordenar grupos candidatos: más medios distintos, más notas, más reciente,
// y prioridad a lo que pasa en Paraguay.
export function scoreCluster(cluster, now = new Date()) {
  const ageH = hoursBetween(new Date(cluster.newestAt), now);
  const recency = Math.max(0, 2 - ageH / 12);
  const scope = majority(cluster.articles.map(scopeHint), "paraguay");
  const scopePenalty = scope === "internacional" ? -4 : 0;
  return cluster.sourceCount * 3 + Math.min(cluster.articles.length, 4) + recency + scopePenalty;
}
