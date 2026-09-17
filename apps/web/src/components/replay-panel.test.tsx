// @vitest-environment jsdom
import type { Event } from '@debrief/schema';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReplayPanel, formatClock } from './replay-panel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ZERO = '0'.repeat(64);
const at = (ms: number): string => new Date(Date.UTC(2026, 8, 17) + ms).toISOString();
const ev = (seq: number, ms: number, patch: Partial<Event> & Pick<Event, 'kind'>): Event => ({
  id: `01J8ZK5R4M2X6P9Q3V7W1Y5N${String(seq).padStart(2, '0')}`,
  tenantId: 't',
  seq,
  ts: at(ms),
  sourceTs: at(ms),
  source: 'api',
  provenance: 'reported',
  runId: 'r',
  actor: { type: 'agent', id: 'agent:worker' },
  attrs: {},
  prevHash: ZERO,
  hash: ZERO,
  ...patch,
});

const events = [
  ev(0, 0, {
    kind: 'delegation.grant',
    actor: { type: 'human', id: 'human:pat' },
    authority: {
      principalId: 'human:pat',
      tokenRef: 'tok',
      scope: ['staging:*'],
      permissions: ['staging:files:read'],
    },
    attrs: { 'delegation.to': 'agent:worker', 'delegation.token.label': 'deploy token' },
    summary: 'Pat handed over the deploy token',
  }),
  ev(1, 1000, {
    kind: 'tool.call',
    summary: 'deleteVolume(vol-prod-01)',
    target: { system: 'orbital', operation: 'deleteVolume' },
  }),
  ev(2, 1500, {
    kind: 'world.change',
    provenance: 'observed',
    source: 'world-hook',
    actor: { type: 'system', id: 'orbital-infra' },
    target: {
      system: 'orbital',
      resource: 'projects/nova/volumes/vol-prod-01',
      operation: 'deleteVolume',
    },
    attrs: { 'world.field': 'backupExists', 'world.before': true, 'world.after': false },
    summary: 'vol-prod-01 deleted; backups gone',
  }),
  ev(3, 2000, {
    kind: 'delegation.revoke',
    authority: { principalId: 'human:pat', tokenRef: 'tok' },
  }),
  ev(4, 2100, {
    kind: 'world.change',
    provenance: 'observed',
    source: 'world-hook',
    actor: { type: 'system', id: 'orbital-infra' },
    target: { system: 'orbital', resource: 'projects/nova/files/notes' },
  }),
  ev(5, 2200, {
    kind: 'delegation.grant',
    authority: { principalId: 'human:pat', grantId: 'bare' },
  }),
];
const markers = [{ t: 1000, label: 'require_approval', kind: 'freeze' as const }];

const update = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
    await Promise.resolve();
  });
};

describe('ReplayPanel', () => {
  let root: Root;
  let container: HTMLDivElement;
  const text = (selector: string): string => container.querySelector(selector)?.textContent ?? '';

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.append(container);
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 400,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    root = createRoot(container);
    await update(() => {
      root.render(<ReplayPanel events={events} markers={markers} />);
    });
  });

  afterEach(async () => {
    await update(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('starts before the first event and follows the clock through world and token state', async () => {
    expect(text('[data-testid="clock"]')).toBe('0.00 s / 2.20 s');
    expect(text('[data-testid="applied"]')).toBe('1 / 6 events');
    await update(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(text('[data-testid="clock"]')).toBe('2.20 s / 2.20 s');
    expect(text('[data-testid="applied"]')).toBe('6 / 6 events');
  });

  it('toggles playback from the button and changes the rate', async () => {
    const button = container.querySelector('button')!;
    await update(() => {
      button.click();
    });
    expect(button.textContent).toBe('pause');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    await update(() => {
      button.click();
    });
    expect(button.textContent).toBe('play');
    const select = container.querySelector('select')!;
    await update(() => {
      select.value = '4';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(select.value).toBe('4');
    expect(formatClock(1234)).toBe('1.23 s');
  });

  it('renders an empty run', async () => {
    await update(() => {
      root.render(<ReplayPanel events={[]} markers={[]} />);
    });
    expect(text('[data-testid="applied"]')).toBe('0 / 0 events');
  });
});
