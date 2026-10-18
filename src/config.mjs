// Configuración central. Todo lo que afecta el comportamiento editorial vive acá.
import { env } from "node:process";

export const TIMEZONE = "America/Asuncion";

export const MAX_EVENTS_PER_DAY = clampInt(env.PULSO_MAX_EVENTS, 1, 50, 50);

// Ventana de recencia: un artículo entra a la edición del día si fue publicado
// dentro de estas horas antes de la corrida. 05:00 del día D cubre la tarde/noche de D-1.
export const WINDOW_HOURS = 24;

// Si un feed no tiene ninguna nota dentro de esta ventana, se considera "viejo"
// y no aporta artículos a la edición (aunque la conexión funcione).
export const STALE_HOURS = 48;

// Cuántos grupos candidatos (ordenados por relevancia) se mandan a la IA en cada corrida.
export const MAX_CLUSTERS_TO_AI = 60;
export const CLUSTERS_PER_AI_CALL = 6;

// Resumen: límites en palabras.
export const SUMMARY_MIN_WORDS = 40;
export const SUMMARY_MAX_WORDS = 70;

export const CATEGORIES = [
  { id: "pais", label: "País" },
  { id: "politica", label: "Política" },
  { id: "internacional", label: "Internacional" },
  { id: "economia", label: "Economía" },
  { id: "deportes", label: "Deportes" },
  { id: "cultura", label: "Cultura" },
  { id: "tecnologia", label: "Tecnología" },
];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

// Máximo de acontecimientos de una misma categoría (para que la portada no sea solo deportes).
export const MAX_PER_CATEGORY = 12;

// Mínimo que se intenta cubrir en cada sección: cultura o tecnología rara vez son las notas
// más cubiertas, así que sin reserva quedarían vacías. Se aplica al elegir qué grupos se
// redactan (SELECT_MIN) y al decidir qué entra en la edición (EDITION_MIN).
export const SELECT_MIN_PER_CATEGORY = 5;
export const EDITION_MIN_PER_CATEGORY = 4;

export const AI_MODEL = env.PULSO_MODEL || "claude-haiku-5-5";
export const AI_MODE = (env.PULSO_AI_MODE || "auto").toLowerCase(); // auto | off

export const USER_AGENT =
  "Mozilla/5.0 (compatible; ElProcer/0.2; +https://elprocer.com.py ; diario digital que agrupa noticias con enlace a la fuente)";

export const FETCH_TIMEOUT_MS = 25_000;
export const FETCH_RETRIES = 2;

// Evitar corridas duplicadas: si ya hubo una corrida exitosa del mismo turno en la misma
// edición hace menos de estas horas, la corrida se salta (salvo --force).
export const DUPLICATE_RUN_GUARD_HOURS = 3;

export const RUN_LOG_KEEP = 80;

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
