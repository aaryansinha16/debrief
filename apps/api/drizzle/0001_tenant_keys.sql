CREATE TABLE "tenant_keys" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"key_id" text NOT NULL,
	"wrapped_key" text,
	"pii_salt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"destroyed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tenant_keys" ADD CONSTRAINT "tenant_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DO $$
DECLARE app_role text := current_setting('debrief.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'debrief.app_role must be set on the migration session';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE "tenant_keys" TO %I', app_role);
END
$$;
