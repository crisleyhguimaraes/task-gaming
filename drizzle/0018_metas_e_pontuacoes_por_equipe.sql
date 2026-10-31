CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"target_points" integer NOT NULL,
	"active_days" smallint[] NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"name_key" text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "goals_tenant_name_key_unique" UNIQUE("tenant_id","name_key"),
	CONSTRAINT "goals_target_points_range" CHECK ("goals"."target_points" between 10 and 10000),
	CONSTRAINT "goals_active_days_valid" CHECK (cardinality("goals"."active_days") between 1 and 7 and "goals"."active_days" <@ array[0,1,2,3,4,5,6]::smallint[])
);
--> statement-breakpoint
CREATE TABLE "scoring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"validate_below_pct" integer NOT NULL,
	"pace_below_pct" integer NOT NULL,
	"pace_bonus_pct" integer NOT NULL,
	"overtime_above_pct" integer NOT NULL,
	"overtime_step_pct" integer NOT NULL,
	"overtime_penalty_pct" integer NOT NULL,
	"pause_below_pct" integer NOT NULL,
	"pause_penalty_pct" integer NOT NULL,
	"floor_pct" integer NOT NULL,
	"cap_multiplier" integer NOT NULL,
	"cap_min_minutes" integer NOT NULL,
	"name_key" text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scoring_rules_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "scoring_rules_tenant_name_key_unique" UNIQUE("tenant_id","name_key"),
	CONSTRAINT "scoring_rules_percents_non_negative" CHECK ("scoring_rules"."validate_below_pct" >= 0 and "scoring_rules"."pace_below_pct" >= 0 and "scoring_rules"."pace_bonus_pct" >= 0 and "scoring_rules"."overtime_above_pct" >= 0 and "scoring_rules"."overtime_step_pct" >= 0 and "scoring_rules"."overtime_penalty_pct" >= 0 and "scoring_rules"."pause_below_pct" >= 0 and "scoring_rules"."pause_penalty_pct" >= 0 and "scoring_rules"."floor_pct" >= 0),
	CONSTRAINT "scoring_rules_thresholds_ascending" CHECK ("scoring_rules"."validate_below_pct" < "scoring_rules"."pace_below_pct" and "scoring_rules"."pace_below_pct" < "scoring_rules"."overtime_above_pct"),
	CONSTRAINT "scoring_rules_floor_range" CHECK ("scoring_rules"."floor_pct" between 1 and 100),
	CONSTRAINT "scoring_rules_overtime_step_positive" CHECK ("scoring_rules"."overtime_step_pct" >= 1),
	CONSTRAINT "scoring_rules_cap_positive" CHECK ("scoring_rules"."cap_multiplier" >= 1 and "scoring_rules"."cap_min_minutes" >= 1)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "scoring_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "goal_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "scoring_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_rules" ADD CONSTRAINT "scoring_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goals_one_default_idx" ON "goals" USING btree ("tenant_id") WHERE "goals"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "scoring_rules_one_default_idx" ON "scoring_rules" USING btree ("tenant_id") WHERE "scoring_rules"."is_default";--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_scoring_rule_id_scoring_rules_id_fk" FOREIGN KEY ("scoring_rule_id") REFERENCES "public"."scoring_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "goals" ("tenant_id", "name", "target_points", "active_days", "is_default")
SELECT "id", 'Padrão', "daily_goal_points", ARRAY[1,2,3,4,5]::smallint[], true FROM "tenants";--> statement-breakpoint
INSERT INTO "scoring_rules" ("tenant_id", "name", "is_default", "validate_below_pct", "pace_below_pct", "pace_bonus_pct", "overtime_above_pct", "overtime_step_pct", "overtime_penalty_pct", "pause_below_pct", "pause_penalty_pct", "floor_pct", "cap_multiplier", "cap_min_minutes")
SELECT "id", 'Padrão', true, 20, 80, 15, 150, 20, 10, 40, 20, 50, 2, 30 FROM "tenants";
