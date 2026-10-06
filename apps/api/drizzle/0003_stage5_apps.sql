CREATE TABLE "app_versions" (
	"app_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot_path" text NOT NULL,
	"request_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_versions_app_id_version_pk" PRIMARY KEY("app_id","version")
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"creator_id" uuid,
	"slug" text NOT NULL,
	"source_space" text DEFAULT 'shared' NOT NULL,
	"source_path" text NOT NULL,
	"run_spec" jsonb NOT NULL,
	"resource_limits" jsonb,
	"work_status" text DEFAULT 'stopped' NOT NULL,
	"work_stop_reason" text,
	"work_status_detail" text,
	"work_container_id" text,
	"work_last_accessed_at" timestamp with time zone,
	"work_started_at" timestamp with time zone,
	"public_name" text,
	"public_version" integer,
	"public_status" text,
	"public_stop_reason" text,
	"public_status_detail" text,
	"public_container_id" text,
	"public_snapshot_path" text,
	"public_published_at" timestamp with time zone,
	"public_approved_by" uuid,
	"public_last_accessed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apps_work_status_check" CHECK ("apps"."work_status" in ('starting', 'running', 'stopped', 'error')),
	CONSTRAINT "apps_public_status_check" CHECK ("apps"."public_status" is null or "apps"."public_status" in ('starting', 'running', 'stopped', 'error')),
	CONSTRAINT "apps_work_stop_reason_check" CHECK ("apps"."work_stop_reason" is null or "apps"."work_stop_reason" in ('idle', 'limit', 'manual')),
	CONSTRAINT "apps_public_stop_reason_check" CHECK ("apps"."public_stop_reason" is null or "apps"."public_stop_reason" in ('idle', 'manual', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "deploy_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"requested_by" uuid,
	"requested_name" text,
	"reason" text NOT NULL,
	"from_version" integer,
	"diff_summary" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"approved_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deploy_requests_kind_check" CHECK ("deploy_requests"."kind" in ('publish', 'update')),
	CONSTRAINT "deploy_requests_status_check" CHECK ("deploy_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "app_versions" ADD CONSTRAINT "app_versions_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_requests" ADD CONSTRAINT "deploy_requests_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "apps_team_slug" ON "apps" USING btree ("team_id","slug") WHERE "apps"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "apps_team_source" ON "apps" USING btree ("team_id","source_space","source_path") WHERE "apps"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "deploy_requests_one_pending" ON "deploy_requests" USING btree ("app_id") WHERE "deploy_requests"."status" = 'pending';