-- D-084: a source id is unique per posting trust; rows from before it were posted by keys 0003 made third-party.
ALTER TABLE "event_sources" ADD COLUMN "trust" text DEFAULT 'third-party' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_sources" ALTER COLUMN "trust" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "event_sources" DROP CONSTRAINT "event_sources_tenant_id_source_source_id_pk";--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_tenant_id_source_trust_source_id_pk" PRIMARY KEY("tenant_id","source","trust","source_id");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_trust_check" CHECK ("api_keys"."trust" in ('local', 'third-party'));--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_trust_check" CHECK ("event_sources"."trust" in ('local', 'third-party'));--> statement-breakpoint
DO $$
DECLARE app_role text := current_setting('debrief.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'debrief.app_role must be set on the migration session';
  END IF;
  EXECUTE format('REVOKE UPDATE ON TABLE "api_keys" FROM %I', app_role);
  EXECUTE format('GRANT UPDATE ("revoked_at") ON TABLE "api_keys" TO %I', app_role);
END
$$;
