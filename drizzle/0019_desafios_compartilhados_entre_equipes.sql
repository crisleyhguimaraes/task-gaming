CREATE TABLE "challenge_teams" (
	"challenge_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_teams_challenge_id_team_id_pk" PRIMARY KEY("challenge_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "tenant_wide" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "challenge_teams" ADD CONSTRAINT "challenge_teams_challenge_tenant_fk" FOREIGN KEY ("tenant_id","challenge_id") REFERENCES "public"."challenges"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_teams" ADD CONSTRAINT "challenge_teams_team_tenant_fk" FOREIGN KEY ("team_id","tenant_id") REFERENCES "public"."teams"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "challenge_teams_team_idx" ON "challenge_teams" USING btree ("team_id");