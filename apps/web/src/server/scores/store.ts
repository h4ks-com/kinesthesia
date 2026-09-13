import { avg, count, desc, eq, max, sum } from "drizzle-orm";
import { db, ready } from "@/server/db/client";
import { type NewScore, type Score, scores } from "@/server/db/schema";

export type { NewScore, Score };

export async function saveScore(score: NewScore): Promise<Score> {
  await ready();
  const [saved] = await db().insert(scores).values(score).returning();
  if (saved === undefined) {
    throw new Error("The score was not stored");
  }
  return saved;
}

export async function topScores(limit: number): Promise<Score[]> {
  await ready();
  return db()
    .select()
    .from(scores)
    .orderBy(desc(scores.points), scores.playedAt)
    .limit(limit);
}

export type PlayerStats = {
  readonly runs: number;
  readonly points: number;
  readonly bestCombo: number;
  readonly accuracy: number;
};

export async function statsFor(playerId: string): Promise<PlayerStats> {
  await ready();
  const [row] = await db()
    .select({
      runs: count(),
      points: sum(scores.points),
      bestCombo: max(scores.bestCombo),
      accuracy: avg(scores.accuracy),
    })
    .from(scores)
    .where(eq(scores.playerId, playerId));

  return {
    runs: row?.runs ?? 0,
    points: Number(row?.points ?? 0),
    bestCombo: Number(row?.bestCombo ?? 0),
    accuracy: Number(row?.accuracy ?? 1),
  };
}

export async function scoresForSong(
  url: string,
  limit: number,
): Promise<Score[]> {
  await ready();
  return db()
    .select()
    .from(scores)
    .where(eq(scores.url, url))
    .orderBy(desc(scores.points))
    .limit(limit);
}
