CREATE TABLE "agent_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT '🤖' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"spec" jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'previewed' NOT NULL,
	"file_name" text NOT NULL,
	"summary" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"baseline" text NOT NULL,
	"created_by" uuid,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_jobs_kind_check" CHECK ("import_jobs"."kind" in ('departments', 'users')),
	CONSTRAINT "import_jobs_status_check" CHECK ("import_jobs"."status" in ('previewed', 'applied', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "team_agents" (
	"team_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"applied_version" integer,
	"apply_status" text DEFAULT 'pending' NOT NULL,
	"apply_error" text,
	"applied_at" timestamp with time zone,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_agents_team_id_template_id_pk" PRIMARY KEY("team_id","template_id"),
	CONSTRAINT "team_agents_apply_status_check" CHECK ("team_agents"."apply_status" in ('pending', 'applied', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "usage_samples" (
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"cpu_pct" double precision NOT NULL,
	"mem_bytes" bigint NOT NULL,
	"mem_limit_bytes" bigint,
	"disk_bytes" bigint,
	"disk_limit_bytes" bigint
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "provision_stage" text DEFAULT 'name' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_agents" ADD CONSTRAINT "team_agents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_agents" ADD CONSTRAINT "team_agents_template_id_agent_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agent_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_samples_target_ts" ON "usage_samples" USING btree ("target_type","target_id","ts");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_provision_stage_check" CHECK ("teams"."provision_stage" in ('name', 'storage', 'container', 'default_mcp', 'done', 'failed'));--> statement-breakpoint
UPDATE "teams" SET "provision_stage" = 'done';
