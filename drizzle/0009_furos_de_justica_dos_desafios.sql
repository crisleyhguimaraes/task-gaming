ALTER TABLE "challenges" ADD COLUMN "scored_attempts_per_day" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_scored_attempts_positive" CHECK ("challenges"."scored_attempts_per_day" >= 1);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
-- Só a rejeição zera os pontos de uma tarefa concluída e validada: scoreTask nunca desce abaixo de metade da base.
UPDATE "tasks" SET "rejected_at" = "finished_at" WHERE "status" = 'finished' AND "needs_validation" = false AND "awarded_points" = 0 AND "base_points" > 0;--> statement-breakpoint
-- O duplo clique antigo deixou tentativas abertas repetidas; sobra a mais adiantada de cada pessoa e desafio.
UPDATE "tasks" SET "status" = 'cancelled', "awarded_points" = NULL WHERE "id" IN (SELECT "id" FROM (SELECT "id", row_number() OVER (PARTITION BY "challenge_id", "assigned_to_id" ORDER BY ("status" = 'in_progress') DESC, "created_at", "id") AS "attempt_rank" FROM "tasks" WHERE "challenge_id" IS NOT NULL AND "assigned_to_id" IS NOT NULL AND "status" IN ('pending', 'in_progress', 'paused')) "ranked" WHERE "attempt_rank" > 1);--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_open_attempt_idx" ON "tasks" USING btree ("challenge_id","assigned_to_id") WHERE "tasks"."challenge_id" is not null and "tasks"."status" in ('pending', 'in_progress', 'paused');
