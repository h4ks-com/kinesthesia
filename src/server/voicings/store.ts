import { and, desc, eq } from "drizzle-orm";
import { db, ready } from "@/server/db/client";
import { type SongVoicingRow, songVoicings } from "@/server/db/schema";

export type SongKey = {
  readonly source: string;
  readonly url: string;
};

export type SavedVoicing = {
  readonly authorId: string;
  readonly authorName: string;
  readonly tracks: string;
  readonly updatedAt: number;
};

function asSaved(row: SongVoicingRow): SavedVoicing {
  return {
    authorId: row.authorId,
    authorName: row.authorName,
    tracks: row.tracks,
    updatedAt: row.updatedAt,
  };
}

/** Everyone's version of this song, newest first, so a listener with none of
 * their own falls to whoever shaped it last. */
export async function voicingsFor(song: SongKey): Promise<SavedVoicing[]> {
  await ready();
  const rows = await db()
    .select()
    .from(songVoicings)
    .where(
      and(eq(songVoicings.source, song.source), eq(songVoicings.url, song.url)),
    )
    .orderBy(desc(songVoicings.updatedAt), desc(songVoicings.id));
  return rows.map(asSaved);
}

/** One saved version per person per song, so saving again replaces what they
 * had rather than piling up versions they cannot choose between. */
export async function saveVoicing(entry: {
  readonly authorId: string;
  readonly authorName: string;
  readonly song: SongKey;
  readonly tracks: string;
}): Promise<SavedVoicing> {
  await ready();
  const [saved] = await db()
    .insert(songVoicings)
    .values({
      authorId: entry.authorId,
      authorName: entry.authorName,
      source: entry.song.source,
      url: entry.song.url,
      tracks: entry.tracks,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: [songVoicings.authorId, songVoicings.source, songVoicings.url],
      set: {
        authorName: entry.authorName,
        tracks: entry.tracks,
        updatedAt: Date.now(),
      },
    })
    .returning();
  if (saved === undefined) {
    throw new Error("The voicing was not stored");
  }
  return asSaved(saved);
}

export async function deleteVoicing(
  authorId: string,
  song: SongKey,
): Promise<void> {
  await ready();
  await db()
    .delete(songVoicings)
    .where(
      and(
        eq(songVoicings.authorId, authorId),
        eq(songVoicings.source, song.source),
        eq(songVoicings.url, song.url),
      ),
    );
}
