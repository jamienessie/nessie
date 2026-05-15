CREATE TABLE "bus_auto_reply_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"from_agent_ids" jsonb,
	"payload_match" jsonb,
	"action" text NOT NULL,
	"reply_template" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"enabled" text DEFAULT 'true' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bus_auto_reply_rules" ADD CONSTRAINT "bus_auto_reply_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bus_auto_reply_rules_company_enabled_kind_idx" ON "bus_auto_reply_rules" USING btree ("company_id","enabled","kind");