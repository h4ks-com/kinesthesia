import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const scores = sqliteTable(
  "scores",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playerId: text("player_id").notNull(),
    playerName: text("player_name").notNull(),
    song: text("song").notNull(),
    url: text("url").notNull(),
    mode: text("mode", { enum: ["learn", "battle", "coop"] }).notNull(),
    points: integer("points").notNull(),
    accuracy: real("accuracy").notNull(),
    bestCombo: integer("best_combo").notNull(),
    /** What the run was worth: the same song scores differently at half speed
     * or reduced to one note, so a leaderboard needs the settings beside it. */
    speed: real("speed").notNull().default(1),
    simplified: integer("simplified", { mode: "boolean" })
      .notNull()
      .default(false),
    melodyRate: integer("melody_rate"),
    /** A battle records how it went against the other player, so a public
     * win-loss record can be built from these rows; a co-op leaves outcome
     * empty and just keeps the other player's points beside it. */
    outcome: text("outcome", { enum: ["win", "loss", "draw"] }),
    opponentPoints: integer("opponent_points"),
    playedAt: integer("played_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("scores_points_idx").on(table.points),
    index("scores_url_idx").on(table.url),
    index("scores_player_idx").on(table.playerId),
  ],
);

export type Score = typeof scores.$inferSelect;
export type NewScore = typeof scores.$inferInsert;

/** How a song is made to sound, as one document per person per song: it is
 * always read and written whole, and the unique index is what keeps a person
 * to a single saved version they can come back to. */
export const songVoicings = sqliteTable(
  "song_voicings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    authorId: text("author_id").notNull(),
    authorName: text("author_name").notNull(),
    /** Empty for a bare URL: SQLite counts NULLs as distinct, so a nullable
     * column here would let one person keep several rows for one song. */
    source: text("source").notNull().default(""),
    url: text("url").notNull(),
    /** A voicing per track index, as JSON. */
    tracks: text("tracks").notNull(),
    updatedAt: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("song_voicings_author_song_idx").on(
      table.authorId,
      table.source,
      table.url,
    ),
    index("song_voicings_song_idx").on(table.source, table.url),
  ],
);

export type SongVoicingRow = typeof songVoicings.$inferSelect;
export type NewSongVoicingRow = typeof songVoicings.$inferInsert;
