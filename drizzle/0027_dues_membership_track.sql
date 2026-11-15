ALTER TABLE "dues" ADD COLUMN "track" text DEFAULT 'burn' NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "membership_rate" numeric(12, 2);