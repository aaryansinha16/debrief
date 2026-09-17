import { describe, expect, it } from 'vitest';

import { formatDuration, formatTime, shortId } from './format';

describe('format helpers', () => {
  it('shortens ids, prints utc timestamps and human durations', () => {
    expect(shortId('a1ad49b23b7fcebdac2bba6d1a244b1a')).toBe('a1ad49b2…');
    expect(shortId('short')).toBe('short');
    expect(formatTime('2026-09-17T10:35:52.695Z')).toBe('2026-09-17 10:35:52Z');
    expect(formatTime('garbage')).toBe('garbage');
    expect(formatDuration('2026-09-17T10:35:52.000Z', undefined)).toBe('live');
    expect(formatDuration('2026-09-17T10:35:52.000Z', '2026-09-17T10:35:52.400Z')).toBe('400 ms');
    expect(formatDuration('2026-09-17T10:35:52.000Z', '2026-09-17T10:35:58.500Z')).toBe('6.5 s');
    expect(formatDuration('2026-09-17T10:35:00.000Z', '2026-09-17T10:37:30.000Z')).toBe(
      '2 min 30 s',
    );
    expect(formatDuration('2026-09-17T10:35:52.000Z', '2026-09-17T10:35:51.000Z')).toBe('—');
  });
});
