CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'disqualified');--> statement-breakpoint
CREATE TYPE "public"."stage_kind" AS ENUM('open', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"owner_id" text,
	"name" varchar(160) NOT NULL,
	"company" varchar(160),
	"email" varchar(200),
	"email_normalized" varchar(200),
	"phone" varchar(40),
	"phone_digits" varchar(20),
	"source" varchar(40) DEFAULT 'outro' NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"task_id" uuid,
	"lead_id" uuid,
	"opportunity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_single_target" CHECK (num_nonnulls("notes"."task_id", "notes"."lead_id", "notes"."opportunity_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"type" varchar(60) NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"owner_id" text,
	"title" varchar(200) NOT NULL,
	"amount_cents" bigint DEFAULT 0 NOT NULL,
	"expected_close_date" date,
	"stage_id" uuid NOT NULL,
	"closed_at" timestamp with time zone,
	"lost_reason" text,
	"sort_order" double precision DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_stage_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid NOT NULL,
	"changed_by_id" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(60) NOT NULL,
	"sort_order" double precision NOT NULL,
	"kind" "stage_kind" DEFAULT 'open' NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_stages_probability" CHECK ("pipeline_stages"."probability" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "role_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"capability" varchar(40) NOT NULL,
	"allowed" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "opportunity_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "require_two_factor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_changes" ADD CONSTRAINT "opportunity_stage_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_changes" ADD CONSTRAINT "opportunity_stage_changes_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_changes" ADD CONSTRAINT "opportunity_stage_changes_from_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_changes" ADD CONSTRAINT "opportunity_stage_changes_to_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_changes" ADD CONSTRAINT "opportunity_stage_changes_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_capabilities" ADD CONSTRAINT "role_capabilities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_tenant_email_idx" ON "leads" USING btree ("tenant_id","email_normalized");--> statement-breakpoint
CREATE INDEX "leads_tenant_phone_idx" ON "leads" USING btree ("tenant_id","phone_digits");--> statement-breakpoint
CREATE INDEX "leads_team_owner_idx" ON "leads" USING btree ("team_id","owner_id");--> statement-breakpoint
CREATE INDEX "leads_tenant_status_idx" ON "leads" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "notes_task_idx" ON "notes" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "notes_lead_idx" ON "notes" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "notes_opportunity_idx" ON "notes" USING btree ("opportunity_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "opportunities_tenant_stage_idx" ON "opportunities" USING btree ("tenant_id","stage_id");--> statement-breakpoint
CREATE INDEX "opportunities_team_owner_idx" ON "opportunities" USING btree ("team_id","owner_id");--> statement-breakpoint
CREATE INDEX "opportunities_lead_idx" ON "opportunities" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "stage_changes_opportunity_idx" ON "opportunity_stage_changes" USING btree ("opportunity_id","changed_at");--> statement-breakpoint
CREATE INDEX "stage_changes_tenant_idx" ON "opportunity_stage_changes" USING btree ("tenant_id","changed_at");--> statement-breakpoint
CREATE INDEX "pipeline_stages_tenant_idx" ON "pipeline_stages" USING btree ("tenant_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "role_capabilities_unique_idx" ON "role_capabilities" USING btree ("tenant_id","role","capability");--> statement-breakpoint
CREATE INDEX "two_factors_secret_idx" ON "two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "two_factors_user_idx" ON "two_factors" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_opportunity_idx" ON "tasks" USING btree ("opportunity_id");--> statement-breakpoint
INSERT INTO "pipeline_stages" ("tenant_id", "name", "sort_order", "kind", "probability")
SELECT t."id", s."name", s."sort_order", s."kind"::"stage_kind", s."probability"
FROM "tenants" t
CROSS JOIN (VALUES
	('Novo', 1, 'open', 10),
	('Qualificado', 2, 'open', 25),
	('Proposta', 3, 'open', 50),
	('Negociação', 4, 'open', 75),
	('Ganha', 5, 'won', 100),
	('Perdida', 6, 'lost', 0)
) AS s("name", "sort_order", "kind", "probability");
