import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const directory = mkdtempSync(join(tmpdir(), "kinesthesia-"));
process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;

const { saveScore, scoresForSong, topScores } = await import(
  "@/server/scores/store"
);

const run = {
  playerId: "user-1",
  playerName: "Ada",
  song: "A Song",
  url: "https://example.test/a.mid",
  mode: "learn" as const,
  points: 100,
  accuracy: 0.9,
  bestCombo: 10,
};

beforeAll(async () => {
  await saveScore(run);
  await saveScore({ ...run, playerName: "Grace", points: 300, bestCombo: 30 });
  await saveScore({
    ...run,
    playerName: "Alan",
    points: 200,
    url: "https://example.test/b.mid",
  });
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("score store", () => {
  it("migrates and stores a run", async () => {
    const stored = await saveScore({ ...run, playerName: "Edsger" });
    expect(stored.id).toBeGreaterThan(0);
    expect(stored.playerName).toBe("Edsger");
    expect(stored.playedAt).toBeGreaterThan(0);
  });

  it("ranks the leaderboard by points", async () => {
    const top = await topScores(3);
    expect(top[0]?.playerName).toBe("Grace");
    expect(top[0]?.points).toBe(300);
    expect(top.map((row) => row.points)).toEqual(
      [...top.map((row) => row.points)].sort((a, b) => b - a),
    );
  });

  it("respects the limit", async () => {
    expect(await topScores(2)).toHaveLength(2);
  });

  it("filters by song", async () => {
    const forSong = await scoresForSong("https://example.test/b.mid", 10);
    expect(forSong).toHaveLength(1);
    expect(forSong[0]?.playerName).toBe("Alan");
  });
});
