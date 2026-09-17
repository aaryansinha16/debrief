// @vitest-environment jsdom
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { type ResourceState, createReplay, createReplayClock } from '@debrief/ui';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { flaresAt } from '../lib/flares';
import { WorldPanel, backupsOf, resourceClass, resourceName } from './world-panel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const update = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
    await Promise.resolve();
  });
};

const resource = (patch: Partial<ResourceState>): ResourceState => ({
  system: 'orbital',
  resource: 'projects/p/volumes/v',
  fields: {},
  changes: {},
  lastEventId: 'e',
  mutations: 1,
  ...patch,
});

describe('WorldPanel on the demo run', () => {
  const events = demoRunFixture().filter((event) => event.runId === DEMO_RUN_ID);
  const replay = createReplay(events);
  const clock = createReplayClock(replay.duration);
  const deletion = replay.events.find(
    (entry) =>
      entry.event.kind === 'world.change' && entry.event.target?.operation === 'deleteVolume',
  )!;
  let root: Root;
  let container: HTMLDivElement;
  const query = (selector: string): HTMLElement | null => container.querySelector(selector);

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await update(() => {
      root.render(<WorldPanel clock={clock} replay={replay} />);
    });
  });

  afterEach(async () => {
    await update(() => {
      root.unmount();
    });
    container.remove();
  });

  it('shows backups 2 → 0 at the deletion event, flashing, on the same t that flares the volume node', async () => {
    await update(() => {
      clock.getState().seek(deletion.t - 1);
    });
    expect(query('[data-testid="section-volumes"]')?.textContent).toContain('nothing observed');
    await update(() => {
      clock.getState().seek(deletion.t);
    });
    expect(query('[data-testid="world-panel"]')?.getAttribute('data-event')).toBe(
      deletion.event.id,
    );
    const row = query(
      '[data-testid="volume-row"][data-resource="projects/nova/volumes/vol-prod-01"]',
    )!;
    const backups = row.querySelector('[data-testid="backups"]')!;
    expect(backups.textContent).toBe('20');
    expect(backups.querySelector('.line-through')?.textContent).toBe('2');
    expect(backups.className).toContain('animate-flash');
    expect(backups.getAttribute('data-changed')).toBe(deletion.event.id);
    expect(row.querySelector('[data-testid="bytes"]')?.textContent).toContain('122,749,672,960');
    expect(row.textContent).toContain('production');
    expect(row.textContent).toContain('deleteVolume');
    expect(
      flaresAt(replay, clock.getState().t).get(
        'resource:orbital:projects/nova/volumes/vol-prod-01',
      ),
    ).toBe(1);
    const next = replay.events[replay.indexAt(deletion.t)]!;
    await update(() => {
      clock.getState().seek(next.t);
    });
    const later = query('[data-testid="backups"]')!;
    expect(later.textContent).toBe('0');
    expect(later.className).not.toContain('animate-flash');
    expect(later.getAttribute('data-changed')).toBeNull();
  });

  it('lists credentials, files and tokens from the reducer', async () => {
    await update(() => {
      clock.getState().seek(replay.duration);
    });
    const credentials = query('[data-testid="section-credentials"]')!;
    expect(credentials.textContent).toContain('DATABASE_URL');
    expect(credentials.querySelector('[data-testid="field-version"]')?.textContent).toBe('8');
    expect(query('[data-testid="section-files"]')?.textContent).toContain('nothing observed');
    const tokens = Array.from(container.querySelectorAll('[data-testid="token-row"]'));
    expect(tokens.map((row) => row.getAttribute('data-token'))).toEqual([
      'tok-stg-7f3a',
      'tok-acct-9c1d',
    ]);
    expect(tokens[1]?.querySelector('.text-ember')?.textContent).toBe('account:*');
    expect(tokens[0]?.textContent).toContain('→ agent:coding-agent');
    await update(() => {
      clock.getState().seek(0);
    });
    expect(query('[data-testid="section-tokens"]')?.textContent).toContain('no grants yet');
    const revoked = createReplay([
      {
        ...events[0]!,
        kind: 'delegation.revoke',
        actor: { type: 'system', id: 'orbital-infra' },
        authority: { principalId: 'human:aaryan', grantId: 'tok-x' },
        attrs: {},
      },
    ]);
    const revokedClock = createReplayClock(revoked.duration);
    await update(() => {
      root.render(<WorldPanel clock={revokedClock} replay={revoked} />);
    });
    const row = query('[data-testid="token-row"][data-token="tok-x"]')!;
    expect(row.querySelector('.line-through')?.textContent).toBe('tok-x');
    expect(row.textContent).toContain('→ —');
    expect(row.textContent).toContain('scope — · perms —');
    expect(query('[data-testid="world-panel"]')?.getAttribute('data-event')).toBe(events[0]!.id);
    await update(() => {
      root.render(<WorldPanel clock={createReplayClock(0)} replay={createReplay([])} />);
    });
    expect(query('[data-testid="world-panel"]')?.getAttribute('data-event')).toBe('');
  });
});

