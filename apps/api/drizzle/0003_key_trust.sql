-- D-084: keys issued before trust existed could already assert third-party, so they keep it; new keys default to local.
ALTER TABLE "api_keys" ADD COLUMN "trust" text DEFAULT 'third-party' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "trust" SET DEFAULT 'local';
