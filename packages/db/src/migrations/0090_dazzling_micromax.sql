CREATE TABLE "arena_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_run_id" uuid NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"output_text" text,
	"latency_ms" integer,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"score" integer,
	"judge_reasoning" text,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_type" text NOT NULL,
	"prompt" text NOT NULL,
	"candidate_models" jsonb NOT NULL,
	"judge_model" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"winner_model" text,
	"judge_rubric" jsonb,
	"judge_notes" text,
	"judge_error" text,
	"total_cost_cents" integer DEFAULT 0 NOT NULL,
	"requested_by_agent_id" uuid,
	"requested_by_user_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arena_results" ADD CONSTRAINT "arena_results_arena_run_id_arena_runs_id_fk" FOREIGN KEY ("arena_run_id") REFERENCES "public"."arena_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_runs" ADD CONSTRAINT "arena_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_runs" ADD CONSTRAINT "arena_runs_requested_by_agent_id_agents_id_fk" FOREIGN KEY ("requested_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arena_results_run_idx" ON "arena_results" USING btree ("arena_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "arena_results_run_model_uniq" ON "arena_results" USING btree ("arena_run_id","model");--> statement-breakpoint
CREATE INDEX "arena_runs_company_created_idx" ON "arena_runs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "arena_runs_company_task_type_completed_idx" ON "arena_runs" USING btree ("company_id","task_type","completed_at");