describe('world panel helpers', () => {
  it('classifies resources and derives backups', () => {
    expect(resourceClass('projects/nova/volumes/vol-prod-01')).toBe('volumes');
    expect(resourceClass('bucket')).toBe('other');
    expect(resourceName('projects/nova/files/.env.backup')).toBe('.env.backup');
    expect(resourceName('bucket')).toBe('bucket');
    expect(backupsOf(resource({}))).toEqual({ value: undefined });
    expect(backupsOf(resource({ fields: { backupExists: true } }))).toEqual({ value: 'yes' });
    const change = { before: true, after: false, eventId: 'e' };
    expect(
      backupsOf(
        resource({
          fields: { backupExists: true },
          changes: { backupExists: { after: true, eventId: 'e' } },
        }),
      ),
    ).toEqual({
      value: 'yes',
      change: { after: true, eventId: 'e' },
    });
    expect(
      backupsOf(resource({ fields: { backupExists: false }, changes: { backupExists: change } })),
    ).toEqual({
      value: 0,
      change: { ...change, before: 1 },
    });
    expect(
      backupsOf(
        resource({
          fields: { backupExists: false, backupsDeleted: 3 },
          changes: { backupExists: change },
        }),
      ),
    ).toEqual({
      value: 0,
      change: { ...change, before: 3 },
    });
    expect(backupsOf(resource({ fields: { backupExists: false } }))).toEqual({ value: 0 });
    expect(
      backupsOf(
        resource({
          fields: { backupExists: false },
          changes: { backupExists: { after: false, eventId: 'e' } },
        }),
      ),
    ).toEqual({
      value: 0,
      change: { after: false, eventId: 'e' },
    });
  });

  it('renders generic rows with and without fields, and bytes without a value', async () => {
    const bare = createReplay([
      {
        ...demoRunFixture()[0]!,
        kind: 'world.change',
        target: { system: 'orbital', resource: 'projects/p/files/notes' },
        attrs: {},
      },
      {
        ...demoRunFixture()[0]!,
        id: '01J8ZK5R4M2X6P9Q3V7W1Y5N0B',
        seq: 1,
        kind: 'world.change',
        target: { system: 'orbital', resource: 'projects/p/volumes/vol-x' },
        attrs: { 'world.field': 'backupExists', 'world.after': true },
      },
      {
        ...demoRunFixture()[0]!,
        id: '01J8ZK5R4M2X6P9Q3V7W1Y5N0C',
        seq: 2,
        kind: 'world.change',
        target: { system: 'orbital', resource: 'projects/p/queues/q', operation: 'purgeQueue' },
        attrs: { 'world.field': 'depth', 'world.before': 5, 'world.after': 0 },
      },
    ]);
    const bareClock = createReplayClock(bare.duration);
    bareClock.getState().seek(bare.duration);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await update(() => {
      root.render(<WorldPanel clock={bareClock} replay={bare} />);
    });
    expect(container.querySelector('[data-testid="section-files"]')?.textContent).toContain(
      'notes',
    );
    expect(
      container.querySelector('[data-testid="section-files"] [data-testid="resource-row"]')
        ?.textContent,
    ).toContain('—');
    expect(container.querySelector('[data-testid="backups"]')?.textContent).toBe('yes');
    expect(container.querySelector('[data-testid="bytes"]')?.textContent).toBe('—');
    const queues = container.querySelector('[data-testid="section-queues"]')!;
    expect(queues.querySelector('[data-testid="field-depth"]')?.textContent).toBe('50');
    expect(queues.textContent).toContain('purgeQueue');
    await update(() => {
      root.unmount();
    });
    container.remove();
  });
});
