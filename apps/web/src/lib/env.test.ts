import { describe, expect, it } from 'vitest';

import { readEnv } from './env';

describe('readEnv', () => {
  it('defaults the api url and treats empty strings as unset', () => {
    expect(readEnv({})).toEqual({ DEBRIEF_API_URL: 'http://localhost:4000' });
    expect(readEnv({ DEBRIEF_API_URL: '', DEBRIEF_API_KEY: '' })).toEqual({
      DEBRIEF_API_URL: 'http://localhost:4000',
    });
    expect(readEnv({ DEBRIEF_API_URL: 'http://api:4000', DEBRIEF_API_KEY: 'k' })).toEqual({
      DEBRIEF_API_URL: 'http://api:4000',
      DEBRIEF_API_KEY: 'k',
    });
    expect(() => readEnv({ DEBRIEF_API_URL: 'nope' })).toThrow();
  });
});
