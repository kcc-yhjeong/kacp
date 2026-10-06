CREATE TABLE "mcp_installs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"source" text NOT NULL,
	"package_id" uuid,
	"version_id" uuid,
	"manual_name" text,
	"manual_url" text,
	"server_key" text NOT NULL,
	"status" text DEFAULT 'installing' NOT NULL,
	"status_detail" text,
	"secret_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"installed_by" uuid,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_installs_source_check" CHECK ("mcp_installs"."source" in ('default', 'market', 'manual')),
	CONSTRAINT "mcp_installs_status_check" CHECK ("mcp_installs"."status" in ('installing', 'installed', 'error', 'removing'))
);
--> statement-breakpoint
CREATE TABLE "mcp_packages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid,
	"display_name" text NOT NULL,
	"summary" text NOT NULL,
	"category" text NOT NULL,
	"icon" text,
	"status" text DEFAULT 'active' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_platform" boolean DEFAULT false NOT NULL,
	"latest_version_id" uuid,
	"install_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_packages_name_unique" UNIQUE("name"),
	CONSTRAINT "mcp_packages_status_check" CHECK ("mcp_packages"."status" in ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "mcp_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"package_id" uuid NOT NULL,
	"version" text NOT NULL,
	"uploaded_by" uuid,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"failed_stage" text,
	"status_detail" text,
	"stage_at" timestamp with time zone DEFAULT now() NOT NULL,
	"manifest" jsonb NOT NULL,
	"readme" text DEFAULT '' NOT NULL,
	"tools" jsonb,
	"scan_summary" jsonb,
	"scan_findings" jsonb,
	"image_ref" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_versions_status_check" CHECK ("mcp_versions"."status" in ('uploaded', 'validating', 'building', 'scanning', 'testing', 'in_review', 'published', 'failed', 'rejected', 'superseded')),
	CONSTRAINT "mcp_versions_failed_stage_check" CHECK ("mcp_versions"."failed_stage" is null or "mcp_versions"."failed_stage" in ('validate', 'build', 'scan', 'test'))
);
--> statement-breakpoint
ALTER TABLE "mcp_installs" ADD CONSTRAINT "mcp_installs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_installs" ADD CONSTRAINT "mcp_installs_package_id_mcp_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."mcp_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_installs" ADD CONSTRAINT "mcp_installs_version_id_mcp_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."mcp_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_packages" ADD CONSTRAINT "mcp_packages_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_versions" ADD CONSTRAINT "mcp_versions_package_id_mcp_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."mcp_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_installs_team_key" ON "mcp_installs" USING btree ("team_id","server_key");--> statement-breakpoint
CREATE INDEX "mcp_installs_package" ON "mcp_installs" USING btree ("package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_versions_package_version" ON "mcp_versions" USING btree ("package_id","version");--> statement-breakpoint
CREATE INDEX "mcp_versions_status" ON "mcp_versions" USING btree ("status","created_at");