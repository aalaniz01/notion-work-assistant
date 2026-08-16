CREATE TABLE "priority_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"deadline_weight" integer DEFAULT 50 NOT NULL,
	"waiting_time_weight" integer DEFAULT 40 NOT NULL,
	"estimated_effort_weight" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "priority_settings_valid_weights_check" CHECK ("priority_settings"."deadline_weight" between 0 and 100
        and "priority_settings"."waiting_time_weight" between 0 and 100
        and "priority_settings"."estimated_effort_weight" between 0 and 100
        and "priority_settings"."deadline_weight" + "priority_settings"."waiting_time_weight" + "priority_settings"."estimated_effort_weight" = 100)
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_name_length_check" CHECK (char_length(btrim("workspaces"."name")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "priority_settings" ADD CONSTRAINT "priority_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;