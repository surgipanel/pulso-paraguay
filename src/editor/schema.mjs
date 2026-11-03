// Forma de lo que el panel de editor manda a publicar. La usan el panel (al enviar) y el script
// de GitHub (al recibir): lo que no cumple esto no se publica.
import { z } from "zod";
import { CATEGORY_IDS } from "../config.mjs";

const httpsUrl = z.string().max(2000).regex(/^https:\/\//, "debe empezar con https://");

export const ManualSource = z.object({
  sourceId: z.string().min(1).max(80),
  sourceName: z.string().min(1).max(120),
  title: z.string().min(1).max(400),
  url: httpsUrl,
  publishedAt: z.string().datetime({ offset: true }),
  image: httpsUrl.nullable().optional(),
});

export const ManualEvent = z.object({
  title: z.string().trim().min(5).max(200),
  summary: z.string().trim().min(40).max(5000),
  keyPoints: z.array(z.string().trim().min(1).max(400)).max(6),
  category: z.enum(CATEGORY_IDS),
  scope: z.enum(["paraguay", "internacional"]).default("paraguay"),
  // Sin fuentes: nota propia de la redacción, escrita desde cero en el panel.
  sources: z.array(ManualSource).max(12),
  // own: foto cargada por el editor (guardada en el diario), no tomada de una nota.
  image: z.object({ url: httpsUrl, credit: z.string().trim().min(1).max(120), articleUrl: httpsUrl.nullable().optional(), own: z.boolean().optional() }).nullable().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  summaryKind: z.enum(["ia", "extractivo", "editor"]).default("editor"),
});

export const ManualPayload = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish"), editor: z.string().max(80).default("Editor"), event: ManualEvent }),
  z.object({ action: z.literal("unpublish"), editor: z.string().max(80).default("Editor"), id: z.string().regex(/^ev-[a-z0-9]+$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
]);
