import { type TranscriptLine } from './session-state.js';
import { lineEvents } from './transcript.js';
import type { WireEvent } from './wire.js';

interface Batch {
  events: WireEvent[];
  end?: number;
  git?: string;
}

export function transcriptBatches(
  lines: readonly TranscriptLine[],
  sessionId: string,
  maxEvents: number,
  maxBytes: number,
): Batch[] {
  const batches: Batch[] = [];
  let current: Batch = { events: [] };
  let bytes = 0;
  for (const line of lines) {
    const events = lineEvents(line.text, sessionId);
    const size = events.reduce((total, event) => total + JSON.stringify(event).length, 0);
    const full = current.events.length + events.length > maxEvents || bytes + size > maxBytes;
    if (current.events.length > 0 && full) {
      batches.push(current);
      current = { events: [] };
      bytes = 0;
    }
    current.events.push(...events);
    current.end = line.end;
    bytes += size;
  }
  if (current.end !== undefined) batches.push(current);
  return batches;
}
