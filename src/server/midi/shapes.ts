import { z } from "@hono/zod-openapi";
import { isSafeId } from "@/server/midi/id";
import { findSource, midiSourceIds } from "@/server/midi/registry";

export const searchInputShape = {
  q: z.string().min(1).describe("Song or file name to look for"),
  source: z
    .enum(midiSourceIds)
    .optional()
    .describe("Restrict the search to a single source"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
};

export const infoInputShape = {
  source: z.enum(midiSourceIds).describe("Provider the id came from"),
  id: z.string().min(1).describe("The file's id within that source"),
  name: z.string().default("").describe("Name to report it under"),
};

export function sourceFileUrl(source: string, id: string): string | null {
  const provider = findSource(source);
  return provider === null || !isSafeId(id) ? null : provider.fileUrl(id);
}
