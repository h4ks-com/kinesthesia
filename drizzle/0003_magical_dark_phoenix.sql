CREATE TABLE `song_voicings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`tracks` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `song_voicings_author_song_idx` ON `song_voicings` (`author_id`,`source`,`url`);--> statement-breakpoint
CREATE INDEX `song_voicings_song_idx` ON `song_voicings` (`source`,`url`);