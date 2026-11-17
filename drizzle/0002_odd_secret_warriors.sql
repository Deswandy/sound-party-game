CREATE TABLE `votes` (
	`round_id` text NOT NULL,
	`player_id` text NOT NULL,
	`clip_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`round_id`, `player_id`),
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `players` ADD `ready` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rounds` ADD `playback_index` integer DEFAULT -1 NOT NULL;