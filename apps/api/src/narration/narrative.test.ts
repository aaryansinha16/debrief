import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { describe, expect, it } from 'vitest';

import {
  MIN_SENTENCES,
  SYSTEM_PROMPT,
  eventsHash,
  feedback,
  narrationEvents,
  parseNarrative,
  userPrompt,
  validateNarrative,
} from './narrative.js';

const events = demoRunFixture().filter((event) => event.runId === DEMO_RUN_ID);
const ids = new Set(events.map((event) => event.id));

describe('eventsHash', () => {
  it('is order-independent over the same events and changes with any event', () => {
    const hash = eventsHash(events);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(eventsHash([...events].reverse())).toBe(hash);
    expect(eventsHash(events.slice(0, -1))).not.toBe(hash);
    expect(
      eventsHash([...events.slice(0, -1), { ...events.at(-1)!, hash: 'f'.repeat(64) }]),
    ).not.toBe(hash);
  });
});

describe('narrationEvents', () => {
  it('projects ids, kinds, actors, targets and summaries in seq order, capped, and nothing else', () => {
    const lines = narrationEvents([...events].reverse(), 10);
    expect(lines).toHaveLength(10);
    expect(lines.map((line) => line.seq)).toEqual(
      [...lines.map((line) => line.seq)].sort((a, b) => a - b),
    );
    for (const line of lines) {
      expect(Object.keys(line).sort()).toEqual(
        [
          'actor',
          'id',
          'kind',
          'provenance',
          'seq',
          'ts',
          ...(line.target === undefined ? [] : ['target']),
          ...(line.summary === undefined ? [] : ['summary']),
        ].sort(),
      );
    }
    const all = narrationEvents(events, 400);
    expect(
      all.find((line) => line.kind === 'tool.call' && line.target?.includes('deleteVolume'))
        ?.target,
    ).toBe('extension deleteVolume');
    expect(
      all.find((line) => line.kind === 'world.change' && line.target?.includes('deleteVolume'))
        ?.target,
    ).toBe('orbital production:volumes:deleteVolume');
    expect(all.find((line) => line.kind === 'mcp.request')?.target).toBe('orbital-mcp listVolumes');
    expect(JSON.stringify(narrationEvents(events, 400))).not.toContain('payloadSha256');
    expect(JSON.stringify(narrationEvents(events, 400))).not.toContain('attrs');
    const prompt = userPrompt(lines);
    expect(prompt.startsWith('Events of the run (10):\n{')).toBe(true);
    expect(prompt.split('\n')).toHaveLength(13);
    expect(SYSTEM_PROMPT).toContain(`between ${String(MIN_SENTENCES)} and`);
  });
});

describe('parseNarrative', () => {
  const good = JSON.stringify({ sentences: [{ text: 'a', eventIds: ['x'] }] });

  it('reads bare json, fenced json and json with prose around it, and rejects the rest', () => {
    expect(parseNarrative(good)).toEqual({ sentences: [{ text: 'a', eventIds: ['x'] }] });
    expect(parseNarrative(`\`\`\`json\n${good}\n\`\`\``)).toEqual({
      sentences: [{ text: 'a', eventIds: ['x'] }],
    });
    expect(parseNarrative(`Here you go:\n${good}\nDone.`)).toEqual({
      sentences: [{ text: 'a', eventIds: ['x'] }],
    });
    expect(parseNarrative('no json here')).toBeUndefined();
    expect(parseNarrative('{"sentences": []}')).toBeUndefined();
    expect(parseNarrative('{"sentences": [{"text": "", "eventIds": []}]}')).toBeUndefined();
    expect(parseNarrative('{ not json }')).toBeUndefined();
    expect(parseNarrative('}{')).toBeUndefined();
  });
});

describe('validateNarrative', () => {
  const cited = (count: number) => ({
    sentences: Array.from({ length: count }, (_, index) => ({
      text: `sentence ${String(index)}`,
      eventIds: [events[index]!.id],
    })),
  });

  it('accepts five to ten cited sentences and names every problem otherwise', () => {
    expect(validateNarrative(cited(5), ids)).toEqual([]);
    expect(validateNarrative(cited(10), ids)).toEqual([]);
    expect(validateNarrative(cited(4), ids)).toEqual(['only 4 sentences; write at least 5']);
    expect(validateNarrative(cited(11), ids)).toEqual(['11 sentences; write at most 10']);
    const bad = cited(5);
    bad.sentences[1]!.eventIds = [];
    bad.sentences[3]!.eventIds = ['nope', events[0]!.id, 'nah'];
    expect(validateNarrative(bad, ids)).toEqual([
      'sentence 2 cites no events',
      'sentence 4 cites unknown events: nope, nah',
    ]);
    expect(feedback(['sentence 2 cites no events'])).toContain('- sentence 2 cites no events');
    expect(feedback([])).toContain('Rewrite the whole debrief');
  });
});
