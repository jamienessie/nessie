CREATE TABLE "agent_coaching_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"authored_by_user_id" text,
	"archived_by_user_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_coaching_notes" ADD CONSTRAINT "agent_coaching_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_coaching_notes" ADD CONSTRAINT "agent_coaching_notes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_coaching_notes_company_agent_status_idx" ON "agent_coaching_notes" USING btree ("company_id","agent_id","status");