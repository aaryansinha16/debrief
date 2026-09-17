import { canonicalize, sha256Hex } from '@debrief/chain';
import { type Event, type Target, targetDescriptor } from '@debrief/schema';
import { z } from 'zod';

export interface NarrativeSentence {
  text: string;
  eventIds: string[];
}

export const narrativeSchema = z.object({
  sentences: z.array(z.object({ text: z.string().min(1), eventIds: z.array(z.string()) })).min(1),
});

export type Narrative = z.infer<typeof narrativeSchema>;

export const MIN_SENTENCES = 5;
export const MAX_SENTENCES = 10;

// The cache key: the run's events in order, by their chain hashes, so any appended event yields a new narrative.
export const eventsHash = (events: readonly Event[]): string =>
  sha256Hex(
    new TextEncoder().encode(
      canonicalize([...events].sort((a, b) => a.seq - b.seq).map((event) => event.hash)),
    ),
  );

export interface NarrationEvent {
  id: string;
  seq: number;
  ts: string;
  kind: string;
  provenance: Event['provenance'];
  actor: string;
  target?: string;
  summary?: string;
}

// "system env:class:operation" when the event knows its resource, else "system operation", else the system.
const describeTarget = (target: Target): string => {
  const descriptor = targetDescriptor(target);
  const detail = descriptor ?? target.operation;
  return detail === undefined ? target.system : `${target.system} ${detail}`;
};

// What the model sees: ids, kinds, actors, target descriptors and the redacted summaries; never payloads or blobs.
export function narrationEvents(events: readonly Event[], max: number): NarrationEvent[] {
  return [...events]
    .sort((a, b) => a.seq - b.seq)
    .slice(0, max)
    .map((event) => {
      const line: NarrationEvent = {
        id: event.id,
        seq: event.seq,
        ts: event.ts,
        kind: event.kind,
        provenance: event.provenance,
        actor: event.actor.name ?? event.actor.id,
      };
      if (event.target !== undefined) line.target = describeTarget(event.target);
      if (event.summary !== undefined) line.summary = event.summary;
      return line;
    });
}

export const SYSTEM_PROMPT = `You write the plain-language debrief of one AI agent run for an incident review.
You are given the run's recorded events, one JSON object per line, in order. "reported" events come from the agent's own telemetry; "observed" events come from the systems it touched.
Write between ${String(MIN_SENTENCES)} and ${String(MAX_SENTENCES)} sentences that tell what happened, in order, naming who authorised what, what was touched, and what went wrong.
Every sentence must rest on specific events: cite their ids. Never invent an event, an id, a cause or an outcome that the events do not show. Say "reported" or "observed" where the distinction matters.
Answer with JSON only, no prose around it, in exactly this shape:
{"sentences":[{"text":"<one sentence>","eventIds":["<id>", "..."]}, ...]}`;

export const userPrompt = (lines: readonly NarrationEvent[]): string =>
  `Events of the run (${String(lines.length)}):\n${lines.map((line) => JSON.stringify(line)).join('\n')}\n\nWrite the debrief as JSON.`;

// The answer is JSON, possibly wrapped in a code fence; anything else is a rejected narrative.
export function parseNarrative(text: string): Narrative | undefined {
  const trimmed = text.trim();
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)?.[1] ?? trimmed;
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = narrativeSchema.safeParse(JSON.parse(unfenced.slice(start, end + 1)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// ARCHITECTURE §9: the API rejects sentences without citations, and a citation must be one of the run's own events.
export function validateNarrative(narrative: Narrative, knownIds: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  if (narrative.sentences.length < MIN_SENTENCES) {
    problems.push(
      `only ${String(narrative.sentences.length)} sentences; write at least ${String(MIN_SENTENCES)}`,
    );
  }
  if (narrative.sentences.length > MAX_SENTENCES) {
    problems.push(
      `${String(narrative.sentences.length)} sentences; write at most ${String(MAX_SENTENCES)}`,
    );
  }
  narrative.sentences.forEach((sentence, index) => {
    const position = String(index + 1);
    if (sentence.eventIds.length === 0) problems.push(`sentence ${position} cites no events`);
    const unknown = sentence.eventIds.filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      problems.push(`sentence ${position} cites unknown events: ${unknown.join(', ')}`);
    }
  });
  return problems;
}

export const feedback = (problems: readonly string[]): string =>
  `That debrief was rejected:\n${problems.map((problem) => `- ${problem}`).join('\n')}\nRewrite the whole debrief as JSON, every sentence citing only ids from the events given.`;
