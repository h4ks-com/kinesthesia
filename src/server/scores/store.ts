import { mkdirSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "@/server/config";

export type ScoreRow = {
  readonly id: number;
  readonly player: string;
  readonly song: string;
  readonly url: string;
  readonly mode: string;
  readonly points: number;
  readonly accuracy: number;
  readonly bestCombo: number;
  readonly playedAt: number;
};

export type NewScore = Omit<ScoreRow, "id" | "playedAt">;

let cache: ScoreRow[] | null = null;

async function load(): Promise<ScoreRow[]> {
  if (cache !== null) {
    return cache;
  }
  try {
    cache = JSON.parse(
      await readFile(config.databasePath, "utf8"),
    ) as ScoreRow[];
  } catch {
    cache = [];
  }
  return cache;
}

/** Written to a sibling file and renamed so a crash mid write cannot leave a
 * half serialised leaderboard behind. */
async function persist(rows: readonly ScoreRow[]): Promise<void> {
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const staging = `${config.databasePath}.writing`;
  await writeFile(staging, JSON.stringify(rows), "utf8");
  await rename(staging, config.databasePath);
}

export async function saveScore(score: NewScore): Promise<ScoreRow> {
  const rows = await load();
  const row: ScoreRow = {
    ...score,
    id: rows.reduce((highest, current) => Math.max(highest, current.id), 0) + 1,
    playedAt: Date.now(),
  };
  rows.push(row);
  await persist(rows);
  return row;
}

export async function topScores(limit: number): Promise<ScoreRow[]> {
  const rows = await load();
  return [...rows]
    .sort((left, right) =>
      right.points === left.points
        ? left.playedAt - right.playedAt
        : right.points - left.points,
    )
    .slice(0, limit);
}

export async function scoresFor(url: string): Promise<ScoreRow[]> {
  return (await load()).filter((row) => row.url === url);
}
