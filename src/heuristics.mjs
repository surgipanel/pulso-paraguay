// Heurísticas sin IA: categoría y alcance (Paraguay / internacional) a partir de la URL y el texto.
// Se usan en el modo extractivo y para priorizar qué grupos se mandan a redactar.
import { fold } from "./text.mjs";

const URL_CATEGORY = [
  [/\/(politica|judiciales|congreso|senado|diputados)\//, "politica"],
  [/\/(economia|negocios|finanzas|empresas|agro|mercado|campo)\//, "economia"],
  [/\/(deportes|futbol|polideportivo|motor)\//, "deportes"],
  [/\/(espectaculos|cultura|arte|musica|cine|tv|farandula|gente|vida|tendencias|artes-y-espectaculos)\//, "cultura"],
  [/\/(tecnologia|ciencia|ciencia-y-tecnologia|tech|innovacion)\//, "tecnologia"],
  [/\/(mundo|internacional|internacionales|world|america-latina|latinoamerica)\//, "internacional"],
  [/\/(nacionales|pais|locales|sociedad|policiales|sucesos|interior|salud|comunidad)\//, "pais"],
];

const KEYWORD_CATEGORY = [
  ["deportes", /\b(gol|goles|partido|futbol|olimpia|cerro porteno|libertad|guarani|seleccion|albirroja|copa|liga|campeonato|torneo|tenis|basquet|atleta|mundial|conmebol|apf|maraton|gran premio|nba|nfl)\b/],
  ["politica", /\b(senado|senador|senadora|diputad\w+|camara|congreso|ley|proyecto de ley|ministro|ministra|presidente pena|santiago pena|gobierno|partido colorado|anr|plra|intendente|municipalidad|fiscalia|fiscal|juez|jueza|tribunal|corte suprema|justicia|elecciones|tse|imputad\w+|prision preventiva)\b/],
  ["economia", /\b(dolar|guaranies|inflacion|bcp|banco central|exportacion|importacion|soja|carne|ganader\w+|precio|precios|inversion|pib|economia|empresa|empresas|mercado|impuesto|aduana|dnit|salario|combustible|petropar|ande|tarifa|produccion|cosecha)\b/],
  ["tecnologia", /\b(tecnologia|inteligencia artificial|aplicacion|app|software|internet|conectividad|ciber\w*|hackeo|digital|satelite|starlink|celular|telefonia|5g|ciencia|cientific\w+)\b/],
  ["cultura", /\b(festival|concierto|museo|teatro|cine|pelicula|serie|musica|cantante|artista|exposicion|libro|feria|cultura|folklore|polca|guarania|miss|carnaval|espectaculo|ceramista|poesia)\b/],
];

function rawCategory(article) {
  const url = fold(article.url ?? "");
  for (const [re, cat] of URL_CATEGORY) if (re.test(url)) return cat;
  const text = fold(`${article.title} ${article.excerpt ?? ""}`);
  for (const [cat, re] of KEYWORD_CATEGORY) if (re.test(text)) return cat;
  return "pais";
}

// País y Política son solo Paraguay: un hecho de otro país en esas secciones pasa a Internacional.
// Deportes, economía, cultura y tecnología admiten hechos nacionales e internacionales.
export function categoryHint(article) {
  const cat = rawCategory(article);
  const foreign = scopeHint(article) === "internacional";
  if (cat === "internacional") return foreign ? "internacional" : "pais";
  if ((cat === "pais" || cat === "politica") && foreign) return "internacional";
  return cat;
}

export function clusterCategory(cluster) {
  return majority(cluster.articles.map(categoryHint), "pais");
}

const PY_STRONG = /\b(paraguay\w*|asuncion|guarani\w*|albirroja|itaipu|yacyreta|santiago pena|senado paraguayo|congreso nacional|bcp|petropar|essap|dnit|tacumbu|caacupe|ciudad del este|encarnacion|luque|lambare|capiata|san lorenzo|fernando de la mora|mariano roque alonso|nemby|villarrica|coronel oviedo|pedro juan caballero|caaguazu|concepcion|chaco paraguayo|alto parana|san pedro|cordillera|itapua|canindeyu|amambay|misiones|neembucu|boqueron|presidente hayes|cerro porteno|olimpia|club libertad|club guarani|club nacional|sportivo|apf|cartes|pena pide|ips)\b/;
const FOREIGN = /\b(espana|argentina|brasil|eeuu|estados unidos|trump|macron|rusia|ucrania|panama|peru|chile|uruguay|bolivia|mexico|colombia|venezuela|china|europa|union europea|nfl|nba|premier league|laliga|anfield|chicago|singapur|formula 1|f1|atp|wta|madrid|barcelona|buenos aires|lima|bogota|santiago de chile|washington|nueva york|israel|gaza|iran|otan|vaticano|papa leon|el papa|roma|italia|francia|alemania|reino unido|londres|japon|putin|zelenski|milei|lula|sanchez|eagles|real madrid|barca|psg|bayern|manchester|liverpool|inter|milan|juventus|boca|river)\b/;

export function scopeHint(article) {
  const url = fold(article.url ?? "");
  const text = fold(`${article.title} ${article.excerpt ?? ""}`);
  const local = PY_STRONG.test(text);
  if (/\/(mundo|internacional(es)?|world)\//.test(url)) return local ? "paraguay" : "internacional";
  if (!local && FOREIGN.test(text)) return "internacional";
  return "paraguay";
}

export function majority(values, fallback) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}
