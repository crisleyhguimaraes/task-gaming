ALTER TABLE "teams" ADD COLUMN "description" varchar(300);--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "name_key" text GENERATED ALWAYS AS (lower(btrim(name))) STORED;--> statement-breakpoint
-- Nomes repetidos (sem diferenciar maiúsculas) ganham sufixo, a equipe mais antiga fica com o nome original: sem isso o índice único falha numa base com dados.
UPDATE "teams" SET "name" = left(btrim("teams"."name"), 90) || ' (' || "dup"."position" || ')'
FROM (
	SELECT "id", row_number() OVER (PARTITION BY "tenant_id", "name_key" ORDER BY "created_at", "id") AS "position" FROM "teams"
) AS "dup"
WHERE "teams"."id" = "dup"."id" AND "dup"."position" > 1;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_name_key_unique" UNIQUE("tenant_id","name_key");
