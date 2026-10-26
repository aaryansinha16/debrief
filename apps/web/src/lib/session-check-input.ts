import {
  type Event,
  WITNESS_TRUST_ATTR,
  decodeEvidence,
  eventSchema,
  sourceTimestampSchema,
  ulidSchema,
  witnessTrustSchema,
} from '@debrief/schema';
import { z } from 'zod';

export const linkConfidenceSchema = z.enum(['exact', 'strong', 'weak']);

// ARCHITECTURE §18.5: the world event, the tool call it is linked to and how sure the link is (P-65 computes them).
export const sideEffectInputSchema = z.strictObject({
  worldEventId: ulidSchema,
  toolCallId: ulidSchema,
  confidence: linkConfidenceSchema,
  via: z.string().min(1).max(60).optional(),
});

export type SideEffectInput = z.infer<typeof sideEffectInputSchema>;

export const witnessInputSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('connected'),
    system: z.string().min(1),
    trust: witnessTrustSchema,
    observed: z.number().int().min(0),
  }),
  z.strictObject({ state: z.literal('missing'), system: z.string().min(1) }),
]);

export const sessionInputSchema = z.strictObject({
  id: z.string().min(1),
  agent: z.string().min(1),
  project: z.string().min(1).optional(),
  startedAt: sourceTimestampSchema,
  endedAt: sourceTimestampSchema.optional(),
  sample: z.boolean(),
});

interface Issue {
  path: (string | number)[];
  message: string;
}

type Expect = (path: Issue['path'], ok: boolean, message: string) => void;

const thirdParty = (event: Event | undefined): boolean =>
  event?.attrs[WITNESS_TRUST_ATTR] === 'third-party';

function verdictIssues(
  event: Event,
  path: Issue['path'],
  byId: ReadonlyMap<string, Event>,
  expect: Expect,
): void {
  const claim = byId.get(String(event.attrs['verdict.claim_id']));
  expect([...path, 'attrs'], claim?.kind === 'claim', 'verdict for a claim not in the check');
  const evidence = event.attrs['verdict.evidence'];
  const cited = decodeEvidence(typeof evidence === 'string' ? evidence : undefined);
  for (const id of cited) {
    const observed = byId.get(id)?.provenance === 'observed';
    expect([...path, 'attrs'], observed, `evidence ${id} is not observed`);
  }
  // ARCHITECTURE §18.4, as P-64's judge labels it: third-party only when every cited record is third-party.
  if (event.attrs['verdict.trust'] === 'third-party') {
    const backed = cited.every((id) => thirdParty(byId.get(id)));
    expect([...path, 'attrs'], backed, 'a third-party verdict cites a record that is not');
  }
  const supersedes = event.attrs['verdict.supersedes'];
  if (supersedes === undefined) return;
  const earlier = byId.get(String(supersedes));
  expect(
    [...path, 'attrs'],
    earlier?.kind === 'verdict' &&
      earlier.seq < event.seq &&
      earlier.attrs['verdict.claim_id'] === event.attrs['verdict.claim_id'],
    'supersedes no earlier verdict of the same claim',
  );
}

function sideEffectIssues(
  input: { session: { id: string }; sideEffects: readonly SideEffectInput[] },
  byId: ReadonlyMap<string, Event>,
  expect: Expect,
): void {
  input.sideEffects.forEach((effect, index) => {
    const world = byId.get(effect.worldEventId);
    const call = byId.get(effect.toolCallId);
    const path = ['sideEffects', index];
    expect(
      [...path, 'worldEventId'],
      world?.kind === 'world.change' && world.provenance === 'observed',
      'not an observed world change',
    );
    // ARCHITECTURE §18.5: the local git state is the agent's own working copy, never a side effect.
    const git = world?.target?.system === 'git';
    expect([...path, 'worldEventId'], !git, 'local git is never a side effect');
    expect(
      [...path, 'toolCallId'],
      call?.kind === 'tool.call' &&
        call.provenance === 'reported' &&
        call.runId === input.session.id,
      'not a reported tool call of this session',
    );
  });
}

// Every id the check cites is in the payload, of the provenance it claims: nothing on the page is silently dropped.
function inputIssues(input: {
  session: { id: string };
  events: readonly Event[];
  sideEffects: readonly SideEffectInput[];
  witnesses: readonly z.infer<typeof witnessInputSchema>[];
}): Issue[] {
  const byId = new Map(input.events.map((event) => [event.id, event]));
  const issues: Issue[] = [];
  const expect: Expect = (path, ok, message) => {
    if (!ok) issues.push({ path, message });
  };
  input.events.forEach((event, index) => {
    if (event.kind !== 'claim' && event.kind !== 'verdict') return;
    const path = ['events', index];
    const own = event.runId === input.session.id;
    expect([...path, 'runId'], own, `${event.kind} of another session`);
    if (event.kind === 'verdict') verdictIssues(event, path, byId, expect);
  });
  sideEffectIssues(input, byId, expect);
  const systems = input.witnesses.map((witness) => witness.system);
  expect(['witnesses'], new Set(systems).size === systems.length, 'a system is listed twice');
  return issues;
}

// GET /v1/sessions/:id/check (P-65.1): claims, verdicts, every event they cite, side effects and the roster.
export const sessionCheckInputSchema = z
  .strictObject({
    session: sessionInputSchema,
    events: z.array(eventSchema),
    sideEffects: z.array(sideEffectInputSchema),
    witnesses: z.array(witnessInputSchema),
  })
  .superRefine((input, ctx) => {
    for (const issue of inputIssues(input)) ctx.addIssue({ code: 'custom', ...issue });
  });

export type LinkConfidence = z.infer<typeof linkConfidenceSchema>;
export type SessionCheckInput = z.infer<typeof sessionCheckInputSchema>;
