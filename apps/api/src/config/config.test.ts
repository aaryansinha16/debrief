import { describe, expect, it } from 'vitest';

import { loadConfig, resolveFromRepoRoot } from './config.js';

const base = {
  DATABASE_URL: 'postgres://app:pw@localhost:5432/debrief',
  SIGNING_KEY_SECRET: 'ab'.repeat(32),
  BLOB_MASTER_KEY: 'cd'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'debrief',
  MINIO_ROOT_USER: 'debrief',
  MINIO_ROOT_PASSWORD: 'debrief-local-only',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(base)).toEqual({
      NODE_ENV: 'development',
      API_HOST: '0.0.0.0',
      API_PORT: 4000,
      DATABASE_URL: base.DATABASE_URL,
      LOG_LEVEL: 'info',
      RATE_LIMIT_PER_MINUTE: 600,
      SIGNING_KEY_SECRET: base.SIGNING_KEY_SECRET,
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'debrief',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'debrief',
      S3_SECRET_ACCESS_KEY: 'debrief-local-only',
      CHECKPOINT_INTERVAL_MS: 60_000,
      CHECKPOINT_EVERY_EVENTS: 1000,
      BLOB_MASTER_KEY: 'cd'.repeat(32),
      BLOB_MAX_BYTES: 1024 * 1024,
      RUN_DEBOUNCE_MS: 250,
      LIVE_HEARTBEAT_MS: 15_000,
      ANCHOR_KIND: 'none',
      NARRATION_MODEL: 'claude-opus-5',
      NARRATION_MAX_EVENTS: 400,
    });
  });

  it('coerces the port and accepts postgresql urls', () => {
    const config = loadConfig({ ...base, API_PORT: '4100', DATABASE_URL: 'postgresql://x@h/d' });
    expect(config.API_PORT).toBe(4100);
    expect(config.DATABASE_URL).toBe('postgresql://x@h/d');
  });

  it('prefers explicit S3 credentials over the minio fallbacks and accepts a key file', () => {
    const config = loadConfig({
      ...base,
      SIGNING_KEY_SECRET: undefined,
      SIGNING_KEY_FILE: 'debrief.signing-key.json',
      S3_ACCESS_KEY_ID: 'explicit',
      S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(config.S3_ACCESS_KEY_ID).toBe('explicit');
    expect(config.SIGNING_KEY_FILE).toBe('debrief.signing-key.json');
    expect(resolveFromRepoRoot('debrief.signing-key.json')).toMatch(
      /\/debrief\.signing-key\.json$/,
    );
    expect(resolveFromRepoRoot('/abs/key.json')).toBe('/abs/key.json');
  });

  it.each([
    ['missing DATABASE_URL', { ...base, DATABASE_URL: undefined }],
    ['no signing key', { ...base, SIGNING_KEY_SECRET: undefined }],
    ['short signing secret', { ...base, SIGNING_KEY_SECRET: 'ab' }],
    ['missing S3 endpoint', { ...base, S3_ENDPOINT: undefined }],
    ['missing S3 credentials', { ...base, MINIO_ROOT_USER: undefined }],
    ['checkpoint interval too small', { ...base, CHECKPOINT_INTERVAL_MS: '10' }],
    ['missing blob master key', { ...base, BLOB_MASTER_KEY: undefined }],
    ['short blob master key', { ...base, BLOB_MASTER_KEY: 'cd' }],
    ['non-postgres DATABASE_URL', { DATABASE_URL: 'mysql://x' }],
    ['port out of range', { ...base, API_PORT: '70000' }],
    ['fractional port', { ...base, API_PORT: '40.5' }],
    ['unknown NODE_ENV', { ...base, NODE_ENV: 'staging' }],
    ['unknown LOG_LEVEL', { ...base, LOG_LEVEL: 'verbose' }],
    ['zero rate limit', { ...base, RATE_LIMIT_PER_MINUTE: '0' }],
  ])('rejects %s', (_label, env) => {
    expect(() => loadConfig(env)).toThrow();
  });
});
