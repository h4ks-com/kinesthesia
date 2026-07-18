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
    mode: text("mode", { enum: ["play", "battle"] }).notNull(),
    points: integer("points").notNull(),
    accuracy: real("accuracy").notNull(),
    bestCombo: integer("best_combo").notNull(),
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
