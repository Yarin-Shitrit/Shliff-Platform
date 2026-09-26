ALTER TABLE "site_items" ADD COLUMN "facing" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Today a sofa taller than it is wide is drawn with its back on the west edge; keep that picture rather than swinging every turned sofa's back to the north.
UPDATE "site_items" SET "facing" = 3 WHERE "kind" IN ('sofa', 'armchair') AND "depth_cm" > "width_cm";
