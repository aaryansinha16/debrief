CREATE TABLE "narratives" (
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"events_hash" text NOT NULL,
	"model" text NOT NULL,
	"sentences" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "narratives_tenant_id_run_id_events_hash_pk" PRIMARY KEY("tenant_id","run_id","events_hash")
);
--> statement-breakpoint
ALTER TABLE "narratives" ADD CONSTRAINT "narratives_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DO $$
DECLARE app_role text := current_setting('debrief.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'debrief.app_role must be set on the migration session';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT ON TABLE "narratives" TO %I', app_role);
END
$$;
