CREATE TABLE "replay_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"original_run_id" uuid,
	"override_model" text NOT NULL,
	"override_prompt" text NOT NULL,
	"override_system_prompt" text,
	"status" text DEFAULT 'running' NOT NULL,
	"output_text" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"error_code" text,
	"error_message" text,
	"requested_by_user_id" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "replay_runs" ADD CONSTRAINT "replay_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_runs" ADD CONSTRAINT "replay_runs_original_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("original_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "replay_runs_company_created_idx" ON "replay_runs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "replay_runs_original_idx" ON "replay_runs" USING btree ("original_run_id");