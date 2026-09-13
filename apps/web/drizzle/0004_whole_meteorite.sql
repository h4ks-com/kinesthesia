DROP INDEX `song_voicings_author_song_idx`;--> statement-breakpoint
DROP INDEX `song_voicings_song_idx`;--> statement-breakpoint
-- One song used to be one row per provider it was opened from, so a person can
-- hold several rows the new index allows only one of. The newest is the one
-- they last heard, and the rest have to go before the index can be built.
DELETE FROM `song_voicings` WHERE EXISTS (
	SELECT 1 FROM `song_voicings` AS newer
	WHERE newer.`author_id` = `song_voicings`.`author_id`
		AND newer.`url` = `song_voicings`.`url`
		AND (newer.`updated_at`, newer.`id`) > (`song_voicings`.`updated_at`, `song_voicings`.`id`)
);--> statement-breakpoint
CREATE UNIQUE INDEX `song_voicings_author_song_idx` ON `song_voicings` (`author_id`,`url`);--> statement-breakpoint
CREATE INDEX `song_voicings_song_idx` ON `song_voicings` (`url`);--> statement-breakpoint
ALTER TABLE `song_voicings` DROP COLUMN `source`;
