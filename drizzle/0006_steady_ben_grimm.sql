ALTER TABLE "obligations" ALTER COLUMN "opened_on" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "obligations" ALTER COLUMN "opened_on" DROP NOT NULL;