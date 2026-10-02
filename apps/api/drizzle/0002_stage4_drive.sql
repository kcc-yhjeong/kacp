CREATE TABLE "drive_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"space" text NOT NULL,
	"owner_user_id" uuid,
	"path" text NOT NULL,
	"prev_path" text,
	"action" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_events_space_check" CHECK ("drive_events"."space" in ('me', 'shared')),
	CONSTRAINT "drive_events_action_check" CHECK ("drive_events"."action" in ('create', 'update', 'rename', 'move', 'copy', 'trash', 'restore', 'delete')),
	CONSTRAINT "drive_events_actor_check" CHECK ("drive_events"."actor_kind" in ('user', 'agent', 'system'))
);
--> statement-breakpoint
CREATE TABLE "trash_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"space" text NOT NULL,
	"owner_user_id" uuid,
	"original_path" text NOT NULL,
	"is_dir" boolean NOT NULL,
	"size_bytes" bigint NOT NULL,
	"deleted_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone NOT NULL,
	CONSTRAINT "trash_items_space_check" CHECK ("trash_items"."space" in ('me', 'shared'))
);
--> statement-breakpoint
CREATE INDEX "drive_events_path" ON "drive_events" USING btree ("team_id","space","path");--> statement-breakpoint
CREATE INDEX "trash_items_team" ON "trash_items" USING btree ("team_id");