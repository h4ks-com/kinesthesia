import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const scores = sqliteTable(
  "scores",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playerId: text("player_id").notNull(),
    playerName: text("player_name").notNull(),
    song: text("song").notNull(),
    url: text("url").notNull(),
    mode: text("mode", { enum: ["learn", "battle"] }).notNull(),
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
    /** A battle also records how it went against the other player, so a public
     * win-loss record can be built from these rows. */
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
