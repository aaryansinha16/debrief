import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

const base = { DATABASE_URL: 'postgres://app:pw@localhost:5432/debrief' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(base)).toEqual({
      NODE_ENV: 'development',
      API_HOST: '0.0.0.0',
      API_PORT: 4000,
      DATABASE_URL: base.DATABASE_URL,
      LOG_LEVEL: 'info',
      RATE_LIMIT_PER_MINUTE: 600,
    });
  });

  it('coerces the port and accepts postgresql urls', () => {
    const config = loadConfig({ ...base, API_PORT: '4100', DATABASE_URL: 'postgresql://x@h/d' });
    expect(config.API_PORT).toBe(4100);
    expect(config.DATABASE_URL).toBe('postgresql://x@h/d');
  });

  it.each([
    ['missing DATABASE_URL', {}],
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
