// @vitest-environment jsdom
import { PROD_GUARD_YAML, parsePolicy } from '@debrief/policy';
import { divergence, reconstructGraph } from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { createReplay, createReplayClock } from '@debrief/ui';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FreezeFrame } from './freeze-frame';

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

describe('FreezeFrame', () => {
  const events = demoRunFixture();
  const run = events.filter((event) => event.runId === DEMO_RUN_ID);
  const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
  const report = divergence(events, parsePolicy(PROD_GUARD_YAML), graph);
  const freezeFrame = report.freezeFrame!;
  const replay = createReplay(run);
  const freezeT = replay.timeOf(freezeFrame.eventId)!;
  let clock = createReplayClock(replay.duration);
  let root: Root;
  let container: HTMLDivElement;
  const query = (selector: string): HTMLElement | null => container.querySelector(selector);
  const click = (selector: string): void => {
    container.querySelector<HTMLButtonElement>(selector)!.click();
  };

  beforeEach(async () => {
    clock = createReplayClock(replay.duration);
    clock.getState().setStop(freezeT);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await update(() => {
      root.render(
        <FreezeFrame
          clock={clock}
          replay={replay}
          freezeFrame={freezeFrame}
          policyId="prod-guard"
          policyYaml={PROD_GUARD_YAML}
        />,
      );
    });
  });

  afterEach(async () => {
    await update(() => {
      root.unmount();
    });
    container.remove();
  });

  it('appears only when playback freezes, exactly at the divergence seq, and continues on the button', async () => {
    expect(query('[data-testid="freeze-frame"]')).toBeNull();
    await update(() => {
      clock.getState().seek(0);
      clock.getState().play();
      clock.getState().tick(freezeT * 2);
    });
    expect(clock.getState()).toMatchObject({ t: freezeT, playing: false, frozenAt: freezeT });
    expect(replay.events[replay.indexAt(clock.getState().t) - 1]?.event.seq).toBe(freezeFrame.seq);
    const frame = query('[data-testid="freeze-frame"]')!;
    expect(frame.getAttribute('data-seq')).toBe(String(freezeFrame.seq));
    expect(frame.textContent).toContain('policy prod-guard says');
    expect(frame.textContent).toContain('require_approval');
    expect(query('[data-testid="freeze-policy"] pre')?.textContent).toContain(
      '- id: prod-destructive-needs-approval',
    );
    expect(query('[data-testid="freeze-policy"]')?.textContent).toContain(freezeFrame.explanation);
    const action = query('[data-testid="freeze-action"]')!;
    expect(action.textContent).toContain(`#${String(freezeFrame.seq)} tool.call`);
    expect(action.textContent).toContain('deleteVolume');
    expect(action.textContent).toContain('coding-agent');
    await update(() => {
      click('[data-testid="stay"]');
    });
    expect(clock.getState().t).toBe(freezeT);
    expect(query('[data-testid="freeze-frame"]')).toBeNull();
    await update(() => {
      clock.getState().seek(0);
      clock.getState().play();
      clock.getState().tick(freezeT * 2);
    });
    expect(query('[data-testid="freeze-frame"]')).not.toBeNull();
    await update(() => {
      click('[data-testid="continue"]');
    });
    expect(clock.getState()).toMatchObject({ playing: true, t: freezeT });
    expect(query('[data-testid="freeze-frame"]')).toBeNull();
    await update(() => {
      clock.getState().tick(10);
    });
    expect(clock.getState().t).toBe(freezeT + 10);
  });

  it('copes with sparse events, unknown rules and events without target or authority', async () => {
    const sparse = createReplay([
      {
        ...run[0]!,
        id: '01J8ZK5R4M2X6P9Q3V7W1Y5N0D',
        seq: 700,
        kind: 'tool.call',
        actor: { type: 'agent', id: 'agent:anon' },
        summary: undefined,
        target: { system: 'orbital', environment: 'staging', risk: 'low' },
        authority: { principalId: 'human:pat' },
      },
    ]);
    const point = {
      ...freezeFrame,
      eventId: '01J8ZK5R4M2X6P9Q3V7W1Y5N0D',
      seq: 700,
      ruleId: 'ghost',
    };
    const sparseClock = createReplayClock(10);
    sparseClock.getState().setStop(5);
    sparseClock.getState().play();
    sparseClock.getState().tick(10);
    await update(() => {
      root.render(
        <FreezeFrame
          clock={sparseClock}
          replay={sparse}
          freezeFrame={point}
          policyId="prod-guard"
          policyYaml={PROD_GUARD_YAML}
        />,
      );
    });
    const action = query('[data-testid="freeze-action"]')!;
    expect(action.textContent).toContain('(no summary)');
    expect(action.textContent).toContain('agent:anon');
    expect(action.textContent).toContain('staging');
    expect(action.textContent).toContain('low');
    expect(action.textContent).not.toContain('resource');
    expect(action.textContent).not.toContain('operation');
    expect(action.textContent).toContain('human:pat');
    expect(action.textContent).toContain('—');
    expect(query('[data-testid="freeze-policy"] pre')?.textContent).toBe('ghost');
    const bare = createReplay([
      {
        ...run[0]!,
        id: '01J8ZK5R4M2X6P9Q3V7W1Y5N0E',
        seq: 701,
        kind: 'error',
        target: undefined,
        authority: undefined,
      },
    ]);
    await update(() => {
      root.render(
        <FreezeFrame
          clock={sparseClock}
          replay={bare}
          freezeFrame={{ ...point, eventId: '01J8ZK5R4M2X6P9Q3V7W1Y5N0E', seq: 701 }}
          policyId="p"
        />,
      );
    });
    expect(query('[data-testid="freeze-action"]')?.textContent).not.toContain('system');
    expect(query('[data-testid="freeze-action"]')?.textContent).not.toContain('token');
  });

  it('shows the observed consequences of the frozen call', async () => {
    const observed = run.filter(
      (event) => event.kind === 'world.change' && event.target?.operation === 'deleteVolume',
    );
    await update(() => {
      clock.getState().seek(0);
      clock.getState().play();
      clock.getState().tick(freezeT * 2);
    });
    await update(() => {
      root.render(
        <FreezeFrame
          clock={clock}
          replay={replay}
          freezeFrame={freezeFrame}
          policyId="prod-guard"
          policyYaml={PROD_GUARD_YAML}
          consequences={[
            ...observed,
            {
              ...observed[0]!,
              id: 'bare',
              attrs: {},
              target: { system: 'orbital' },
              summary: undefined,
            },
            {
              ...observed[0]!,
              id: 'staging',
              seq: 800,
              target: {
                system: 'orbital',
                resource: 'projects/nova/volumes/vol-stg-02',
                environment: 'staging',
                risk: 'low',
              },
              attrs: { 'world.field': 'sizeGb' },
            },
          ]}
        />,
      );
    });
    const blocks = Array.from(container.querySelectorAll('[data-testid="freeze-consequence"]'));
    expect(blocks).toHaveLength(3);
    expect(blocks[2]?.textContent).toContain('staging');
    expect(blocks[2]?.textContent).toContain('low');
    expect(blocks[2]?.textContent).toContain('? → ?');
    expect(blocks[2]?.querySelector('dd.text-ember')).toBeNull();
    expect(blocks[0]?.textContent).toContain('observed consequence');
    expect(blocks[0]?.textContent).toContain('projects/nova/volumes/vol-prod-01');
    expect(blocks[0]?.textContent).toContain('production');
    expect(blocks[0]?.textContent).toContain('critical');
    expect(blocks[0]?.textContent).toContain('backupExists');
    expect(blocks[0]?.textContent).toContain('true → false');
    expect(blocks[0]?.textContent).toContain('backupsDeleted');
    expect(blocks[0]?.textContent).toContain('122,749,672,960');
    expect(blocks[1]?.textContent).not.toContain('resource');
  });

  it('shows target and authority when the frozen event has them, and falls back without a rule block', async () => {
    const observed = run.find(
      (event) => event.kind === 'world.change' && event.target?.operation === 'deleteVolume',
    )!;
    const point = {
      ...freezeFrame,
      eventId: observed.id,
      seq: observed.seq,
      kind: 'world.change',
      ruleId: undefined,
    };
    const observedT = replay.timeOf(observed.id)!;
    const other = createReplayClock(replay.duration);
    other.getState().setStop(observedT);
    other.getState().play();
    other.getState().tick(observedT * 2);
    await update(() => {
      root.render(
        <FreezeFrame clock={other} replay={replay} freezeFrame={point} policyId="prod-guard" />,
      );
    });
    const action = query('[data-testid="freeze-action"]')!;
    expect(action.textContent).toContain('projects/nova/volumes/vol-prod-01');
    expect(action.textContent).toContain('production');
    expect(action.textContent).toContain('critical');
    expect(action.textContent).toContain('tok-acct-9c1d');
    expect(action.textContent).toContain('account:*');
    expect(action.querySelector('.text-ember')?.textContent).toBe('observed');
    expect(query('[data-testid="freeze-policy"] pre')?.textContent).toBe(
      'default require_approval',
    );
    await update(() => {
      root.render(
        <FreezeFrame
          clock={other}
          replay={replay}
          freezeFrame={{ ...point, eventId: 'missing' }}
          policyId="prod-guard"
        />,
      );
    });
    expect(query('[data-testid="freeze-frame"]')).toBeNull();
    await update(() => {
      root.render(<FreezeFrame clock={other} replay={replay} policyId="prod-guard" />);
    });
    expect(query('[data-testid="freeze-frame"]')).toBeNull();
  });
});
