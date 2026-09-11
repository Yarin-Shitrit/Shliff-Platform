CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"holder_person_id" uuid,
	"opening_balance" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"opening_on" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "accounts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"label" text NOT NULL,
	"quantity_text" text,
	"quantity_num" numeric(12, 2),
	"unit_cost" numeric(12, 2),
	"total" numeric(12, 2) NOT NULL,
	"rationale" text,
	"category" text DEFAULT 'camp' NOT NULL,
	"source_block_id" uuid,
	"source_row" integer,
	CONSTRAINT "budget_lines_source_key" UNIQUE("source_block_id","source_row")
);
--> statement-breakpoint
CREATE TABLE "funding_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"note" text,
	"source_block_id" uuid,
	"source_row" integer,
	CONSTRAINT "funding_targets_source_key" UNIQUE("source_block_id","source_row")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_on" timestamp with time zone NOT NULL,
	"account_id" uuid,
	"direction" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"description" text NOT NULL,
	"season_id" uuid,
	"event_id" uuid,
	"budget_line_id" uuid,
	"transfer_group_id" uuid,
	"recorded_by" text NOT NULL,
	"source_block_id" uuid,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_source_key" UNIQUE("source_block_id","source_row")
);
--> statement-breakpoint
CREATE TABLE "obligation_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"obligation_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"kind" text NOT NULL,
	"ledger_entry_id" uuid,
	"payment_id" uuid,
	"note" text,
	"settled_on" timestamp with time zone NOT NULL,
	"recorded_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" text NOT NULL,
	"party_person_id" uuid,
	"party_name" text,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"season_id" uuid,
	"opened_on" timestamp with time zone DEFAULT now() NOT NULL,
	"source_block_id" uuid,
	"source_row" integer,
	CONSTRAINT "obligations_source_key" UNIQUE("source_block_id","source_row")
);
--> statement-breakpoint
CREATE TABLE "ticket_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"event_id" uuid,
	"label" text NOT NULL,
	"quantity" integer,
	"price" numeric(12, 2),
	"total" numeric(12, 2) NOT NULL,
	"sold" boolean DEFAULT false NOT NULL,
	"source_block_id" uuid,
	"source_row" integer,
	CONSTRAINT "ticket_rounds_source_key" UNIQUE("source_block_id","source_row")
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "budget_line_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_holder_person_id_persons_id_fk" FOREIGN KEY ("holder_person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_source_block_id_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_targets" ADD CONSTRAINT "funding_targets_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_targets" ADD CONSTRAINT "funding_targets_source_block_id_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_event_id_camp_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."camp_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_source_block_id_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_settlements" ADD CONSTRAINT "obligation_settlements_obligation_id_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."obligations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_settlements" ADD CONSTRAINT "obligation_settlements_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_settlements" ADD CONSTRAINT "obligation_settlements_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_party_person_id_persons_id_fk" FOREIGN KEY ("party_person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_source_block_id_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_rounds" ADD CONSTRAINT "ticket_rounds_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_rounds" ADD CONSTRAINT "ticket_rounds_event_id_camp_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."camp_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_rounds" ADD CONSTRAINT "ticket_rounds_source_block_id_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."blocks"("id") ON DELETE set null ON UPDATE no action;