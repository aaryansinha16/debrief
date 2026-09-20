import type { Bundle, BundleVerification } from '@debrief/evidence';

import type { HashMatch, KeyStatus, LinkState, Outcome } from './flow.js';

const escape = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const plural = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

export function renderSummary(outcome: Outcome): string {
  if (outcome.kind === 'unreadable') {
    return `<p class="verdict broken" data-testid="verdict" data-outcome="unreadable">✗ not a Debrief bundle · <span class="mono">${escape(outcome.file)}</span>: ${escape(outcome.message)}</p>`;
  }
  const { bundle, verdict } = outcome;
  const head = `<span class="mono">${escape(bundle.manifest.runIds.join(', '))}</span> · tenant <span class="mono">${escape(bundle.manifest.tenantId)}</span> · ${plural(verdict.events, 'event')} · ${plural(verdict.checkpoints, 'checkpoint')} · ${plural(verdict.checks.length, 'check')} · key <span class="mono">${escape(bundle.manifest.keyId)}</span>`;
  if (outcome.kind === 'verified') {
    return `<p class="verdict ok" data-testid="verdict" data-outcome="verified">✓ verified · every hash, proof and signature holds</p><p class="detail">${head}</p>`;
  }
  const at = outcome.failedAt;
  const where =
    at.seq === undefined ? escape(at.subject) : `seq ${String(at.seq)} (${escape(at.subject)})`;
  return `<p class="verdict broken" data-testid="verdict" data-outcome="broken" data-seq="${at.seq === undefined ? '' : String(at.seq)}">✗ broken at ${where} · ${escape(at.name)}${at.detail === undefined ? '' : ` · ${escape(at.detail)}`}</p><p class="detail">${head}</p>`;
}

export function renderChecks(verdict: BundleVerification): string {
  const counts = new Map<string, { ok: number; total: number }>();
  for (const check of verdict.checks) {
    const entry = counts.get(check.name) ?? { ok: 0, total: 0 };
    entry.total += 1;
    if (check.ok) entry.ok += 1;
    counts.set(check.name, entry);
  }
  return `<ul class="checks" data-testid="checks">${[...counts.entries()]
    .map(
      ([name, entry]) =>
        `<li class="${entry.ok === entry.total ? 'ok' : 'broken'}">${entry.ok === entry.total ? '✓' : '✗'} ${escape(name)} · ${String(entry.ok)}/${String(entry.total)}</li>`,
    )
    .join('')}</ul>`;
}

// The chain lights up link by link; a broken link stops it and the rest stay dark. Delays are capped so a long run still finishes in seconds.
export function renderChain(links: readonly LinkState[]): string {
  return `<ol class="chain" data-testid="chain">${links
    .map(
      (link, index) =>
        `<li class="link ${link.state}" style="--i:${String(Math.min(index, 160))}" data-seq="${String(link.seq)}" data-state="${link.state}" title="${escape(link.id)}"><span class="seq">#${String(link.seq)}</span><span class="kind">${escape(link.kind)}</span></li>`,
    )
    .join('')}</ol>`;
}

export function renderHashMatch(match: HashMatch): string {
  switch (match.kind) {
    case 'event':
      return `<p class="hash-match ${match.proven ? 'ok' : 'broken'}" data-testid="hash-match" data-seq="${String(match.seq)}">${match.proven ? '✓' : '✗'} event <span class="mono">${escape(match.id)}</span> at seq ${String(match.seq)} · ${match.proven ? 'inclusion proof holds' : 'inclusion proof does not hold'}</p>`;
    case 'checkpoint-root':
      return `<p class="hash-match ok" data-testid="hash-match">✓ root hash of the checkpoint at tree size ${String(match.treeSize)}</p>`;
    case 'checkpoint-head':
      return `<p class="hash-match ok" data-testid="hash-match">✓ head hash of the checkpoint at tree size ${String(match.treeSize)}</p>`;
    default:
      return `<p class="hash-match muted" data-testid="hash-match">not in this bundle</p>`;
  }
}

export function renderKeyStatus(status: KeyStatus | { kind: 'error'; message: string }): string {
  switch (status.kind) {
    case 'confirmed':
      return `<p class="key ok" data-testid="key-status" data-key="confirmed">✓ key ${escape(status.keyId)} is published by that server with the same public key</p>`;
    case 'mismatch':
      return `<p class="key broken" data-testid="key-status" data-key="mismatch">✗ key ${escape(status.keyId)} is published with a different public key</p>`;
    case 'unknown':
      return `<p class="key broken" data-testid="key-status" data-key="unknown">✗ key ${escape(status.keyId)} is not among that server's published keys</p>`;
    default:
      return `<p class="key muted" data-testid="key-status" data-key="error">could not fetch the keys: ${escape(status.message)}</p>`;
  }
}

export function renderReport(bundle: Bundle): string {
  return `<details class="report"><summary>report.md (${plural(bundle.events.length, 'event')})</summary><pre class="mono">${escape(bundle.report)}</pre></details>`;
}
