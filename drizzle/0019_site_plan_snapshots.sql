CREATE TABLE "site_plan_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"name" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "site_plan_snapshots" ADD CONSTRAINT "site_plan_snapshots_plan_id_site_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."site_plans"("id") ON DELETE cascade ON UPDATE no action;