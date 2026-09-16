import { describe, expect, it } from 'vitest';

import { blobSchema, type Blob } from './blob.js';

const validBlob: Blob = {
  sha256: '12'.repeat(32),
  tenantId: 'tenant-a',
  size: 0,
  mime: 'application/json',
  encrypted: true,
  keyId: 'dk-1',
  storageKey: 'tenant-a/12'.padEnd(20, '3'),
  createdAt: '2026-09-17T00:00:00Z',
};

const withField = (patch: Record<string, unknown>): unknown => ({ ...validBlob, ...patch });

describe('blobSchema', () => {
  it('accepts a valid blob, with keyId optional', () => {
    expect(blobSchema.parse(validBlob)).toEqual(validBlob);
    const { keyId: _keyId, ...plain } = validBlob;
    expect(blobSchema.safeParse({ ...plain, encrypted: false }).success).toBe(true);
  });

  it.each([
    ['sha256', '12'.repeat(31)],
    ['size', -1],
    ['size', 2.5],
    ['mime', ''],
    ['encrypted', 'yes'],
    ['keyId', ''],
    ['storageKey', ''],
    ['createdAt', '2026-09-17'],
    ['createdAt', '2026-09-17T00:00:00+01:00'],
    ['extra', 1],
  ])('rejects bad %s', (field, value) => {
    expect(blobSchema.safeParse(withField({ [field]: value })).success).toBe(false);
  });
});
