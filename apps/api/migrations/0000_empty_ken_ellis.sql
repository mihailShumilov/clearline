CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`kind` text NOT NULL,
	`data_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` text PRIMARY KEY NOT NULL,
	`fixture_id` integer NOT NULL,
	`predicate_json` text NOT NULL,
	`stake_lamports` text NOT NULL,
	`price_bps` integer NOT NULL,
	`status` text NOT NULL,
	`pnl_lamports` text NOT NULL,
	`claimed_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`position_id` text NOT NULL,
	`holds` integer NOT NULL,
	`source` text NOT NULL,
	`signature` text,
	`explorer_url` text,
	`root_pda` text,
	`program_id` text,
	`created_at_ms` integer NOT NULL
);
