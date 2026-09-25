CREATE TABLE "site_underlays" (
	"plan_id" uuid PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"filename" text NOT NULL,
	"centre_x_cm" integer NOT NULL,
	"centre_y_cm" integer NOT NULL,
	"width_cm" integer NOT NULL,
	"rotation_tenths" integer DEFAULT 0 NOT NULL,
	"calibration" jsonb,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "site_underlays" ADD CONSTRAINT "site_underlays_plan_id_site_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."site_plans"("id") ON DELETE cascade ON UPDATE no action;