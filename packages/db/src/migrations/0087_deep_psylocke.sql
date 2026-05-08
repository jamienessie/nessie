CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body_markdown" text,
	"refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'captured' NOT NULL,
	"triaged_at" timestamp with time zone,
	"triaged_notes" text,
	"promoted_kind" text,
	"promoted_id" uuid,
	"captured_by_agent_id" uuid,
	"captured_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_constitution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by_agent_id" uuid,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_constitution_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constitution_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot_by_agent_id" uuid,
	"snapshot_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "trust_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issued_by_agent_id" uuid,
	"issued_by_user_id" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_constitution" ADD CONSTRAINT "operator_constitution_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_constitution_versions" ADD CONSTRAINT "operator_constitution_versions_constitution_id_operator_constitution_id_fk" FOREIGN KEY ("constitution_id") REFERENCES "public"."operator_constitution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_items_company_status_idx" ON "inbox_items" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "inbox_items_company_captured_idx" ON "inbox_items" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_constitution_company_uniq" ON "operator_constitution" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "operator_constitution_versions_idx" ON "operator_constitution_versions" USING btree ("constitution_id","version");--> statement-breakpoint
CREATE INDEX "trust_receipts_scope_idx" ON "trust_receipts" USING btree ("scope_kind","scope_id");--> statement-breakpoint
CREATE INDEX "trust_receipts_scope_issued_idx" ON "trust_receipts" USING btree ("scope_kind","scope_id","issued_at");