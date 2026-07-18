CREATE TABLE `scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` text NOT NULL,
	`player_name` text NOT NULL,
	`song` text NOT NULL,
	`url` text NOT NULL,
	`mode` text NOT NULL,
	`points` integer NOT NULL,
	`accuracy` real NOT NULL,
	`best_combo` integer NOT NULL,
	`played_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scores_points_idx` ON `scores` (`points`);--> statement-breakpoint
CREATE INDEX `scores_url_idx` ON `scores` (`url`);--> statement-breakpoint
CREATE INDEX `scores_player_idx` ON `scores` (`player_id`);