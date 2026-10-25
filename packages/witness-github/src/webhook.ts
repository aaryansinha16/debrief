import {
  type GithubWireEvent,
  mapCheckRun,
  mapDelete,
  mapPullRequest,
  mapPush,
  mapWorkflowRun,
} from './map.js';
import { type Job, parsePayload, webhookSchemas } from './payloads.js';

export const WEBHOOK_EVENTS = [
  'push',
  'pull_request',
  'workflow_run',
  'check_run',
  'delete',
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

export const isWebhookEvent = (name: string): name is WebhookEventName =>
  (WEBHOOK_EVENTS as readonly string[]).includes(name);

export interface WebhookContext {
  jobs?: readonly Job[];
  // The delete payload has no timestamp; the receiver supplies when it arrived.
  receivedAt?: string;
}

export function mapWebhook(
  name: string,
  payload: unknown,
  context: WebhookContext = {},
): GithubWireEvent[] {
  if (!isWebhookEvent(name)) return [];
  switch (name) {
    case 'push': {
      const body = parsePayload(name, webhookSchemas.push, payload);
      return mapPush({
        repo: body.repository.full_name,
        ref: body.ref,
        before: body.before,
        after: body.after,
        actor: body.sender,
        at: body.repository.pushed_at,
      });
    }
    case 'delete': {
      const body = parsePayload(name, webhookSchemas.delete, payload);
      return mapDelete({
        repo: body.repository.full_name,
        ref: body.ref,
        refType: body.ref_type,
        actor: body.sender,
        at: context.receivedAt ?? new Date().toISOString(),
      });
    }
    case 'pull_request': {
      const body = parsePayload(name, webhookSchemas.pull_request, payload);
      const repo = body.repository.full_name;
      if (body.action === 'opened') return mapPullRequest(repo, body.pull_request, 'opened');
      if (body.action === 'reopened') return mapPullRequest(repo, body.pull_request, 'reopened');
      if (body.action !== 'closed') return [];
      return mapPullRequest(
        repo,
        body.pull_request,
        body.pull_request.merged_at ? 'merged' : 'closed',
      );
    }
    case 'workflow_run': {
      const body = parsePayload(name, webhookSchemas.workflow_run, payload);
      return body.action === 'completed'
        ? mapWorkflowRun(body.repository.full_name, body.workflow_run, context.jobs)
        : [];
    }
    case 'check_run': {
      const body = parsePayload(name, webhookSchemas.check_run, payload);
      return body.action === 'completed'
        ? mapCheckRun(body.repository.full_name, body.check_run)
        : [];
    }
  }
}
