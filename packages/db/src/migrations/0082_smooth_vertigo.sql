CREATE TABLE "credential_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"message" text,
	"latency_ms" integer,
	"http_429_count" integer DEFAULT 0 NOT NULL,
	"http_5xx_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier" text NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"secret_ref" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"monthly_cap_cents" integer,
	"monthly_spent_cents" integer DEFAULT 0 NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_quotas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"cap_cents" integer,
	"spent_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credential_health" ADD CONSTRAINT "credential_health_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_quotas" ADD CONSTRAINT "subscription_quotas_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_health_credential_observed_idx" ON "credential_health" USING btree ("credential_id","observed_at");--> statement-breakpoint
CREATE INDEX "credentials_tier_status_idx" ON "credentials" USING btree ("tier","status");--> statement-breakpoint
CREATE INDEX "credentials_provider_idx" ON "credentials" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_display_name_uniq" ON "credentials" USING btree ("display_name");--> statement-breakpoint
CREATE INDEX "subscription_quotas_credential_window_idx" ON "subscription_quotas" USING btree ("credential_id","window_start");
-- documents_title_search_idx and documents_latest_body_search_idx already
-- exist from migration 0079; Drizzle's snapshot keeps re-emitting them due
-- to a gin_trgm_ops operator-class detection quirk. Stripped intentionally.