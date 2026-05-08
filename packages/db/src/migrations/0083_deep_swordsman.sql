CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"mission" text NOT NULL,
	"default_preferred_tier" text DEFAULT 'T2' NOT NULL,
	"default_budget_monthly_cents" integer DEFAULT 0 NOT NULL,
	"allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quality_standards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scorecard_template" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "human_first_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "human_last_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "autonomy_level" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "reputation_score" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "role_template_key" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "reviewer_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "tier_required" text;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_company_key_uniq" ON "departments" USING btree ("company_id","key");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_reviewer_agent_id_agents_id_fk" FOREIGN KEY ("reviewer_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_company_tier_idx" ON "agents" USING btree ("company_id","tier");--> statement-breakpoint
CREATE INDEX "agents_company_department_idx" ON "agents" USING btree ("company_id","department_id");--> statement-breakpoint
CREATE INDEX "issues_company_reviewer_status_idx" ON "issues" USING btree ("company_id","reviewer_agent_id","status");