CREATE TABLE "agent_bus_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"from_agent_id" uuid,
	"to_agent_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"parent_message_id" uuid,
	"delivered_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "black_box_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"label" text,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reputation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"evidence_ref" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"owner_agent_id" uuid,
	"reviewer_agent_id" uuid,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_boundaries" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"budget_cents" integer DEFAULT 0 NOT NULL,
	"spent_cents" integer DEFAULT 0 NOT NULL,
	"deadline_at" timestamp with time zone,
	"escalation_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_bus_messages" ADD CONSTRAINT "agent_bus_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_bus_messages" ADD CONSTRAINT "agent_bus_messages_from_agent_id_agents_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_bus_messages" ADD CONSTRAINT "agent_bus_messages_to_agent_id_agents_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_bus_messages" ADD CONSTRAINT "agent_bus_messages_parent_message_id_agent_bus_messages_id_fk" FOREIGN KEY ("parent_message_id") REFERENCES "public"."agent_bus_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_events" ADD CONSTRAINT "reputation_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_contracts" ADD CONSTRAINT "work_contracts_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_contracts" ADD CONSTRAINT "work_contracts_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_contracts" ADD CONSTRAINT "work_contracts_reviewer_agent_id_agents_id_fk" FOREIGN KEY ("reviewer_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_bus_company_to_status_idx" ON "agent_bus_messages" USING btree ("company_id","to_agent_id","status");--> statement-breakpoint
CREATE INDEX "agent_bus_company_kind_idx" ON "agent_bus_messages" USING btree ("company_id","kind");--> statement-breakpoint
CREATE INDEX "agent_bus_thread_idx" ON "agent_bus_messages" USING btree ("parent_message_id");--> statement-breakpoint
CREATE INDEX "black_box_scope_recorded_idx" ON "black_box_records" USING btree ("scope","scope_id","recorded_at");--> statement-breakpoint
CREATE INDEX "black_box_scope_id_idx" ON "black_box_records" USING btree ("scope_id");--> statement-breakpoint
CREATE INDEX "reputation_events_agent_occurred_idx" ON "reputation_events" USING btree ("agent_id","occurred_at");--> statement-breakpoint
CREATE INDEX "reputation_events_agent_dimension_idx" ON "reputation_events" USING btree ("agent_id","dimension");--> statement-breakpoint
CREATE UNIQUE INDEX "work_contracts_issue_uniq" ON "work_contracts" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "work_contracts_owner_state_idx" ON "work_contracts" USING btree ("owner_agent_id","state");--> statement-breakpoint
CREATE INDEX "work_contracts_reviewer_state_idx" ON "work_contracts" USING btree ("reviewer_agent_id","state");