CREATE TABLE "user_page_access" (
	"user_id" uuid NOT NULL,
	"page" text NOT NULL,
	"level" text NOT NULL,
	CONSTRAINT "user_page_access_user_id_page_pk" PRIMARY KEY("user_id","page")
);
--> statement-breakpoint
ALTER TABLE "user_page_access" ADD CONSTRAINT "user_page_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;