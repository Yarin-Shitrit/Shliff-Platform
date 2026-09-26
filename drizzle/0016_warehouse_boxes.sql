CREATE TABLE "inventory_boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"location_text" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "box_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_box_id_inventory_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."inventory_boxes"("id") ON DELETE set null ON UPDATE no action;