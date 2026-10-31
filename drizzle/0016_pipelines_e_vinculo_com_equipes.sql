CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"name_key" text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipelines_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "team_pipelines" (
	"pipeline_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_pipelines_pipeline_id_team_id_pk" PRIMARY KEY("pipeline_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_pipelines" ADD CONSTRAINT "team_pipelines_pipeline_tenant_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."pipelines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_pipelines" ADD CONSTRAINT "team_pipelines_team_tenant_fk" FOREIGN KEY ("team_id","tenant_id") REFERENCES "public"."teams"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_one_default_idx" ON "pipelines" USING btree ("tenant_id") WHERE "pipelines"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_active_name_idx" ON "pipelines" USING btree ("tenant_id","name_key") WHERE "pipelines"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "team_pipelines_team_idx" ON "team_pipelines" USING btree ("team_id");--> statement-breakpoint
-- Backfill em ordem: colunas nulas, um pipeline padrão por tenant, etapas e oportunidades apontando para ele, e só então NOT NULL e as FKs compostas.
ALTER TABLE "pipeline_stages" ADD COLUMN "pipeline_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "pipeline_id" uuid;--> statement-breakpoint
INSERT INTO "pipelines" ("tenant_id", "name", "is_default") SELECT "id", 'Funil de vendas', true FROM "tenants";--> statement-breakpoint
UPDATE "pipeline_stages" SET "pipeline_id" = "pipelines"."id" FROM "pipelines" WHERE "pipelines"."tenant_id" = "pipeline_stages"."tenant_id" AND "pipelines"."is_default";--> statement-breakpoint
UPDATE "opportunities" SET "pipeline_id" = "pipeline_stages"."pipeline_id" FROM "pipeline_stages" WHERE "pipeline_stages"."id" = "opportunities"."stage_id";--> statement-breakpoint
ALTER TABLE "pipeline_stages" ALTER COLUMN "pipeline_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "pipeline_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_unique" UNIQUE("pipeline_id","id");--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_tenant_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."pipelines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_stage_id_pipeline_stages_id_fk";--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_pipeline_stage_fk" FOREIGN KEY ("pipeline_id","stage_id") REFERENCES "public"."pipeline_stages"("pipeline_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DROP INDEX "pipeline_stages_tenant_idx";--> statement-breakpoint
CREATE INDEX "pipeline_stages_pipeline_idx" ON "pipeline_stages" USING btree ("pipeline_id","sort_order");
