ALTER TABLE "teams" ADD COLUMN "description" varchar(300);--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "name_key" text GENERATED ALWAYS AS (lower(btrim(name))) STORED;--> statement-breakpoint
-- Nomes repetidos (sem diferenciar maiúsculas) ganham sufixo, a equipe mais antiga fica com o nome original. O número é o primeiro livre a partir de 2, porque "Vendas (2)" pode já existir: sem isso o índice único falha numa base com dados.
DO $$
DECLARE
	"dup" record;
	"suffix" integer;
BEGIN
	FOR "dup" IN
		SELECT "id", "tenant_id", left(btrim("name"), 90) AS "base"
		FROM (
			SELECT "id", "tenant_id", "name", "created_at", row_number() OVER (PARTITION BY "tenant_id", "name_key" ORDER BY "created_at", "id") AS "position" FROM "teams"
		) AS "ranked"
		WHERE "position" > 1
		ORDER BY "created_at", "id"
	LOOP
		"suffix" := 2;
		WHILE EXISTS (SELECT 1 FROM "teams" WHERE "tenant_id" = "dup"."tenant_id" AND "name_key" = lower("dup"."base" || ' (' || "suffix" || ')')) LOOP
			"suffix" := "suffix" + 1;
		END LOOP;
		UPDATE "teams" SET "name" = "dup"."base" || ' (' || "suffix" || ')' WHERE "id" = "dup"."id";
	END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_name_key_unique" UNIQUE("tenant_id","name_key");
