import { packBundle, unpackBundle, verifyBundle } from '@debrief/evidence';
import { demoBundle } from '@debrief/evidence/fixtures';
import { describe, expect, it } from 'vitest';

import { chainLinks, verifyZip } from './flow.js';
import {
  renderChain,
  renderChecks,
  renderHashMatch,
  renderKeyStatus,
  renderReport,
  renderSummary,
} from './render.js';

const demo = demoBundle();
const good = packBundle(demo.input, demo.sign);
const bundle = unpackBundle(good);
const verdict = verifyBundle(bundle);

describe('render', () => {
  it('summarises the three outcomes and escapes what it prints', () => {
    const verified = renderSummary({ kind: 'verified', bundle, verdict });
    expect(verified).toContain('data-outcome="verified"');
    expect(verified).toContain('47 events');
    expect(verified).toContain('2 checkpoints');
    const failedAt = {
      name: 'event-hash' as const,
      ok: false,
      subject: 'e<1>',
      seq: 9,
      detail: 'a & b',
    };
    const broken = renderSummary({ kind: 'broken', bundle, verdict, failedAt });
    expect(broken).toContain('data-outcome="broken" data-seq="9"');
    expect(broken).toContain('seq 9 (e&lt;1&gt;)');
    expect(broken).toContain('a &amp; b');
    const fileLevel = renderSummary({
      kind: 'broken',
      bundle,
      verdict,
      failedAt: { name: 'file-digest', ok: false, subject: 'report.md' },
    });
    expect(fileLevel).toContain('data-seq=""');
    expect(fileLevel).toContain('broken at report.md · file-digest</p>');
    const unreadable = renderSummary({ kind: 'unreadable', file: 'x"y', message: 'bad' });
    expect(unreadable).toContain('data-outcome="unreadable"');
    expect(unreadable).toContain('x&quot;y');
    const single = renderSummary({
      kind: 'verified',
      bundle: { ...bundle, checkpoints: bundle.checkpoints.slice(1) },
      verdict: { ...verdict, checkpoints: 1, events: 1, checks: verdict.checks.slice(0, 1) },
    });
    expect(single).toContain('1 event · 1 checkpoint · 1 check');
  });

  it('counts checks by name, lights links in order, and renders matches, key statuses and the report', () => {
    const checks = renderChecks(verdict);
    expect(checks).toContain('✓ event-inclusion · 47/47');
    const mixed = renderChecks({
      ...verdict,
      checks: [
        { name: 'event-hash', ok: true, subject: 'a' },
        { name: 'event-hash', ok: false, subject: 'b' },
      ],
    });
    expect(mixed).toContain('<li class="broken">✗ event-hash · 1/2</li>');
    const chain = renderChain(chainLinks(bundle, verdict));
    expect(chain).toContain('data-testid="chain"');
    expect(chain.match(/class="link ok"/g)).toHaveLength(47);
    expect(chain).toContain('style="--i:0"');
    const long = renderChain(
      Array.from({ length: 200 }, (_, index) => ({
        seq: index,
        id: String(index),
        kind: 'k',
        state: 'ok' as const,
      })),
    );
    expect(long).toContain('style="--i:160"');
    expect(long).not.toContain('style="--i:199"');
    expect(renderHashMatch({ kind: 'event', seq: 3, id: 'e', proven: true })).toContain(
      'inclusion proof holds',
    );
    expect(renderHashMatch({ kind: 'event', seq: 3, id: 'e', proven: false })).toContain(
      'does not hold',
    );
    expect(renderHashMatch({ kind: 'checkpoint-root', treeSize: 30 })).toContain('root hash');
    expect(renderHashMatch({ kind: 'checkpoint-head', treeSize: 49 })).toContain('head hash');
    expect(renderHashMatch({ kind: 'none' })).toContain('not in this bundle');
    expect(renderKeyStatus({ kind: 'confirmed', keyId: 'k' })).toContain('data-key="confirmed"');
    expect(renderKeyStatus({ kind: 'mismatch', keyId: 'k' })).toContain('data-key="mismatch"');
    expect(renderKeyStatus({ kind: 'unknown', keyId: 'k' })).toContain('data-key="unknown"');
    expect(renderKeyStatus({ kind: 'error', message: '<down>' })).toContain('&lt;down&gt;');
    expect(renderReport(bundle)).toContain('report.md (47 events)');
    expect(renderReport(bundle)).toContain('## Timeline');
    const outcome = verifyZip(good);
    expect(outcome.kind).toBe('verified');
  });
});
