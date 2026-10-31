CREATE TABLE "board_teams" (
	"board_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_teams_board_id_team_id_pk" PRIMARY KEY("board_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"archived_at" timestamp with time zone,
	"name_key" text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boards_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "board_id" uuid;--> statement-breakpoint
ALTER TABLE "board_teams" ADD CONSTRAINT "board_teams_board_tenant_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_teams" ADD CONSTRAINT "board_teams_team_tenant_fk" FOREIGN KEY ("team_id","tenant_id") REFERENCES "public"."teams"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_teams_team_idx" ON "board_teams" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boards_active_name_idx" ON "boards" USING btree ("tenant_id","name_key") WHERE "boards"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_board_tenant_fk" FOREIGN KEY ("tenant_id","board_id") REFERENCES "public"."boards"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_board_idx" ON "tasks" USING btree ("board_id");