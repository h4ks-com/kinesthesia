ALTER TABLE `scores` ADD `speed` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `scores` ADD `simplified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `scores` ADD `melody_rate` integer;