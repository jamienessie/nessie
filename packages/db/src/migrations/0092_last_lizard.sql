CREATE TABLE "snippet_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snippet_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"note" text,
	"snapshot_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snippets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "snippet_revisions" ADD CONSTRAINT "snippet_revisions_snippet_id_snippets_id_fk" FOREIGN KEY ("snippet_id") REFERENCES "public"."snippets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "snippet_revisions_snippet_version_uniq" ON "snippet_revisions" USING btree ("snippet_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "snippets_company_key_uniq" ON "snippets" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX "snippets_company_idx" ON "snippets" USING btree ("company_id");