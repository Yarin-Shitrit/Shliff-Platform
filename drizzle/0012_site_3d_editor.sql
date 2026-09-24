CREATE TABLE "site_kind_defaults" (
	"kind" text PRIMARY KEY NOT NULL,
	"width_cm" integer NOT NULL,
	"depth_cm" integer NOT NULL,
	"height_cm" integer NOT NULL,
	"inset_cm" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "site_items" ADD COLUMN "height_cm" integer;--> statement-breakpoint
ALTER TABLE "site_items" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "site_plans" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_plans" ADD COLUMN "north_deg" integer DEFAULT 0 NOT NULL;