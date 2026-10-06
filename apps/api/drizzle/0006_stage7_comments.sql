CREATE TABLE "post_categories" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"admin_only" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_category_check";--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_comments_post" ON "post_comments" USING btree ("post_id","created_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('deploy_approved', 'deploy_rejected', 'mcp_build_succeeded', 'mcp_build_failed', 'mcp_approved', 'mcp_rejected', 'team_container_error', 'agent_assignment_changed', 'admin_review_requested', 'app_force_stopped', 'post_commented'));--> statement-breakpoint
INSERT INTO "post_categories" ("key", "label", "sort_order", "admin_only") VALUES
  ('notice', '공지', 0, true),
  ('question', '질문', 1, false),
  ('tip', '팁', 2, false),
  ('mcp_share', 'MCP 공유', 3, false),
  ('free', '자유게시판', 4, false)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
UPDATE "posts" SET "category" = 'free' WHERE "category" = 'app_share';
