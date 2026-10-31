CREATE TYPE "public"."team_role" AS ENUM('LEADER', 'MEMBER');--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_id_tenant_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_id_tenant_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" "team_role" DEFAULT 'MEMBER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_tenant_fk" FOREIGN KEY ("team_id","tenant_id") REFERENCES "public"."teams"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_tenant_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "team_members_tenant_team_role_idx" ON "team_members" USING btree ("tenant_id","team_id","role");--> statement-breakpoint
-- Admin com equipe vira MEMBER dela (mantém Hoje e pool) e banido mantém o vínculo; líder sem equipe não tem o que vincular e SUPER_ADMIN nunca entra em equipe.
INSERT INTO "team_members" ("team_id", "user_id", "tenant_id", "role")
SELECT "team_id", "id", "tenant_id", CASE WHEN "role" = 'TEAM_LEADER' THEN 'LEADER'::"team_role" ELSE 'MEMBER'::"team_role" END
FROM "users"
WHERE "team_id" IS NOT NULL AND "role" <> 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;
