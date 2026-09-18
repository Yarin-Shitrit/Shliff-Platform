ALTER TABLE "sheets" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sheets" ADD COLUMN "retired_by" text;