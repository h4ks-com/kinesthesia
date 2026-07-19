import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const workspace = mkdtempSync(join(tmpdir(), "kinesthesia-voicings-"));
process.env.DATABASE_URL = `file:${join(workspace, "test.db")}`;

const { deleteVoicing, saveVoicing, voicingsFor } = await import(
  "@/server/voicings/store"
);

const song = { source: "bitmidi", url: "https://example.test/a.mid" };
const other = { source: "", url: "https://example.test/b.mid" };
const tracks = JSON.stringify({ 0: { program: 40 } });

beforeAll(async () => {
  await deleteVoicing("ana", song);
  await deleteVoicing("bo", song);
});

afterAll(() => rmSync(workspace, { recursive: true, force: true }));

describe("saveVoicing", () => {
  it("keeps one version per person per song", async () => {
    await saveVoicing({
      authorId: "ana",
      authorName: "Ana",
      song,
      tracks,
    });
    await saveVoicing({
      authorId: "ana",
      authorName: "Ana",
      song,
      tracks: JSON.stringify({ 0: { program: 56 } }),
    });

    const saved = await voicingsFor(song);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.tracks).toContain("56");
  });

  it("keeps everyone else's beside it, newest first", async () => {
    await saveVoicing({ authorId: "bo", authorName: "Bo", song, tracks });

    const saved = await voicingsFor(song);
    expect(saved).toHaveLength(2);
    expect(saved[0]?.authorName).toBe("Bo");
  });

  it("counts a bare url as its own song", async () => {
    await saveVoicing({
      authorId: "ana",
      authorName: "Ana",
      song: other,
      tracks,
    });

    expect(await voicingsFor(other)).toHaveLength(1);
    expect(await voicingsFor(song)).toHaveLength(2);
  });
});

describe("deleteVoicing", () => {
  it("drops only that person's", async () => {
    await deleteVoicing("ana", song);

    const saved = await voicingsFor(song);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.authorName).toBe("Bo");
  });
});
