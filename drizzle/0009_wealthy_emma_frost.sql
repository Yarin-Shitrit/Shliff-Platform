CREATE TABLE "acquisition_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"quantity_needed" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'buy_new' NOT NULL,
	"estimated_cost" numeric(12, 2),
	"actual_cost" numeric(12, 2),
	"assignee_person_id" uuid,
	"budget_line_id" uuid,
	"lender_person_id" uuid,
	"arrived_item_id" uuid,
	"status" text DEFAULT 'to_search' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"location_text" text,
	"condition" text DEFAULT 'ready' NOT NULL,
	"notes" text,
	"source_block_id" uuid,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "task_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"name" text NOT NULL,
	"quantity_needed" integer DEFAULT 1 NOT NULL,
	"inventory_item_id" uuid,
	"acquisition_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acquisition_items" ADD CONSTRAINT "acquisition_items_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_items" ADD CONSTRAINT "acquisition_items_assignee_person_id_persons_id_fk" FOREIGN KEY ("assignee_person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_items" ADD CONSTRAINT "acquisition_items_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_items" ADD CONSTRAINT "acquisition_items_lender_person_id_persons_id_fk" FOREIGN KEY ("lender_person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_items" ADD CONSTRAINT "acquisition_items_arrived_item_id_inventory_items_id_fk" FOREIGN KEY ("arrived_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_source_block_id_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_materials" ADD CONSTRAINT "task_materials_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_materials" ADD CONSTRAINT "task_materials_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_materials" ADD CONSTRAINT "task_materials_acquisition_item_id_acquisition_items_id_fk" FOREIGN KEY ("acquisition_item_id") REFERENCES "public"."acquisition_items"("id") ON DELETE set null ON UPDATE no action;