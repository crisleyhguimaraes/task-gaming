ALTER TABLE "team_members" DROP CONSTRAINT "team_members_team_tenant_fk";
--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_tenant_fk" FOREIGN KEY ("team_id","tenant_id") REFERENCES "public"."teams"("id","tenant_id") ON DELETE cascade ON UPDATE no action;