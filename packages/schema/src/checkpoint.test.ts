import { describe, expect, it } from 'vitest';

import { checkpointSchema, type Checkpoint } from './checkpoint.js';

const validCheckpoint: Checkpoint = {
  tenantId: 'tenant-a',
  treeSize: 1000,
  rootHash: 'cd'.repeat(32),
  headHash: 'ef'.repeat(32),
  ts: '2026-09-17T00:01:00Z',
  keyId: 'k1',
  signature: '01'.repeat(64),
};

const withField = (patch: Record<string, unknown>): unknown => ({ ...validCheckpoint, ...patch });

describe('checkpointSchema', () => {
  it('accepts a valid checkpoint with and without an anchor', () => {
    expect(checkpointSchema.parse(validCheckpoint)).toEqual(validCheckpoint);
    expect(
      checkpointSchema.safeParse(withField({ anchor: { kind: 'rfc3161', ref: 'tsa:1' } })).success,
    ).toBe(true);
  });

  it.each([
    ['treeSize', -1],
    ['treeSize', 1.5],
    ['rootHash', 'zz'.repeat(32)],
    ['headHash', 'ab'.repeat(33)],
    ['ts', '2026-09-17T00:01:00'],
    ['ts', 'now'],
    ['keyId', ''],
    ['signature', '01'.repeat(63)],
    ['signature', 'AB'.repeat(64)],
    ['anchor', { kind: 'blockchain', ref: 'x' }],
    ['anchor', { kind: 'rekor', ref: '' }],
    ['anchor', { kind: 'rekor', ref: 'r', extra: 1 }],
    ['extra', true],
  ])('rejects bad %s', (field, value) => {
    expect(checkpointSchema.safeParse(withField({ [field]: value })).success).toBe(false);
  });
});
