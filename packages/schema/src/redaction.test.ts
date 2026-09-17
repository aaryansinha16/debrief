import { describe, expect, it } from 'vitest';

import type { EventInput } from './event.js';
import { REDACTION_FIXTURES } from './redaction-fixtures.js';
import {
  DEFAULT_MAX_TEXT_LENGTH,
  REDACTION_ATTR,
  REDACTION_VERSION,
  luhnValid,
  redactAttrs,
  redactContent,
  redactEvent,
  redactSecrets,
  redactText,
} from './redaction.js';

const salt = 'tenant-salt';

describe('redactText', () => {
  it.each(REDACTION_FIXTURES)('$name', (fixture) => {
    const report = redactText(fixture.input, { salt });
    for (const secret of fixture.mustNotContain) expect(report.text).not.toContain(secret);
    expect(report.counts).toEqual({
      secret: fixture.expectSecrets,
      email: fixture.expectEmails,
      phone: fixture.expectPhones,
      card: fixture.expectCards,
    });
    expect(report.truncated).toBe(false);
    if (fixture.mustNotContain.length === 0) expect(report.text).toBe(fixture.input);
  });

  it('replaces secrets with a stable, unsalted 8-hex digest marker', () => {
    const a = redactText('token=orb_live_abcdef', { salt: 'x' }).text;
    const b = redactText('token=orb_live_abcdef', { salt: 'y' }).text;
    expect(a).toMatch(/^token=\[secret:[0-9a-f]{8}\]$/);
    expect(a).toBe(b);
    expect(redactText('token=orb_live_abcdeg', { salt: 'x' }).text).not.toBe(a);
  });

  it('hashes pii with the tenant salt, case-insensitively for emails', () => {
    const a = redactText('A@Example.com', { salt: 'one' }).text;
    expect(a).toMatch(/^\[email:[0-9a-f]{8}\]$/);
    expect(redactText('a@example.com', { salt: 'one' }).text).toBe(a);
    expect(redactText('a@example.com', { salt: 'two' }).text).not.toBe(a);
  });

  it('only treats luhn-valid digit runs as cards', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
    expect(luhnValid('123')).toBe(false);
    expect(redactText('order 4111111111111112 shipped', { salt }).counts.card).toBe(0);
    expect(redactText('card 5500-0000-0000-0004 ok', { salt }).text).toMatch(
      /card \[card:[0-9a-f]{8}\] ok/,
    );
  });

  it('caps free text and reports the truncation', () => {
    const long = 'a'.repeat(DEFAULT_MAX_TEXT_LENGTH + 10);
    const report = redactText(long, { salt });
    expect(report.truncated).toBe(true);
    expect(report.text.endsWith('…[+10 chars]')).toBe(true);
    expect(redactText('short', { salt, maxTextLength: 3 }).text).toBe('sho…[+2 chars]');
  });

  it('masks bare, single-quoted and double-quoted assigned values', () => {
    expect(redactText('token=abcdef123456 x', { salt }).text).toMatch(
      /^token=\[secret:[0-9a-f]{8}\] x$/,
    );
    expect(redactText("passwd='hunter22x'", { salt }).text).toMatch(
      /^passwd='\[secret:[0-9a-f]{8}\]'$/,
    );
    expect(redactText('Api-Key: "a b c d"', { salt }).text).toMatch(
      /^Api-Key: "\[secret:[0-9a-f]{8}\]"$/,
    );
    expect(redactText('token=short', { salt }).counts.secret).toBe(0);
  });

  it('masks assigned values inside json-encoded text', () => {
    const encoded = JSON.stringify({ prompt: 'password: "correct horse" and token=abcdef123456' });
    const report = redactText(encoded, { salt });
    expect(report.text).not.toContain('correct horse');
    expect(report.text).not.toContain('abcdef123456');
    expect(report.counts.secret).toBe(2);
    expect(() => JSON.parse(report.text) as unknown).not.toThrow();
    for (const fixture of REDACTION_FIXTURES) {
      const inner = redactText(JSON.stringify([{ content: fixture.input }]), { salt }).text;
      for (const secret of fixture.mustNotContain)
        expect(inner, fixture.name).not.toContain(secret);
    }
  });

  it('redactSecrets masks secrets but leaves pii for the server side', () => {
    const report = redactSecrets('mail a@b.co token=abcdef123456 card 4111 1111 1111 1111');
    expect(report.text).toMatch(
      /^mail a@b.co token=\[secret:[0-9a-f]{8}\] card 4111 1111 1111 1111$/,
    );
    expect(report.counts).toEqual({ secret: 1, email: 0, phone: 0, card: 0 });
    expect(report.truncated).toBe(false);
  });

  it('does not double-mask an already redacted assignment', () => {
    const once = redactText('api_key=sk-abcdefghijklmnopqrstuvwxyz', { salt });
    expect(once.counts.secret).toBe(1);
    const twice = redactText(once.text, { salt });
    expect(twice.text).toBe(once.text);
    expect(twice.counts.secret).toBe(0);
    const quoted = redactText('token="[secret:abcdef12]"', { salt });
    expect(quoted.text).toBe('token="[secret:abcdef12]"');
    expect(quoted.counts.secret).toBe(0);
  });
});

