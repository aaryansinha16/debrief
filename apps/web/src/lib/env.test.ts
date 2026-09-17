import { describe, expect, it } from 'vitest';

import { readEnv } from './env';

const VERIFY = 'http://localhost:5173';

describe('readEnv', () => {
  it('defaults the api and verifier urls and treats empty strings as unset', () => {
    expect(readEnv({})).toEqual({ DEBRIEF_API_URL: 'http://localhost:4000', VERIFY_URL: VERIFY });
    expect(readEnv({ DEBRIEF_API_URL: '', DEBRIEF_API_KEY: '', VERIFY_URL: '' })).toEqual({
      DEBRIEF_API_URL: 'http://localhost:4000',
      VERIFY_URL: VERIFY,
    });
    expect(
      readEnv({
        DEBRIEF_API_URL: 'http://api:4000',
        DEBRIEF_API_KEY: 'k',
        VERIFY_URL: 'https://verify.example',
      }),
    ).toEqual({
      DEBRIEF_API_URL: 'http://api:4000',
      DEBRIEF_API_KEY: 'k',
      VERIFY_URL: 'https://verify.example',
    });
    expect(() => readEnv({ DEBRIEF_API_URL: 'nope' })).toThrow();
    expect(() => readEnv({ VERIFY_URL: 'nope' })).toThrow();
  });
});
