import { describe, expect, it } from 'vitest';

import { ApiError, ApiNotConfiguredError } from './api';
import { failure } from './proxy';

describe('failure', () => {
  it('maps a missing key to 503, an api error to its status, and rethrows the rest', async () => {
    const unconfigured = failure(new ApiNotConfiguredError());
    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.json()).toEqual({ message: 'DEBRIEF_API_KEY is not set' });
    const notFound = failure(new ApiError(404, '/v1/x', '404 from /v1/x'));
    expect(notFound.status).toBe(404);
    expect(() => failure(new Error('boom'))).toThrow('boom');
  });
});
