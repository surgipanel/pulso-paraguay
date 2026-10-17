// Registro de medios. Verificado a mano el 11/10/2026 y revisado el 17/10/2026: solo se listan URLs que respondieron.
// kind: "rss" | "atom" | "news-sitemap" | "portada"
//   portada → el medio no expone feed ni sitemap con notas del día; se leen los enlaces de su
//             portada (fecha en la URL) y la cabecera pública de cada nota. Nunca el artículo.
// enrich: "og-description" → el feed trae solo título; se lee la meta description de la nota
//         (una petición por nota, con pausa, respetando crawl-delay del robots.txt).
//         "og-image" → el feed trae texto pero no imagen; se lee solo la imagen.
export const SOURCES = [
  {
    id: "abc",
    name: "ABC Color",
    homepage: "https://www.abc.com.py",
    kind: "rss",
    url: "https://www.abc.com.py/arc/outboundfeeds/rss/?outputType=xml",
    region: "nacional",
  },
  {
    id: "lanacion",
    name: "La Nación",
    homepage: "https://www.lanacion.com.py",
    kind: "rss",
    url: "https://www.lanacion.com.py/arc/outboundfeeds/rss/?outputType=xml",
    region: "nacional",
  },
  {
    id: "ultimahora",
    name: "Última Hora",
    homepage: "https://www.ultimahora.com",
    kind: "news-sitemap",
    url: "https://www.ultimahora.com/news-sitemap.xml",
    enrich: "og-description",
    crawlDelayMs: 10_000, // robots.txt: Crawl-delay: 10
    maxEnrich: 10,
    region: "nacional",
    note: "No publica RSS; se usa su sitemap de noticias (título + fecha) y la descripción pública de cada nota.",
  },
  {
    id: "elnacional",
    name: "El Nacional",
    homepage: "https://elnacional.com.py",
    kind: "rss",
    url: "https://elnacional.com.py/feed/",
    region: "nacional",
  },
  {
    id: "adn",
    name: "ADN Digital",
    homepage: "https://www.adndigital.com.py",
    kind: "rss",
    url: "https://www.adndigital.com.py/feed/",
    enrich: "og-image",
    crawlDelayMs: 1500,
    maxEnrich: 10,
    region: "Alto Paraná",
  },
  {
    id: "npy",
    name: "NPY",
    homepage: "https://www.npy.com.py",
    kind: "rss",
    url: "https://www.npy.com.py/index.rss",
    enrich: "og-image",
    crawlDelayMs: 10_000, // robots.txt: Crawl-delay: 10
    maxEnrich: 10,
    region: "nacional",
    note: "El feed está al día con su web (coincide con su sitemap de noticias); publica pocas notas por día y a veces ninguna el fin de semana.",
  },
  {
    id: "telefuturo",
    name: "Telefuturo",
    homepage: "https://www.telefuturo.com.py",
    kind: "atom",
    url: "https://www.telefuturo.com.py/index.atom",
    enrich: "og-image",
    crawlDelayMs: 10_000, // robots.txt: Crawl-delay: 10
    maxEnrich: 10,
    region: "nacional",
    note: "El feed está al día con su web (coincide con su sitemap de noticias); publica pocas notas por día y a veces ninguna el fin de semana.",
  },
  {
    id: "vanguardia",
    name: "Vanguardia",
    homepage: "https://www.diariovanguardia.com.py",
    kind: "rss",
    url: "https://www.diariovanguardia.com.py/feed/",
    enrich: "og-image",
    crawlDelayMs: 1500,
    maxEnrich: 10,
    region: "Ciudad del Este",
    note: "El feed está al día con su portada; publica unas 10 notas por día hábil y suele no publicar los fines de semana.",
  },
  {
    id: "hoy",
    name: "HOY",
    homepage: "https://www.hoy.com.py",
    kind: "portada",
    url: "https://www.hoy.com.py/",
    crawlDelayMs: 2000, // robots.txt: Allow: / sin Crawl-delay
    maxEnrich: 12,
    region: "nacional",
    note: "Su RSS y sus sitemaps quedaron congelados en diciembre de 2023 (cambio de sistema). Se leen los enlaces con fecha de su portada y la cabecera pública de cada nota (descripción, imagen y hora de publicación).",
  },
  {
    id: "ip",
    name: "Agencia IP (Medios del Estado)",
    homepage: "https://mediosdelestado.gov.py",
    kind: "rss",
    url: "https://mediosdelestado.gov.py/feed/",
    region: "nacional",
    note: "La Agencia IP dejó de publicar en ip.gov.py en agosto de 2026 y pasó a mediosdelestado.gov.py (portal de los medios públicos). Publica pocas notas por semana.",
  },
  {
    id: "5dias",
    name: "5Días",
    homepage: "https://5dias.com.py",
    kind: "news-sitemap",
    url: "https://5dias.com.py/sitemap-latest.xml",
    enrich: "og-description",
    crawlDelayMs: 2000, // robots.txt sin restricciones ni Crawl-delay
    maxEnrich: 10,
    region: "nacional",
    note: "No publica RSS; se usa su sitemap de noticias (título + fecha) y la descripción pública de cada nota. Diario económico: no suele publicar los fines de semana.",
  },
];

export function sourceById(id) {
  return SOURCES.find((s) => s.id === id);
}
