DELETE FROM "role_capabilities" WHERE "role" IN ('SUPER_ADMIN', 'TENANT_ADMIN');--> statement-breakpoint
ALTER TABLE "role_capabilities" ALTER COLUMN "role" SET DATA TYPE "public"."team_role" USING (CASE "role"::text WHEN 'TEAM_LEADER' THEN 'LEADER' ELSE "role"::text END)::"public"."team_role";
