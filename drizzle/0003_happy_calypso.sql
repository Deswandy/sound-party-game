CREATE TABLE `hearsay_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`player_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`slot` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`storage_key` text,
	`mime_type` text,
	`submitted_at` integer,
	FOREIGN KEY (`round_id`) REFERENCES `hearsay_rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hearsay_assignment_player_scene_slot` ON `hearsay_assignments` (`round_id`,`player_id`,`scene_id`,`slot`);--> statement-breakpoint
CREATE TABLE `hearsay_avatars` (
	`player_id` text PRIMARY KEY NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`submitted_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hearsay_likes` (
	`matchup_id` text NOT NULL,
	`player_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`matchup_id`, `player_id`, `assignment_id`),
	FOREIGN KEY (`matchup_id`) REFERENCES `hearsay_matchups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignment_id`) REFERENCES `hearsay_assignments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hearsay_matchups` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`slot` integer NOT NULL,
	`sequence` integer NOT NULL,
	`winner_assignment_id` text,
	`runner_up_assignment_id` text,
	FOREIGN KEY (`round_id`) REFERENCES `hearsay_rounds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hearsay_matchup_scene_slot` ON `hearsay_matchups` (`round_id`,`scene_id`,`slot`);--> statement-breakpoint
CREATE TABLE `hearsay_minigame_tallies` (
	`round_id` text NOT NULL,
	`player_id` text NOT NULL,
	`tally` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`round_id`, `player_id`),
	FOREIGN KEY (`round_id`) REFERENCES `hearsay_rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hearsay_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`round_number` integer NOT NULL,
	`plan_json` text NOT NULL,
	`stage` text DEFAULT 'recording' NOT NULL,
	`current_matchup` integer DEFAULT -1 NOT NULL,
	`deadline_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hearsay_scores` (
	`player_id` text PRIMARY KEY NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`video_appearances` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hearsay_votes` (
	`matchup_id` text NOT NULL,
	`player_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`matchup_id`, `player_id`),
	FOREIGN KEY (`matchup_id`) REFERENCES `hearsay_matchups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignment_id`) REFERENCES `hearsay_assignments`(`id`) ON UPDATE no action ON DELETE no action
);
