CREATE TABLE "work_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"before_id" uuid NOT NULL,
	"after_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_dependencies_pair_key" UNIQUE("before_id","after_id")
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"topic_id" uuid,
	"parent_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"starts_on" text,
	"ends_on" text,
	"assignee_person_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "work_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_before_id_work_items_id_fk" FOREIGN KEY ("before_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_after_id_work_items_id_fk" FOREIGN KEY ("after_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_topic_id_work_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."work_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_parent_id_work_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_assignee_person_id_persons_id_fk" FOREIGN KEY ("assignee_person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_topics" ADD CONSTRAINT "work_topics_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;