CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hire_id" uuid NOT NULL,
	"human_first_name" text NOT NULL,
	"human_last_name" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"resume_markdown" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"source_template_key" text,
	"proposed_adapter_type" text,
	"trial_issue_id" uuid,
	"agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"requested_role_template_key" text,
	"requested_department_id" uuid,
	"requested_tier" text DEFAULT 'T2' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"packet" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"default_first_name" text NOT NULL,
	"default_last_name" text NOT NULL,
	"title" text NOT NULL,
	"tier" text NOT NULL,
	"department_key" text NOT NULL,
	"department_id" uuid,
	"default_adapter_type" text DEFAULT 'openai_compatible' NOT NULL,
	"default_autonomy_level" integer DEFAULT 1 NOT NULL,
	"pitch" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scorecards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"pass" text DEFAULT 'trial' NOT NULL,
	"rubric" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_score" numeric(3, 2),
	"recommendation" text DEFAULT 'weak_hire' NOT NULL,
	"notes" text,
	"scored_by_agent_id" uuid,
	"scored_by_user_id" text,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stars_helper" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_hire_id_hires_id_fk" FOREIGN KEY ("hire_id") REFERENCES "public"."hires"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_trial_issue_id_issues_id_fk" FOREIGN KEY ("trial_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hires" ADD CONSTRAINT "hires_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hires" ADD CONSTRAINT "hires_requested_department_id_departments_id_fk" FOREIGN KEY ("requested_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_templates" ADD CONSTRAINT "role_templates_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidates_hire_status_idx" ON "candidates" USING btree ("hire_id","status");--> statement-breakpoint
CREATE INDEX "hires_company_status_idx" ON "hires" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "hires_company_tier_idx" ON "hires" USING btree ("company_id","requested_tier");--> statement-breakpoint
CREATE UNIQUE INDEX "role_templates_key_uniq" ON "role_templates" USING btree ("key");--> statement-breakpoint
CREATE INDEX "scorecards_candidate_pass_idx" ON "scorecards" USING btree ("candidate_id","pass");