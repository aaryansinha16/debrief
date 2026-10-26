import { describe, expect, it } from 'vitest';

import { replySchema } from './reply.js';

describe('replySchema', () => {
  it('accepts the strict shape and refuses missing or unknown values', () => {
    const one = {
      message_id: 'm1',
      quote: 'Deployed.',
      modality: 'asserted',
      predicate: 'deploy.ready',
      subject: { system: 'vercel', resource: null, environment: 'production', operation: null },
      params: [{ name: 'target', value: 'production' }],
    };
    expect(replySchema.safeParse({ claims: [one] }).success).toBe(true);
    expect(replySchema.safeParse({ claims: [{ ...one, modality: 'sure' }] }).success).toBe(false);
    const { params: _params, ...partial } = one;
    expect(replySchema.safeParse({ claims: [partial] }).success).toBe(false);
    const qa = { ...one, subject: { ...one.subject, environment: 'qa' } };
    expect(replySchema.safeParse({ claims: [qa] }).success).toBe(false);
  });
});
