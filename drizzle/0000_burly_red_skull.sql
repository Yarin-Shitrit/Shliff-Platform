CREATE TABLE "block_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" uuid NOT NULL,
	"column_map" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_mappings_block_id_key" UNIQUE("block_id")
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_id" uuid NOT NULL,
	"top" integer NOT NULL,
	"left" integer NOT NULL,
	"bottom" integer NOT NULL,
	"right" integer NOT NULL,
	"archetype" text NOT NULL,
	"confidence" numeric NOT NULL,
	"header_row" integer,
	"fingerprint" text,
	"pipeline_version" integer NOT NULL,
	"raw_grid" jsonb NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "layout_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"archetype" text NOT NULL,
	"column_map" jsonb NOT NULL,
	"pipeline_version" integer NOT NULL,
	"confirmed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layout_signatures_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE "sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"name" text NOT NULL,
	"index" integer NOT NULL,
	"row_count" integer NOT NULL,
	"col_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
ALTER TABLE "block_mappings" ADD CONSTRAINT "block_mappings_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_sheet_id_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;