describe('redactAttrs and redactEvent', () => {
  const input: EventInput = {
    id: '01J8ZK5R4M2X6P9Q3V7W1Y5N8B',
    tenantId: 't',
    ts: '2026-09-17T00:00:00.000Z',
    sourceTs: '2026-09-17T00:00:00.000Z',
    source: 'api',
    provenance: 'reported',
    runId: 'r',
    kind: 'tool.result',
    actor: { type: 'agent', id: 'a' },
    attrs: {
      'gen_ai.tool.name': 'readFile',
      'gen_ai.request.model': 'sk-looks-like-a-key-but-is-verbatim-1234',
      'otel.span.name': 'read ORBITAL_TOKEN=orb_live_9f3aQ7xLm2',
      'debrief.result.bytes': 412,
      ok: true,
    },
    summary: 'contact ops@example.com with token orb_live_9f3aQ7xLm2 ' + 'x'.repeat(300),
  };

  it('redacts free-text attrs, keeps verbatim keys and non-strings, and stamps the version', () => {
    const attrs = redactAttrs(input.attrs, { salt });
    expect(attrs['gen_ai.request.model']).toBe('sk-looks-like-a-key-but-is-verbatim-1234');
    expect(attrs['otel.span.name']).toMatch(/^read ORBITAL_TOKEN=\[secret:[0-9a-f]{8}\]$/);
    expect(attrs['debrief.result.bytes']).toBe(412);
    expect(attrs.ok).toBe(true);
    expect(attrs[REDACTION_ATTR]).toBe(REDACTION_VERSION);
  });

  it('redacts the summary and caps it at 280 characters', () => {
    const event = redactEvent(input, { salt });
    expect(event.summary).not.toContain('orb_live_9f3aQ7xLm2');
    expect(event.summary).not.toContain('ops@example.com');
    expect(event.summary!.length).toBeLessThanOrEqual(280);
    expect(event.attrs[REDACTION_ATTR]).toBe(REDACTION_VERSION);
    expect(input.attrs[REDACTION_ATTR]).toBeUndefined();
    const { summary: _summary, ...noSummary } = input;
    expect(redactEvent(noSummary, { salt })).not.toHaveProperty('summary');
  });

  it('redacts free-text labels on actor, target and authority but keeps identifiers', () => {
    const event = redactEvent(
      {
        ...input,
        actor: { type: 'agent', id: 'agent:orb_live_9f3aQ7xLm2', name: 'bot orb_live_9f3aQ7xLm2' },
        target: {
          system: 'orbital',
          resource: 'files/orb_live_9f3aQ7xLm2',
          operation: 'Retriever ORBITAL_TOKEN=orb_live_9f3aQ7xLm2',
        },
        authority: { principalId: 'human:a', tokenRef: 'orb_live_9f3aQ7xLm2' },
      },
      { salt },
    );
    expect(event.actor.id).toBe('agent:orb_live_9f3aQ7xLm2');
    expect(event.actor.name).toMatch(/^bot \[secret:[0-9a-f]{8}\]$/);
    expect(event.target.system).toBe('orbital');
    expect(event.target.resource).toMatch(/^files\/\[secret:[0-9a-f]{8}\]$/);
    expect(event.target.operation).toMatch(/^Retriever ORBITAL_TOKEN=\[secret:[0-9a-f]{8}\]$/);
    expect(event.authority.tokenRef).toMatch(/^\[secret:[0-9a-f]{8}\]$/);
    expect(event.authority.principalId).toBe('human:a');
    const bare = redactEvent(
      { ...input, target: { system: 's' }, authority: { principalId: 'p' } },
      { salt },
    );
    expect(bare.target).toEqual({ system: 's' });
    expect(bare.authority).toEqual({ principalId: 'p' });
  });

  it('redacts every content entry', () => {
    const content = redactContent(
      {
        'gen_ai.input.messages': 'mail a@b.co',
        'gen_ai.tool.call.result': 'ORBITAL_TOKEN=orb_live_9f3aQ7xLm2',
      },
      { salt },
    );
    expect(content['gen_ai.input.messages']).toMatch(/^mail \[email:[0-9a-f]{8}\]$/);
    expect(content['gen_ai.tool.call.result']).toMatch(/^ORBITAL_TOKEN=\[secret:[0-9a-f]{8}\]$/);
  });
});
