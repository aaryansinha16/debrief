import { z } from 'zod';

import {
  environmentSchema,
  hex64Schema,
  nonEmptyStringSchema,
  riskSchema,
  seqSchema,
  sourceTimestampSchema,
  ulidSchema,
  utcTimestampSchema,
} from './primitives.js';

export const eventKindSchema = z.enum([
  'principal.session',
  'delegation.grant',
  'delegation.revoke',
  'agent.invoke',
  'agent.plan',
  'agent.message',
  'llm.call',
  'tool.call',
  'tool.result',
  'mcp.request',
  'mcp.response',
  'world.change',
  'policy.decision',
  'human.approval',
  'error',
]);

export const eventSourceSchema = z.enum(['otlp', 'mcp-proxy', 'world-hook', 'api']);
export const provenanceSchema = z.enum(['reported', 'observed']);

export const actorSchema = z.strictObject({
  type: z.enum(['human', 'agent', 'subagent', 'system']),
  id: nonEmptyStringSchema,
  name: z.string().optional(),
});

export const authoritySchema = z.strictObject({
  principalId: nonEmptyStringSchema,
  grantId: z.string().optional(),
  tokenRef: z.string().optional(),
  scope: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
});

export const targetSchema = z.strictObject({
  system: nonEmptyStringSchema,
  resource: z.string().optional(),
  environment: environmentSchema.optional(),
  operation: z.string().optional(),
  risk: riskSchema.optional(),
});

export const attrValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export const attrsSchema = z.record(z.string(), attrValueSchema);

export const eventSchema = z.strictObject({
  id: ulidSchema,
  tenantId: nonEmptyStringSchema,
  seq: seqSchema,
  ts: utcTimestampSchema,
  sourceTs: sourceTimestampSchema,
  source: eventSourceSchema,
  provenance: provenanceSchema,
  runId: nonEmptyStringSchema,
  spanId: nonEmptyStringSchema.optional(),
  parentSpanId: nonEmptyStringSchema.optional(),
  kind: eventKindSchema,
  actor: actorSchema,
  authority: authoritySchema.optional(),
  target: targetSchema.optional(),
  attrs: attrsSchema,
  payloadSha256: hex64Schema.optional(),
  summary: z.string().max(280).optional(),
  prevHash: hex64Schema,
  hash: hex64Schema,
});

export const eventInputSchema = eventSchema.omit({ seq: true, prevHash: true, hash: true });

export type EventKind = z.infer<typeof eventKindSchema>;
export type EventSource = z.infer<typeof eventSourceSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type Authority = z.infer<typeof authoritySchema>;
export type Target = z.infer<typeof targetSchema>;
export type AttrValue = z.infer<typeof attrValueSchema>;
export type Attrs = z.infer<typeof attrsSchema>;
export type Event = z.infer<typeof eventSchema>;
export type EventInput = z.infer<typeof eventInputSchema>;
