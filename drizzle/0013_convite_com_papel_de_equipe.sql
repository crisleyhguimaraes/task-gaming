ALTER TABLE "invitations" ADD COLUMN "team_role" "team_role" DEFAULT 'MEMBER' NOT NULL;--> statement-breakpoint
UPDATE "invitations" SET "team_role" = 'LEADER', "role" = 'MEMBER' WHERE "role" = 'TEAM_LEADER';
