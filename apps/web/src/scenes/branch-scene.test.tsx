// @vitest-environment jsdom
import { PROD_GUARD_YAML, SAMPLE_POLICIES, parsePolicy } from '@debrief/policy';
import { counterfactual, reconstructGraph } from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Counterfactual } from '../lib/api';
import { BranchScene } from './branch-scene';

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

const events = demoRunFixture();
const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
const inRun = events.filter((event) => event.runId === DEMO_RUN_ID);
const branchOf = (yaml: string): Counterfactual => counterfactual(events, parsePolicy(yaml), graph);
const ALLOW_ALL = SAMPLE_POLICIES['allow-all']!;

describe('BranchScene', () => {
  let root: Root;
  let container: HTMLDivElement;
  const scene = (): Element => container.querySelector('[data-testid="branch-scene"]')!;
  const editor = (): HTMLTextAreaElement =>
    container.querySelector<HTMLTextAreaElement>('[data-testid="policy-editor"]')!;
  const type = async (value: string): Promise<void> => {
    await update(() => {
      // React tracks the value through the prototype setter; Reflect.set invokes it with the element as receiver.
      Reflect.set(HTMLTextAreaElement.prototype, 'value', value, editor());
      editor().dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const settle = async (ms: number): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.append(container);
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 400,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    root = createRoot(container);
  });

  afterEach(async () => {
    await update(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows the initial branch without asking for it again, greying what would not have happened', async () => {
    const branch = vi.fn((yaml: string) => Promise.resolve(branchOf(yaml)));
    await update(() => {
      root.render(
        <BranchScene
          runId={DEMO_RUN_ID}
          events={inRun}
          initialYaml={PROD_GUARD_YAML}
          initialBranch={branchOf(PROD_GUARD_YAML)}
          branch={branch}
        />,
      );
    });
    await settle(1000);
    expect(branch).not.toHaveBeenCalled();
    expect(scene().getAttribute('data-halted')).toBe('yes');
    expect(scene().getAttribute('data-valid')).toBe('yes');
    expect(container.querySelector('[data-testid="branch-summary"]')?.textContent).toBe(
      'halts at #45: prod-destructive-needs-approval → require_approval · 4 events would not have happened',
    );
    expect(container.querySelector('[data-testid="branch-explanation"]')?.textContent).toContain(
      'prod-destructive-needs-approval',
    );
    const rows = [...container.querySelectorAll('[data-testid="branch-events"] li')];
    expect(rows).toHaveLength(inRun.length);
    expect(
      rows.filter((row) => row.getAttribute('data-status') === 'would-not-have-happened'),
    ).toHaveLength(4);
    expect(rows.filter((row) => row.getAttribute('data-status') === 'freeze-frame')).toHaveLength(
      1,
    );
    expect(
      rows.find((row) => row.getAttribute('data-status') === 'freeze-frame')?.textContent,
    ).toContain('halt · ');
    expect(container.querySelectorAll('[data-testid="scrubber"]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="policy-ok"]')?.textContent.trim()).toBe(
      'policy parses',
    );
    expect(container.querySelector('[data-testid="gutter"]')?.textContent).toContain(' 1');
    const unsummarised = branchOf(PROD_GUARD_YAML);
    unsummarised.timeline = unsummarised.timeline.map((entry, index) =>
      index === 0 ? { ...entry, event: { ...entry.event, summary: undefined } } : entry,
    );
    await update(() => {
      root.unmount();
    });
    root = createRoot(container);
    await update(() => {
      root.render(
        <BranchScene
          runId={DEMO_RUN_ID}
          events={inRun}
          initialYaml={PROD_GUARD_YAML}
          initialBranch={unsummarised}
          branch={branch}
        />,
      );
    });
    expect(container.querySelector('[data-testid="branch-events"] li')?.textContent).toBe(
      `#${String(unsummarised.timeline[0]!.event.seq)}${unsummarised.timeline[0]!.event.kind}`,
    );
  });

  it('flags invalid yaml inline with its line and never posts it', async () => {
    const branch = vi.fn((yaml: string) => Promise.resolve(branchOf(yaml)));
    await update(() => {
      root.render(
        <BranchScene
          runId={DEMO_RUN_ID}
          events={inRun}
          initialYaml={PROD_GUARD_YAML}
          initialBranch={branchOf(PROD_GUARD_YAML)}
          branch={branch}
        />,
      );
    });
    await type(`${PROD_GUARD_YAML}\n`);
    expect(scene().getAttribute('data-pending')).toBe('yes');
    await type(PROD_GUARD_YAML.replace('effect: deny', 'effect: nope'));
    await settle(1000);
    expect(branch).not.toHaveBeenCalled();
    expect(scene().getAttribute('data-pending')).toBe('no');
    expect(scene().getAttribute('data-valid')).toBe('no');
    expect(editor().getAttribute('aria-invalid')).toBe('true');
    const issues = [...container.querySelectorAll('[data-testid="policy-issues"] li')];
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.textContent).toMatch(/^line \d+:\d+ · /);
    const line = Number(/^line (\d+)/.exec(issues[0]?.textContent ?? '')?.[1]);
    expect(
      container
        .querySelector(`[data-testid="gutter"] [data-line="${String(line)}"]`)
        ?.getAttribute('data-issue'),
    ).toBe('yes');
    expect(
      container.querySelector('[data-testid="gutter"] [data-line="1"]')?.getAttribute('data-issue'),
    ).toBe('no');
    expect(scene().getAttribute('data-halted')).toBe('yes');
  });

  it('re-branches once per pause in typing and reports how long it took', async () => {
    const branch = vi.fn((yaml: string) => Promise.resolve(branchOf(yaml)));
    await update(() => {
      root.render(
        <BranchScene
          runId={DEMO_RUN_ID}
          events={inRun}
          initialYaml={PROD_GUARD_YAML}
          initialBranch={branchOf(PROD_GUARD_YAML)}
          branch={branch}
          debounceMs={100}
        />,
      );
    });
    await type(`${PROD_GUARD_YAML}\n`);
    await settle(50);
    await type(ALLOW_ALL);
    expect(scene().getAttribute('data-pending')).toBe('yes');
    await settle(150);
    expect(branch).toHaveBeenCalledTimes(1);
    expect(branch).toHaveBeenCalledWith(ALLOW_ALL);
    expect(scene().getAttribute('data-pending')).toBe('no');
    expect(scene().getAttribute('data-halted')).toBe('no');
    expect(container.querySelector('[data-testid="branch-summary"]')?.textContent).toBe(
      'no halt: the run plays through unchanged',
    );
    expect(container.querySelector('[data-testid="branch-explanation"]')).toBeNull();
    expect(container.querySelectorAll('[data-status="would-not-have-happened"]')).toHaveLength(0);
    const ms = Number(scene().getAttribute('data-rebranch-ms'));
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeLessThan(500);
    expect(container.querySelector('[data-testid="policy-ok"]')?.textContent).toContain(
      're-branched in',
    );
  });

  it('asks for the first branch when none is given, ignores stale answers and shows failures', async () => {
    const answers: { resolve: (value: Counterfactual) => void; reject: (error: Error) => void }[] =
      [];
    const branch = vi.fn(
      () =>
        new Promise<Counterfactual>((resolve, reject) => {
          answers.push({ resolve, reject });
        }),
    );
    await update(() => {
      root.render(
        <BranchScene
          runId={DEMO_RUN_ID}
          events={inRun}
          initialYaml={PROD_GUARD_YAML}
          branch={branch}
          debounceMs={10}
        />,
      );
    });
    expect(container.querySelector('[data-testid="branch-summary"]')?.textContent).toBe(
      'no branch yet',
    );
    await settle(20);
    expect(branch).toHaveBeenCalledTimes(1);
    await update(() => {
      answers[0]!.resolve(branchOf(PROD_GUARD_YAML));
    });
    expect(scene().getAttribute('data-halted')).toBe('yes');
    expect(scene().getAttribute('data-rebranch-ms')).toBe('');
    await type(ALLOW_ALL);
    await settle(20);
    await type(`${ALLOW_ALL}\n`);
    await settle(20);
    expect(branch).toHaveBeenCalledTimes(3);
    await update(() => {
      answers[1]!.resolve(branchOf(PROD_GUARD_YAML));
    });
    expect(scene().getAttribute('data-pending')).toBe('yes');
    await update(() => {
      answers[2]!.resolve(branchOf(ALLOW_ALL));
    });
    expect(scene().getAttribute('data-halted')).toBe('no');
    expect(scene().getAttribute('data-rebranch-ms')).not.toBe('');
    await type(PROD_GUARD_YAML);
    await settle(20);
    await update(() => {
      answers[3]!.reject(new Error('api down'));
    });
    expect(container.querySelector('[data-testid="branch-failure"]')?.textContent).toBe('api down');
    expect(scene().getAttribute('data-pending')).toBe('no');
    await type(ALLOW_ALL);
    await settle(20);
    await type(PROD_GUARD_YAML);
    await settle(20);
    await update(() => {
      answers[4]!.reject(new Error('late'));
    });
    expect(container.querySelector('[data-testid="branch-failure"]')?.textContent).toBe('api down');
    await update(() => {
      answers[5]!.reject('odd' as never);
    });
    expect(container.querySelector('[data-testid="branch-failure"]')?.textContent).toBe(
      'the branch request failed',
    );
  });
});
