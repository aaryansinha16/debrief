import { z } from 'zod';

export class WitnessPayloadError extends Error {
  constructor(
    readonly what: string,
    message: string,
  ) {
    super(`${what}: ${message}`);
    this.name = 'WitnessPayloadError';
  }
}

const userSchema = z.object({ login: z.string().min(1), type: z.string().optional() });
const repositorySchema = z.object({ full_name: z.string().min(1) });
const timestampSchema = z.iso.datetime({ offset: true });

export const pullRequestSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.string(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  closed_at: timestampSchema.nullable().optional(),
  merged_at: timestampSchema.nullable().optional(),
  merge_commit_sha: z.string().nullable().optional(),
  user: userSchema,
  merged_by: userSchema.nullable().optional(),
  head: z.object({ sha: z.string().min(1), ref: z.string() }),
  base: z.object({ ref: z.string() }),
});

export const workflowRunSchema = z.object({
  id: z.number().int(),
  name: z.string().nullable().optional(),
  run_attempt: z.number().int().default(1),
  event: z.string().optional(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  head_sha: z.string().min(1),
  head_branch: z.string().nullable().optional(),
  updated_at: timestampSchema,
  actor: userSchema.nullable().optional(),
  triggering_actor: userSchema.nullable().optional(),
});

export const checkRunSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  head_sha: z.string().min(1),
  completed_at: timestampSchema.nullable(),
  app: z
    .object({ slug: z.string().min(1) })
    .nullable()
    .optional(),
  check_suite: z.object({ id: z.number().int() }).nullable().optional(),
});

export const jobSchema = z.object({
  id: z.number().int(),
  status: z.string(),
  conclusion: z.string().nullable(),
});

export const jobsResponseSchema = z.object({ jobs: z.array(jobSchema) });

const pushSchema = z.object({
  ref: z.string(),
  before: z.string(),
  after: z.string(),
  deleted: z.boolean().optional(),
  repository: repositorySchema.extend({ pushed_at: z.union([z.number(), z.string()]) }),
  sender: userSchema,
});

const deleteSchema = z.object({
  ref: z.string(),
  ref_type: z.enum(['branch', 'tag']),
  repository: repositorySchema,
  sender: userSchema,
});

const pullRequestEventSchema = z.object({
  action: z.string(),
  pull_request: pullRequestSchema,
  repository: repositorySchema,
});

const workflowRunEventSchema = z.object({
  action: z.string(),
  workflow_run: workflowRunSchema,
  repository: repositorySchema,
});

const checkRunEventSchema = z.object({
  action: z.string(),
  check_run: checkRunSchema,
  repository: repositorySchema,
});

export const restPushEventSchema = z.object({
  type: z.literal('PushEvent'),
  actor: userSchema,
  created_at: timestampSchema,
  payload: z.object({ ref: z.string(), before: z.string(), head: z.string() }),
});

export const restDeleteEventSchema = z.object({
  type: z.literal('DeleteEvent'),
  actor: userSchema,
  created_at: timestampSchema,
  payload: z.object({ ref: z.string(), ref_type: z.enum(['branch', 'tag']) }),
});

export const webhookSchemas = {
  push: pushSchema,
  delete: deleteSchema,
  pull_request: pullRequestEventSchema,
  workflow_run: workflowRunEventSchema,
  check_run: checkRunEventSchema,
} as const;

export type PullRequest = z.infer<typeof pullRequestSchema>;
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type CheckRun = z.infer<typeof checkRunSchema>;
export type Job = z.infer<typeof jobSchema>;
export type RestPushEvent = z.infer<typeof restPushEventSchema>;
export type RestDeleteEvent = z.infer<typeof restDeleteEventSchema>;
export type User = z.infer<typeof userSchema>;

export function parsePayload<T>(what: string, schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new WitnessPayloadError(
    what,
    `${issue?.path.join('.') ?? 'payload'}: ${issue?.message ?? 'invalid'}`,
  );
}
