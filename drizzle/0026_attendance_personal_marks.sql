CREATE TABLE "attendance_personal_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"done_on" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"marked_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_personal_marks" ADD CONSTRAINT "attendance_personal_marks_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_personal_marks" ADD CONSTRAINT "attendance_personal_marks_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;