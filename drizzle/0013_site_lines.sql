CREATE TABLE "site_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"from_item_id" uuid NOT NULL,
	"to_item_id" uuid NOT NULL,
	"points_cm" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "site_lines" ADD CONSTRAINT "site_lines_plan_id_site_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."site_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_lines" ADD CONSTRAINT "site_lines_from_item_id_site_items_id_fk" FOREIGN KEY ("from_item_id") REFERENCES "public"."site_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_lines" ADD CONSTRAINT "site_lines_to_item_id_site_items_id_fk" FOREIGN KEY ("to_item_id") REFERENCES "public"."site_items"("id") ON DELETE cascade ON UPDATE no action;