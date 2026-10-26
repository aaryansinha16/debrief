import { ATTR, type Actor, redactSecrets, sourceTimestampSchema } from '@debrief/schema';
import { z } from 'zod';

import type { WireEvent } from './wire.js';

export const MAX_CONTENT_CHARS = 64 * 1024;

const blockSchema = z.looseObject({ type: z.string() });

// Claude Code's transcript format is internal and changes between releases: read only these fields, skip the rest.
const lineSchema = z.looseObject({
  type: z.enum(['user', 'assistant']),
  uuid: z.string().min(1).max(200),
  timestamp: sourceTimestampSchema,
  isSidechain: z.boolean().optional(),
  isMeta: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
  message: z.looseObject({
    model: z.string().optional(),
    content: z.union([z.string(), z.array(blockSchema)]),
  }),
});

const textBlock = z.looseObject({ type: z.literal('text'), text: z.string() });
type Line = z.infer<typeof lineSchema>;

function clip(text: string): string {
  const masked = redactSecrets(text).text;
  return masked.length <= MAX_CONTENT_CHARS
    ? masked
    : `${masked.slice(0, MAX_CONTENT_CHARS)}…[+${String(masked.length - MAX_CONTENT_CHARS)} chars]`;
}

function agentActor(line: Line): Actor {
  const actor: Actor = line.isSidechain
    ? { type: 'subagent', id: 'claude-code-subagent' }
    : { type: 'agent', id: 'claude-code' };
  if (line.message.model !== undefined) actor.name = line.message.model;
  return actor;
}

function blockEvent(
  line: Line,
  block: unknown,
  index: number,
  sessionId: string,
): WireEvent | undefined {
  const base = {
    source: 'api' as const,
    provenance: 'reported' as const,
    sourceId: `${line.uuid}:${String(index)}`,
    sourceTs: line.timestamp,
    runId: sessionId,
    attrs: { [ATTR.conversationId]: sessionId },
  };
  const text = textBlock.safeParse(block);
  if (text.success && text.data.text.trim() !== '') {
    const said = line.type === 'assistant' || line.isSidechain === true;
    const actor: Actor = said ? agentActor(line) : { type: 'human', id: 'user' };
    const key = line.type === 'assistant' ? ATTR.outputMessages : ATTR.inputMessages;
    const summary = line.type === 'assistant' ? 'assistant message' : 'user message';
    return {
      ...base,
      kind: 'agent.message',
      actor,
      summary,
      content: { [key]: clip(text.data.text) },
    };
  }
  return undefined;
}

export function lineEvents(raw: string, sessionId: string): WireEvent[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const parsed = lineSchema.safeParse(json);
  if (!parsed.success) return [];
  const line = parsed.data;
  if (line.isMeta === true || line.isCompactSummary === true) return [];
  const blocks =
    typeof line.message.content === 'string'
      ? [{ type: 'text', text: line.message.content }]
      : line.message.content;
  return blocks.flatMap((block, index) => {
    const event = blockEvent(line, block, index, sessionId);
    return event === undefined ? [] : [event];
  });
}
