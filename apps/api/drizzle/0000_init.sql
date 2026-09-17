CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"tenant_id" text NOT NULL,
	"sha256" text NOT NULL,
	"size" bigint NOT NULL,
	"mime" text NOT NULL,
	"encrypted" boolean NOT NULL,
	"key_id" text,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blobs_tenant_id_sha256_pk" PRIMARY KEY("tenant_id","sha256")
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"tenant_id" text NOT NULL,
	"tree_size" bigint NOT NULL,
	"root_hash" text NOT NULL,
	"head_hash" text NOT NULL,
	"ts" text NOT NULL,
	"key_id" text NOT NULL,
	"signature" text NOT NULL,
	"anchor" jsonb,
	CONSTRAINT "checkpoints_tenant_id_tree_size_pk" PRIMARY KEY("tenant_id","tree_size")
);
--> statement-breakpoint
CREATE TABLE "event_sources" (
	"tenant_id" text NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"seq" bigint NOT NULL,
	CONSTRAINT "event_sources_tenant_id_source_source_id_pk" PRIMARY KEY("tenant_id","source","source_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"tenant_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"id" text NOT NULL,
	"ts" text NOT NULL,
	"source_ts" text NOT NULL,
	"source" text NOT NULL,
	"provenance" text NOT NULL,
	"run_id" text NOT NULL,
	"span_id" text,
	"parent_span_id" text,
	"kind" text NOT NULL,
	"actor" jsonb NOT NULL,
	"authority" jsonb,
	"target" jsonb,
	"attrs" jsonb NOT NULL,
	"payload_sha256" text,
	"summary" text,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "events_tenant_id_seq_pk" PRIMARY KEY("tenant_id","seq")
);
--> statement-breakpoint
CREATE TABLE "evidence_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"storage_key" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"yaml" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"principal_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"started_at" text NOT NULL,
	"ended_at" text,
	"event_count" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"risk_max" text,
	"divergence_count" integer DEFAULT 0 NOT NULL,
	"layout" jsonb,
	"graph_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "runs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"capture_mode" text DEFAULT 'off' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_tenant_id_seq_events_tenant_id_seq_fk" FOREIGN KEY ("tenant_id","seq") REFERENCES "public"."events"("tenant_id","seq") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_jobs" ADD CONSTRAINT "evidence_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_tenant_idx" ON "api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_tenant_id_idx" ON "events" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "events_tenant_run_seq_idx" ON "events" USING btree ("tenant_id","run_id","seq");--> statement-breakpoint
CREATE INDEX "events_tenant_ts_idx" ON "events" USING btree ("tenant_id","ts");--> statement-breakpoint
CREATE INDEX "events_tenant_kind_idx" ON "events" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "evidence_jobs_tenant_run_idx" ON "evidence_jobs" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE INDEX "policies_tenant_idx" ON "policies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "runs_tenant_started_idx" ON "runs" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE FUNCTION "events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'events is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint
CREATE TRIGGER "events_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "events" FOR EACH STATEMENT EXECUTE FUNCTION "events_append_only"();
--> statement-breakpoint
DO $$
DECLARE app_role text := current_setting('debrief.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'debrief.app_role must be set on the migration session';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT ON TABLE "events", "event_sources", "blobs", "checkpoints" TO %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE "tenants", "api_keys", "runs", "policies", "evidence_jobs" TO %I', app_role);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "events" FROM %I', app_role);
END
$$;
