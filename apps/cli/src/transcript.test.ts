import { eventInputSchema, isContentAttribute } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import { MAX_CONTENT_CHARS, lineEvents } from './transcript.js';

const SESSION = '5d1c7a90-1b2e-4c3d-9e8f-0a1b2c3d4e5f';

const line = (patch: Record<string, unknown>): string =>
  JSON.stringify({
    type: 'assistant',
    uuid: 'a1b2c3d4-0000-4000-8000-000000000001',
    timestamp: '2026-10-26T09:15:02.123Z',
    sessionId: SESSION,
    isSidechain: false,
    message: { role: 'assistant', model: 'claude-test-1', content: [] },
    ...patch,
  });

const message = (content: unknown, extra: Record<string, unknown> = {}) => ({
  message: { role: 'assistant', model: 'claude-test-1', content, ...extra },
});

describe('lineEvents', () => {
  it('maps assistant text to an agent message with the words as content', () => {
    const [event] = lineEvents(
      line(message([{ type: 'text', text: 'All 42 tests pass.' }])),
      SESSION,
    );
    expect(event).toEqual({
      source: 'api',
      provenance: 'reported',
      kind: 'agent.message',
      sourceId: 'a1b2c3d4-0000-4000-8000-000000000001:0',
      sourceTs: '2026-10-26T09:15:02.123Z',
      runId: SESSION,
      actor: { type: 'agent', id: 'claude-code', name: 'claude-test-1' },
      attrs: { 'gen_ai.conversation.id': SESSION },
      summary: 'assistant message',
      content: { 'gen_ai.output.messages': 'All 42 tests pass.' },
    });
  });

  it('maps a user prompt to a human message', () => {
    const prompt = lineEvents(
      line({ type: 'user', message: { role: 'user', content: 'deploy it' } }),
      SESSION,
    );
    expect(prompt[0]).toMatchObject({
      kind: 'agent.message',
      actor: { type: 'human', id: 'user' },
      content: { 'gen_ai.input.messages': 'deploy it' },
    });
  });

  it('skips meta lines, compaction summaries, thinking, blank text and unknown lines', () => {
    const skipped = [
      line({ isMeta: true, type: 'user', message: { role: 'user', content: 'caveat' } }),
      line({ isCompactSummary: true, type: 'user', message: { role: 'user', content: 'summary' } }),
      line(message([{ type: 'thinking', thinking: 'hmm', signature: 's' }])),
      line(message([{ type: 'text', text: '   ' }])),
      line(message([{ type: 'tool_result', tool_use_id: 't', content: 'misplaced' }])),
      line({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_use', id: 'x', name: 'y' }] },
      }),
      line({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'z' }] },
      }),
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'u',
        timestamp: 'yesterday',
        message: { content: [] },
      }),
      '{"type":"assistant",',
    ];
    expect(skipped.flatMap((raw) => lineEvents(raw, SESSION))).toEqual([]);
  });

  it('clips long content and keeps every event acceptable to /v1/events', () => {
    const long = 'x'.repeat(MAX_CONTENT_CHARS + 10);
    const [event] = lineEvents(
      line(message([{ type: 'text', text: long }], { model: undefined })),
      SESSION,
    );
    expect(event!.actor).toEqual({ type: 'agent', id: 'claude-code' });
    expect(event!.content!['gen_ai.output.messages']).toBe(
      `${'x'.repeat(MAX_CONTENT_CHARS)}…[+10 chars]`,
    );
    const { content, sourceId: _id, ...input } = event!;
    expect(Object.keys(content!).every(isContentAttribute)).toBe(true);
    const parsed = eventInputSchema.safeParse({
      ...input,
      id: '01JB2W6Q8R0S1T2V3W4X5Y6Z7A',
      ts: '2026-10-26T09:15:03.000Z',
      tenantId: 't1',
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});
