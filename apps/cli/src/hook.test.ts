import { describe, expect, it } from 'vitest';

import { transcriptBatches } from './hook.js';

const SESSION = '5d1c7a90-1b2e-4c3d-9e8f-0a1b2c3d4e5f';

const said = (n: number): string =>
  `${JSON.stringify({
    type: 'assistant',
    uuid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    timestamp: '2026-10-26T09:15:02.123Z',
    message: { role: 'assistant', content: [{ type: 'text', text: `step ${String(n)}` }] },
  })}\n`;

describe('transcriptBatches', () => {
  it('cuts batches on line boundaries by event count and size, keeping lines with no events', () => {
    const lines = [said(1), '{"type":"system"}\n', said(2), said(3)].map((text, n, all) => ({
      text: text.trimEnd(),
      end: all.slice(0, n + 1).join('').length,
    }));
    expect(transcriptBatches(lines, SESSION, 2, 1e9).map((b) => [b.events.length, b.end])).toEqual([
      [2, lines[2]!.end],
      [1, lines[3]!.end],
    ]);
    expect(transcriptBatches(lines, SESSION, 99, 10).map((b) => b.events.length)).toEqual([
      1, 1, 1,
    ]);
    expect(transcriptBatches([], SESSION, 1, 1)).toEqual([]);
  });
});
