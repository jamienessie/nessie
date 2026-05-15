ALTER TABLE "credentials" ADD COLUMN "daily_request_cap" integer;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "daily_request_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "daily_reset_at" timestamp with time zone;