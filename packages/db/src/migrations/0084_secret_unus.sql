CREATE TABLE "meeting_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"agent_id" uuid,
	"turn_index" integer NOT NULL,
	"role" text NOT NULL,
	"body_markdown" text NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_by_operator" boolean DEFAULT false NOT NULL,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"role" text DEFAULT 'panel' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"mode" text DEFAULT 'operator_led' NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"agenda_markdown" text,
	"department_id" uuid,
	"facilitator_agent_id" uuid,
	"budget_cents" integer DEFAULT 0 NOT NULL,
	"spent_cents" integer DEFAULT 0 NOT NULL,
	"turn_limit" integer DEFAULT 30 NOT NULL,
	"turn_index" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"artifact_document_id" uuid,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_messages" ADD CONSTRAINT "meeting_messages_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_messages" ADD CONSTRAINT "meeting_messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_outcomes" ADD CONSTRAINT "meeting_outcomes_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_facilitator_agent_id_agents_id_fk" FOREIGN KEY ("facilitator_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_artifact_document_id_documents_id_fk" FOREIGN KEY ("artifact_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_messages_meeting_turn_idx" ON "meeting_messages" USING btree ("meeting_id","turn_index");--> statement-breakpoint
CREATE INDEX "meeting_messages_meeting_created_idx" ON "meeting_messages" USING btree ("meeting_id","created_at");--> statement-breakpoint
CREATE INDEX "meeting_outcomes_meeting_kind_idx" ON "meeting_outcomes" USING btree ("meeting_id","kind");--> statement-breakpoint
CREATE INDEX "meeting_outcomes_meeting_approved_idx" ON "meeting_outcomes" USING btree ("meeting_id","approved_by_operator");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_participants_meeting_agent_uniq" ON "meeting_participants" USING btree ("meeting_id","agent_id");--> statement-breakpoint
CREATE INDEX "meeting_participants_agent_meeting_idx" ON "meeting_participants" USING btree ("agent_id","meeting_id");--> statement-breakpoint
CREATE INDEX "meetings_company_state_idx" ON "meetings" USING btree ("company_id","state");--> statement-breakpoint
CREATE INDEX "meetings_company_department_idx" ON "meetings" USING btree ("company_id","department_id");--> statement-breakpoint
CREATE INDEX "meetings_company_scheduled_idx" ON "meetings" USING btree ("company_id","scheduled_at");