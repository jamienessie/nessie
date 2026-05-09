CREATE TABLE "janitor_outages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"adapter_type" text NOT NULL,
	"dominant_error_code" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"detected_in_report_id" uuid,
	"error_pattern" jsonb NOT NULL,
	"affected_agent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plan_markdown" text NOT NULL,
	"plan_source" text DEFAULT 'hank_gemini' NOT NULL,
	"escalated_issue_id" uuid,
	"assignee_agent_id" uuid,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"observation_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "janitor_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"triggered_by" text NOT NULL,
	"triggered_by_user_id" text,
	"scope" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"scanned_count" integer DEFAULT 0 NOT NULL,
	"healthy_count" integer DEFAULT 0 NOT NULL,
	"swapped_count" integer DEFAULT 0 NOT NULL,
	"paused_count" integer DEFAULT 0 NOT NULL,
	"skipped_cooldown_count" integer DEFAULT 0 NOT NULL,
	"outages_detected_count" integer DEFAULT 0 NOT NULL,
	"swaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pauses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary_prose" text,
	"summary_source" text,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "janitor_outages" ADD CONSTRAINT "janitor_outages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "janitor_outages" ADD CONSTRAINT "janitor_outages_detected_in_report_id_janitor_reports_id_fk" FOREIGN KEY ("detected_in_report_id") REFERENCES "public"."janitor_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "janitor_outages" ADD CONSTRAINT "janitor_outages_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "janitor_reports" ADD CONSTRAINT "janitor_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "janitor_outages_company_adapter_status_idx" ON "janitor_outages" USING btree ("company_id","adapter_type","status");--> statement-breakpoint
CREATE INDEX "janitor_outages_company_status_detected_idx" ON "janitor_outages" USING btree ("company_id","status","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "janitor_outages_open_unique_idx" ON "janitor_outages" USING btree ("company_id","adapter_type","dominant_error_code") WHERE status in ('open', 'in_progress');--> statement-breakpoint
CREATE INDEX "janitor_reports_company_started_idx" ON "janitor_reports" USING btree ("company_id","started_at");