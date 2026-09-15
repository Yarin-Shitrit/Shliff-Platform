ALTER TABLE "sheets" ADD COLUMN "season_id" uuid;--> statement-breakpoint
ALTER TABLE "sheets" ADD COLUMN "authoritative" boolean;--> statement-breakpoint
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;