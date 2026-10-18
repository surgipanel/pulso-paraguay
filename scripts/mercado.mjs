// Cotizaciones del día: baja la cotización de referencia del Banco Central del Paraguay (BCP)
// y el dólar interbancario (compra/venta) y escribe docs/data/mercado.json.
// Sin IA, sin claves. Corre en GitHub Actions cada dos horas en días hábiles (ver mercado.yml).
// Fuente pública y oficial; el robots.txt del BCP no impone restricciones.
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchText } from "../src/fetch.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "..", "docs", "data", "mercado.json");

const URL_MONEDAS = "https://www.bcp.gov.py/webapps/web/cotizacion/monedas";
const URL_FLUCTUANTE = "https://www.bcp.gov.py/webapps/web/cotizacion/referencial-fluctuante";

const WANTED = [
  { code: "USD", name: "Dólar estadounidense", short: "Dólar" },
  { code: "BRL", name: "Real brasileño", short: "Real" },
  { code: "ARS", name: "Peso argentino", short: "Peso arg." },
  { code: "EUR", name: "Euro", short: "Euro" },
];
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

const num = (s) => Number(String(s).replace(/\./g, "").replace(",", "."));
const rowsOf = (html) =>
  [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
// "16 DE OCTUBRE DEL 2026" → "2026-10-16"
function spanishDate(text) {
  const m = text.match(/(\d{1,2})\s+DE\s+([A-ZÁÉÍÓÚÑ]+)\s+DEL?\s+(\d{4})/i);
  if (!m) return null;
  const mes = MESES[m[2].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()];
  return mes ? `${m[3]}-${String(mes).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

async function referencia() {
  const { body } = await fetchText(URL_MONEDAS, { accept: "text/html" });
  const rows = rowsOf(body);
  const date = spanishDate(rows.find((r) => /PLANILLA DE COTIZACIONES/i.test(r)) ?? "");
  const rates = [];
  for (const w of WANTED) {
    const row = rows.find((r) => new RegExp(`\\b${w.code}\\b\\s+[\\d.,]+\\s+[\\d.,]+`).test(r));
    const m = row?.match(new RegExp(`\\b${w.code}\\b\\s+([\\d.,]+)\\s+([\\d.,]+)`));
    if (!m) throw new Error(`BCP: no se encontró la fila de ${w.code}`);
    rates.push({ code: w.code, name: w.name, short: w.short, gs: num(m[2]) });
  }
  return { date, rates };
}

async function interbancario() {
  const { body } = await fetchText(URL_FLUCTUANTE, { accept: "text/html" });
  const rows = rowsOf(body);
  const date = spanishDate(rows.find((r) => /COTIZACIONES DEL/i.test(r)) ?? "");
  // Preferir la fila "Cierre dd/mm"; si el día está en curso, la última fila horaria (acumulado).
  const cierre = rows.find((r) => /^Cierre\s+\d{2}\/\d{2}/i.test(r));
  const horaria = [...rows].reverse().find((r) => /^\d{2}:\d{2}\s+[\d.,]+\s+[\d.,]+/.test(r));
  const src = cierre ?? horaria;
  // Quitar la etiqueta inicial ("Cierre 16/10" u "09:00") para no confundir la fecha con un monto.
  const m = src?.replace(/^(Cierre\s+\d{2}\/\d{2}|\d{2}:\d{2})\s*/i, "").match(/^([\d.,]+)\s+([\d.,]+)/);
  if (!m) throw new Error("BCP: no se encontró compra/venta del dólar interbancario");
  return { date, compra: num(m[1]), venta: num(m[2]), label: cierre ? `cierre ${cierre.match(/\d{2}\/\d{2}/)[0]}` : `acumulado a las ${src.slice(0, 5)}` };
}

async function main() {
  const [ref, usd] = await Promise.all([referencia(), interbancario()]);
  const data = {
    updatedAt: new Date().toISOString(),
    source: { name: "Banco Central del Paraguay", url: URL_MONEDAS },
    date: ref.date,
    rates: ref.rates,
    usdInterbank: usd,
  };
  // No reescribir si solo cambió updatedAt: así el workflow no commitea sin novedades.
  try {
    const prev = JSON.parse(await readFile(OUT, "utf8"));
    const same = JSON.stringify({ ...prev, updatedAt: null }) === JSON.stringify({ ...data, updatedAt: null });
    if (same) { console.log(`Sin cambios (BCP ${data.date}).`); return; }
  } catch {}
  await writeFile(OUT, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`Cotizaciones BCP del ${data.date}: ${ref.rates.map((r) => `${r.code} ${r.gs}`).join(" · ")} · USD interbancario ${usd.compra}/${usd.venta} (${usd.label})`);
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
