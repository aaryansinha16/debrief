import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// url'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(600),
  SIGNING_KEY_FILE: z.string().min(1).optional(),
  SIGNING_KEY_SECRET: hex64.optional(),
  S3_ENDPOINT: z.url(),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  CHECKPOINT_INTERVAL_MS: z.coerce.number().int().min(100).default(60_000),
  CHECKPOINT_EVERY_EVENTS: z.coerce.number().int().min(1).default(1000),
  BLOB_MASTER_KEY: hex64,
  BLOB_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(1024 * 1024),
  RUN_DEBOUNCE_MS: z.coerce.number().int().min(0).default(250),
  LIVE_HEARTBEAT_MS: z.coerce.number().int().min(50).default(15_000),
  ANCHOR_KIND: z.enum(['none', 'rfc3161']).default('none'),
  ANCHOR_TSA_URL: z.url().optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  NARRATION_MODEL: z.string().min(1).default('claude-opus-5'),
  NARRATION_MAX_EVENTS: z.coerce.number().int().min(1).default(400),
});

export type Config = z.infer<typeof configSchema>;

export const CONFIG = Symbol('CONFIG');

export const resolveFromRepoRoot = (path: string): string =>
  isAbsolute(path) ? path : resolve(REPO_ROOT, path);

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  // `.env.example` ships optional settings as `NAME=`: a blank value means unset, not an empty string.
  const env = Object.fromEntries(
    Object.entries(source).map(([name, value]) => [name, value === '' ? undefined : value]),
  );
  const withFallbacks = {
    ...env,
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID ?? env.MINIO_ROOT_USER,
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY ?? env.MINIO_ROOT_PASSWORD,
  };
  const config = configSchema.parse(withFallbacks);
  if (config.SIGNING_KEY_FILE === undefined && config.SIGNING_KEY_SECRET === undefined) {
    throw new Error('SIGNING_KEY_FILE or SIGNING_KEY_SECRET is required');
  }
  return config;
}
