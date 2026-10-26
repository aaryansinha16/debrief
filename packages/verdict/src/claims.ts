import { type Event, claimAttrsSchema, compareKeys, timelineKey } from '@debrief/schema';

import type { ClaimRecord, ParamValue } from './types.js';

const PARAM = /^claim\.param\.([a-z][a-z0-9_]*)$/;

export function claimOf(event: Event): ClaimRecord | undefined {
  if (event.kind !== 'claim' || event.target === undefined) return undefined;
  const parsed = claimAttrsSchema.safeParse(event.attrs);
  if (!parsed.success) return undefined;
  const params: Record<string, ParamValue> = {};
  for (const [key, value] of Object.entries(event.attrs)) {
    const name = PARAM.exec(key)?.[1];
    if (name !== undefined && typeof value !== 'boolean') params[name] = value;
  }
  return {
    id: event.id,
    seq: event.seq,
    runId: event.runId,
    saidAt: event.sourceTs,
    text: parsed.data['claim.text'],
    modality: parsed.data['claim.modality'],
    predicate: parsed.data['claim.predicate'],
    subject: event.target,
    params,
  };
}

// Claims in the order they were said, deduplicated by id, whatever order the events arrived in.
export function claimsOf(events: readonly Event[]): ClaimRecord[] {
  const byId = new Map<string, { claim: ClaimRecord; event: Event }>();
  for (const event of events) {
    const claim = claimOf(event);
    if (claim !== undefined && !byId.has(event.id)) byId.set(event.id, { claim, event });
  }
  return [...byId.values()]
    .sort((a, b) => compareKeys(timelineKey(a.event), timelineKey(b.event)))
    .map((entry) => entry.claim);
}
