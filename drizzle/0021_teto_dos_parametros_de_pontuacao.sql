UPDATE "scoring_rules" SET
	"validate_below_pct" = LEAST("validate_below_pct", 998),
	"pace_below_pct" = LEAST("pace_below_pct", 999),
	"overtime_above_pct" = LEAST("overtime_above_pct", 1000),
	"pace_bonus_pct" = LEAST("pace_bonus_pct", 1000),
	"overtime_step_pct" = LEAST("overtime_step_pct", 1000),
	"overtime_penalty_pct" = LEAST("overtime_penalty_pct", 1000),
	"pause_below_pct" = LEAST("pause_below_pct", 1000),
	"pause_penalty_pct" = LEAST("pause_penalty_pct", 1000),
	"cap_multiplier" = LEAST("cap_multiplier", 100),
	"cap_min_minutes" = LEAST("cap_min_minutes", 1440);--> statement-breakpoint
ALTER TABLE "scoring_rules" ADD CONSTRAINT "scoring_rules_percents_max" CHECK ("scoring_rules"."validate_below_pct" <= 1000 and "scoring_rules"."pace_below_pct" <= 1000 and "scoring_rules"."pace_bonus_pct" <= 1000 and "scoring_rules"."overtime_above_pct" <= 1000 and "scoring_rules"."overtime_step_pct" <= 1000 and "scoring_rules"."overtime_penalty_pct" <= 1000 and "scoring_rules"."pause_below_pct" <= 1000 and "scoring_rules"."pause_penalty_pct" <= 1000);--> statement-breakpoint
ALTER TABLE "scoring_rules" ADD CONSTRAINT "scoring_rules_cap_max" CHECK ("scoring_rules"."cap_multiplier" <= 100 and "scoring_rules"."cap_min_minutes" <= 1440);