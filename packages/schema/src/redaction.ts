import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import type { Attrs, EventInput } from './event.js';

// ARCHITECTURE §6.4; bump when any rule below changes what is persisted.
export const REDACTION_VERSION = 1;
export const REDACTION_ATTR = 'debrief.redaction.v';

export type RedactionKind = 'secret' | 'email' | 'phone' | 'card';

export interface RedactionOptions {
  salt: string;
  maxTextLength?: number;
}

export interface RedactionReport {
  text: string;
  counts: Record<RedactionKind, number>;
  truncated: boolean;
}

export const DEFAULT_MAX_TEXT_LENGTH = 4096;

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^\s'"`]+/g,
  /\b(?:sk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bdbf_[A-Za-z0-9_-]{43}\b/g,
  /\borb_(?:live|test)_[A-Za-z0-9]{6,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g,
];

const ASSIGNED_SECRET =
  /(?<!\[)\b([A-Za-z0-9_-]*?(?:token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential)[A-Za-z0-9_-]*)(\s*[=:]\s*)(?:\\?"([^"\n]{1,256}?)\\?"|'([^'\n]{1,256})'|([^\s"'&,;[\]]{6,}))/gi;

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g;
const PHONE =
  /(?<![\w.-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{3,4}[\s.-]\d{3,4}(?![\w.-])/g;
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;

const digest = (value: string, salt = ''): string =>
  bytesToHex(sha256(utf8ToBytes(`${salt}${value}`))).slice(0, 8);

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

function maskSecrets(input: string, counts: Record<RedactionKind, number>): string {
  let text = input;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match) => {
      counts.secret += 1;
      return `[secret:${digest(match)}]`;
    });
  }
  text = text.replace(
    ASSIGNED_SECRET,
    (_match, name: string, sep: string, dq?: string, sq?: string, bare?: string) => {
      const value = String(dq ?? sq ?? bare);
      const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : '';
      const escaped = dq !== undefined && _match.includes('\\"') ? '\\' : '';
      const close = `${escaped}${quote}`;
      if (value.startsWith('[secret:')) return `${name}${sep}${close}${value}${close}`;
      counts.secret += 1;
      return `${name}${sep}${close}[secret:${digest(value)}]${close}`;
    },
  );
  return text;
}

const emptyCounts = (): Record<RedactionKind, number> => ({
  secret: 0,
  email: 0,
  phone: 0,
  card: 0,
});

// Secrets only, no salt needed: safe to run where the tenant salt is unknown (the MCP proxy).
export function redactSecrets(input: string): RedactionReport {
  const counts = emptyCounts();
  const text = maskSecrets(input, counts);
  return { text, counts, truncated: false };
}

export function redactText(input: string, options: RedactionOptions): RedactionReport {
  const counts = emptyCounts();
  let text = maskSecrets(input, counts);
  text = text.replace(EMAIL, (match) => {
    counts.email += 1;
    return `[email:${digest(match.toLowerCase(), options.salt)}]`;
  });
  text = text.replace(CARD, (match) => {
    const digits = match.replace(/[ -]/g, '');
    if (!luhnValid(digits)) return match;
    counts.card += 1;
    return `[card:${digest(digits, options.salt)}]`;
  });
  text = text.replace(PHONE, (match) => {
    counts.phone += 1;
    return `[phone:${digest(match.replace(/[\s().-]/g, ''), options.salt)}]`;
  });
  const max = options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
  const truncated = text.length > max;
  if (truncated) text = `${text.slice(0, max)}…[+${String(input.length - max)} chars]`;
  return { text, counts, truncated };
}

// Attribute keys whose values are identifiers or enums, never free text.
export const VERBATIM_ATTRS: ReadonlySet<string> = new Set([
  'gen_ai.operation.name',
  'gen_ai.provider.name',
  'gen_ai.request.model',
  'gen_ai.response.model',
  'gen_ai.response.finish_reasons',
  'gen_ai.agent.id',
  'gen_ai.agent.name',
  'gen_ai.conversation.id',
  'gen_ai.tool.name',
  'gen_ai.tool.call.id',
  'gen_ai.tool.type',
  'mcp.method.name',
  'mcp.session.id',
  'service.name',
  'otel.span.kind',
  'otel.status.code',
  'traceparent',
  REDACTION_ATTR,
]);

export function redactAttrs(attrs: Attrs, options: RedactionOptions): Attrs {
  const out: Attrs = {};
  for (const [key, value] of Object.entries(attrs)) {
    out[key] =
      typeof value === 'string' && !VERBATIM_ATTRS.has(key)
        ? redactText(value, options).text
        : value;
  }
  out[REDACTION_ATTR] = REDACTION_VERSION;
  return out;
}

type RedactableEvent = Pick<EventInput, 'attrs' | 'summary' | 'actor' | 'target' | 'authority'>;

const short = (value: string, options: RedactionOptions): string =>
  redactText(value, { ...options, maxTextLength: 280 }).text.slice(0, 280);

// Identifiers (actor.id, target.system, principalId, grantId) stay verbatim; free-text labels do not.
export function redactEvent<T extends RedactableEvent>(event: T, options: RedactionOptions): T {
  const redacted: T = { ...event, attrs: redactAttrs(event.attrs, options) };
  if (event.summary !== undefined) redacted.summary = short(event.summary, options);
  if (event.actor.name !== undefined) {
    redacted.actor = { ...event.actor, name: short(event.actor.name, options) };
  }
  if (event.target !== undefined) {
    const target = { ...event.target };
    if (target.resource !== undefined) target.resource = short(target.resource, options);
    if (target.operation !== undefined) target.operation = short(target.operation, options);
    redacted.target = target;
  }
  if (event.authority?.tokenRef !== undefined) {
    redacted.authority = { ...event.authority, tokenRef: short(event.authority.tokenRef, options) };
  }
  return redacted;
}

export function redactContent(
  content: Record<string, string>,
  options: RedactionOptions,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(content).map(([key, value]) => [key, redactText(value, options).text]),
  );
}
