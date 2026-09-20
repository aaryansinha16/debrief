import { describe, expect, it } from 'vitest';

import { BODY_LIMIT_BYTES, SMALL_BODY_LIMIT_BYTES, bodyLimitFor } from './hardening.js';

describe('bodyLimitFor', () => {
  it('lets only the ingest routes carry a large body', () => {
    expect(bodyLimitFor('/v1/traces')).toBe(BODY_LIMIT_BYTES);
    expect(bodyLimitFor('/v1/events')).toBe(BODY_LIMIT_BYTES);
    expect(bodyLimitFor('/v1/runs/:id/divergence')).toBe(SMALL_BODY_LIMIT_BYTES);
    expect(bodyLimitFor(undefined)).toBe(SMALL_BODY_LIMIT_BYTES);
  });
});
