// @vitest-environment jsdom
import { PROD_GUARD_YAML, parsePolicy } from '@debrief/policy';
import { blastRadius, divergence, reconstructGraph } from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { type ReplayClock, createReplay, createReplayClock } from '@debrief/ui';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Divergence } from '../lib/api';
import { mapFrame, mapLayout } from '../lib/map-layout';
import { MapScene, blastHops, curve, ports } from './map-scene';
import { KIND_LABELS, Narrative } from './narrative';
import type { Stage3DProps } from './stage-3d';
import { TAIL_MS, Theatre } from './theatre';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { stage, loaders } = vi.hoisted(() => ({
  stage: { seen: [] as Stage3DProps[], explode: false },
  loaders: [] as (() => Promise<unknown>)[],
}));

// The WebGL stage is a stub here: it records its props and offers a click per node.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) => {
    loaders.push(loader);
    return function StageStub(props: Stage3DProps) {
      if (stage.explode) throw new Error('no webgl');
      stage.seen.push(props);
      props.onFrame?.();
      return (
        <div
          data-testid="stage-stub"
          data-cursor={props.frame.cursor ?? ''}
          data-diverged={props.diverged ? 'yes' : 'no'}
          data-frozen={props.frozen ? 'yes' : 'no'}
          data-progress={props.progress}
          data-divergence={props.divergenceNodeId ?? ''}
        >
          {[...props.model.nodes.map((node) => node.id), 'ghost'].map((id) => (
            <button
              key={id}
              type="button"
              data-node={id}
              onClick={() => {
                props.onSelect?.(id);
              }}
            />
          ))}
        </div>
      );
    };
  },
}));

const events = demoRunFixture();
const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
const report = divergence(events, parsePolicy(PROD_GUARD_YAML), graph);
const divergenceResponse: Divergence = {
  runId: DEMO_RUN_ID,
  evaluated: report.evaluated,
  points: report.points,
  ...(report.freezeFrame === undefined ? {} : { freezeFrame: report.freezeFrame }),
};
const blast = blastRadius(graph, report.freezeFrame!.nodeId!, events);
const layout = mapLayout(graph, events);
const order = createReplay(events).events.map((entry) => entry.event.id);

const update = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
    await Promise.resolve();
  });
};

describe('MapScene', () => {
  it('draws every zone and node labeled, and only traversed edges', () => {
    const html = renderToStaticMarkup(
      <MapScene
        layout={layout}
        frame={mapFrame(layout, order, 0)}
        diverged={false}
        progress={-1}
      />,
    );
    expect(html.match(/data-testid="zone"/g)).toHaveLength(layout.zones.length);
    expect(html.match(/data-testid="node"/g)).toHaveLength(layout.nodes.length);
    expect(html).toContain('>Aaryan<');
    expect(html).toContain('>coding-agent<');
    expect(html).toContain('>volumes/vol-prod-01<');
    expect(html).not.toContain('data-testid="edge"');
    expect(html).not.toContain('data-testid="cursor"');
    expect(html).toContain('data-state="idle"');
  });

  it('lights the current event, rings the divergence and burns the blast', () => {
    const deletion = events.filter(
      (event) => event.kind === 'tool.call' && event.target?.operation === 'deleteVolume',
    );
    const at = order.indexOf(deletion.at(-1)!.id) + 1;
    const frame = mapFrame(layout, order, at);
    const html = renderToStaticMarkup(
      <MapScene
        layout={layout}
        frame={frame}
        currentEvent={deletion.at(-1)}
        divergenceNodeId={report.freezeFrame!.nodeId}
        diverged
        blast={blast}
        progress={2}
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain('data-testid="cursor"');
    expect(html).toContain('data-cursor="tool:deleteVolume"');
    expect(html).toContain('data-testid="divergence-ring"');
    expect(html).toContain('data-current="true"');
    expect(html.match(/data-state="burnt"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('cursor-pointer');
    const observed = renderToStaticMarkup(
      <MapScene
        layout={layout}
        frame={frame}
        currentEvent={events.find((event) => event.provenance === 'observed')}
        diverged={false}
        progress={-1}
      />,
    );
    expect(observed).toContain('#ff7a3d');
  });

  it('maps the blast onto the grouped nodes and routes edges between zone walls', () => {
    const hops = blastHops(layout, blast);
    expect(hops.get('tool:deleteVolume')).toBe(0);
    expect(hops.get('resource:orbital:projects/nova/volumes/vol-prod-01')).toBe(1);
    expect(blastHops(layout, undefined).size).toBe(0);
    expect(blastHops(layout, { ...blast, origin: 'ghost' }).size).toBe(hops.size - 1);
    expect(
      blastHops(layout, {
        ...blast,
        waves: [
          { hop: 1, resources: [{ ...blast.waves[0]!.resources[0]!, nodeId: 'ghost' }] },
          ...blast.waves,
        ],
      }).size,
    ).toBe(hops.size);
    const portOf = ports(layout);
    const agent = portOf.get('agent:coding-agent')!;
    expect(agent.left.x).toBeLessThan(agent.right.x);
    const orphan = ports({ ...layout, zones: [] }).get('agent:coding-agent')!;
    expect(orphan.left.x).toBe(orphan.right.x);
    expect(curve({ x: 0, y: 0 }, { x: 100, y: 50 })).toMatch(/^M 0 0 C 50 0, 50 50, 100 50$/);
    expect(curve({ x: 100, y: 0 }, { x: 0, y: 0 })).toMatch(/^M 100 0 C 50 0, 50 0, 0 0$/);
    const backward = mapFrame(
      { ...layout, edges: layout.edges.filter((edge) => edge.type === 'returns') },
      order,
      order.length,
    );
    const html = renderToStaticMarkup(
      <MapScene layout={layout} frame={backward} diverged={false} progress={-1} />,
    );
    expect(html).toContain('data-testid="edge"');
    const dangling = renderToStaticMarkup(
      <MapScene
        layout={{
          ...layout,
          edges: [{ id: 'x', from: 'ghost', to: 'ghost2', type: 'calls', eventIds: [] }],
        }}
        frame={{ ...backward, traversed: new Set(['x']) }}
        diverged={false}
        progress={-1}
      />,
    );
    expect(dangling).not.toContain('data-testid="edge"');
  });
});

describe('Narrative', () => {
  let root: Root;
  let container: HTMLDivElement;
  let clock: ReplayClock;
  const replay = createReplay(events);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    clock = createReplayClock(replay.duration);
  });

  afterEach(async () => {
    await update(() => {
      root.unmount();
    });
    container.remove();
  });

  it('follows the clock, windows the rows, and seeks on click', async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.getAttribute('data-seq') ?? '');
    };
    await update(() => {
      root.render(
        <Narrative
          clock={clock}
          replay={replay}
          freezeFrame={report.freezeFrame}
          window={{ before: 3, after: 2 }}
        />,
      );
    });
    // Two events share the first millisecond, so the clock at 0 has already applied both.
    expect(container.querySelector('[data-testid="narrative-position"]')?.textContent).toBe(
      '2 / 49',
    );
    expect(container.querySelectorAll('[data-testid="narrative-row"]')).toHaveLength(4);
    expect(container.querySelector('[data-current="true"]')).not.toBeNull();
    const freezeT = replay.timeOf(report.freezeFrame!.eventId)!;
    await update(() => {
      clock.getState().seek(freezeT);
    });
    const current = container.querySelector<HTMLElement>('[data-current="true"]');
    expect(current?.dataset.seq).toBe(String(report.freezeFrame!.seq));
    expect(container.querySelector('[data-testid="narrative-freeze"]')?.textContent).toContain(
      'require_approval',
    );
    expect(container.querySelectorAll('[data-testid="narrative-row"]')).toHaveLength(6);
    expect(container.querySelector('[data-testid="narrative-now"]')?.getAttribute('data-seq')).toBe(
      String(report.freezeFrame!.seq),
    );
    expect(container.querySelector('[data-testid="card-details"]')).not.toBeNull();
    expect(scrolled).toContain(String(report.freezeFrame!.seq));
    const past = container.querySelector<HTMLButtonElement>('[data-state="past"] button');
    await update(() => {
      past?.click();
    });
    expect(clock.getState().t).toBeLessThan(freezeT);
    expect(container.querySelector('[data-state="future"]')?.className).toContain('opacity-40');
    await update(() => {
      clock.getState().seek(replay.duration);
    });
    expect(container.querySelector('[data-testid="narrative-position"]')?.textContent).toBe(
      '49 / 49',
    );
    expect(Object.keys(KIND_LABELS)).toHaveLength(15);
  });

  it('marks observed rows in ember, falls back to the kind without a summary, and names a default rule', async () => {
    const observed = events.find((event) => event.provenance === 'observed')!;
    const bare = { ...observed, summary: undefined };
    const sparse = createReplay([events[0]!, bare]);
    await update(() => {
      root.render(
        <Narrative
          clock={clock}
          replay={sparse}
          freezeFrame={{ ...report.freezeFrame!, eventId: bare.id, ruleId: undefined }}
        />,
      );
    });
    await update(() => {
      clock.getState().seek(sparse.duration);
    });
    const current = container.querySelector('[data-current="true"]');
    expect(current?.className).toContain('border-ember');
    expect(current?.textContent).toContain('world.change');
    expect(container.querySelector('[data-testid="narrative-now"]')?.textContent).toContain(
      'world.change',
    );
    expect(container.querySelector('[data-testid="narrative-freeze"]')?.textContent).toContain(
      'default',
    );
  });

  it('survives a browser without scrollIntoView', async () => {
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    // @ts-expect-error jsdom has no scrollIntoView unless a test adds one
    delete Element.prototype.scrollIntoView;
    await update(() => {
      root.render(<Narrative clock={clock} replay={replay} />);
    });
    await update(() => {
      clock.getState().seek(500);
    });
    expect(container.querySelector('[data-current="true"]')).not.toBeNull();
    if (original !== undefined)
      Object.defineProperty(Element.prototype, 'scrollIntoView', original);
  });
});

describe('Theatre', () => {
  let root: Root;
  let container: HTMLDivElement;
  const clocks: ReplayClock[] = [];
  const onClock = (clock: ReplayClock): void => {
    clocks.push(clock);
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    clocks.length = 0;
    stage.seen.length = 0;
    stage.explode = false;
  });

  afterEach(async () => {
    await update(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('plays in story time, freezes at the divergence inside the stage, then ripples', async () => {
    const frames: number[] = [];
    await update(() => {
      root.render(
        <Theatre
          graph={graph}
          events={events}
          divergence={divergenceResponse}
          blast={blast}
          policyYaml={PROD_GUARD_YAML}
          onClock={onClock}
          onFrame={() => {
            frames.push(1);
          }}
        />,
      );
    });
    const clock = clocks[0]!;
    expect(frames.length).toBeGreaterThan(0);
    const paced = createReplay(events, undefined, { minGapMs: 350, maxGapMs: 1200 });
    expect(clock.getState().duration).toBe(paced.duration + TAIL_MS);
    expect(paced.duration).toBeGreaterThan(15_000);
    expect(container.querySelector('[data-testid="caption"]')?.textContent).toContain('#0');
    const freezeT = paced.timeOf(report.freezeFrame!.eventId)!;
    await update(() => {
      clock.getState().play();
      clock.getState().tick(freezeT + 10);
    });
    expect(clock.getState().frozenAt).toBe(freezeT);
    const grid = container.querySelector('[data-testid="theatre-grid"]');
    expect(grid?.querySelector('[data-testid="freeze-frame"]')).not.toBeNull();
    const stub = container.querySelector('[data-testid="stage-stub"]')!;
    expect(stub.getAttribute('data-cursor')).toBe('tool:deleteVolume');
    expect(stub.getAttribute('data-frozen')).toBe('yes');
    expect(stub.getAttribute('data-diverged')).toBe('yes');
    expect(stub.getAttribute('data-divergence')).toBe('tool:deleteVolume');
    expect(stage.seen.at(-1)?.previous).toBeDefined();
    expect(stage.seen.at(-1)?.eventT).toBe(freezeT);
    expect(stage.seen.at(-1)?.hops.get('tool:deleteVolume')).toBe(0);
    expect(container.querySelector('[data-testid="caption"]')?.textContent).toContain('#45');
    await update(() => {
      clock.getState().play();
      clock.getState().tick(1500);
    });
    expect(container.querySelector('[data-testid="freeze-frame"]')).toBeNull();
    expect(
      Number(container.querySelector('[data-testid="stage-stub"]')?.getAttribute('data-progress')),
    ).toBeGreaterThan(0);
    expect(container.querySelector('[data-testid="clock"]')?.textContent).toContain(' s / ');
  });

  it('captions an observed event in ember and a bare event by its kind, with a blob loader', async () => {
    const observed = events.find((event) => event.provenance === 'observed')!;
    const stripped = events.map((event) =>
      event.id === observed.id ? { ...event, summary: undefined } : event,
    );
    const loadBlob = vi.fn();
    await update(() => {
      root.render(
        <Theatre
          graph={graph}
          events={stripped}
          initialEventId={observed.id}
          loadBlob={loadBlob}
          onClock={onClock}
        />,
      );
    });
    const caption = container.querySelector('[data-testid="caption"]');
    expect(caption?.querySelector('.text-ember')?.textContent).toBe('observed');
    expect(caption?.textContent).toContain(`#${String(observed.seq)}`);
    expect(
      container.querySelector('[data-testid="narrative-row"][data-current="true"]')?.textContent,
    ).toContain('world.change');
  });

  it('opens at a linked event, seeks from the map, and works without divergence or blast', async () => {
    const target = events[10]!;
    await update(() => {
      root.render(
        <Theatre
          graph={graph}
          events={events}
          initialEventId={target.id}
          pacing={{ minGapMs: 100, maxGapMs: 100 }}
          onClock={onClock}
        />,
      );
    });
    const clock = clocks[0]!;
    const paced = createReplay(events, undefined, { minGapMs: 100, maxGapMs: 100 });
    expect(clock.getState().t).toBe(paced.timeOf(target.id));
    expect(clock.getState().t).toBeGreaterThan(0);
    expect(container.querySelector('[data-testid="freeze-frame"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="stage-stub"]')?.getAttribute('data-divergence'),
    ).toBe('');
    expect(stage.seen.at(-1)?.previous?.index).toBe(stage.seen.at(-1)!.frame.index - 1);
    const node = container.querySelector<HTMLButtonElement>('[data-node="tool:deleteVolume"]');
    await update(() => {
      node?.click();
    });
    const deletions = layout.nodes.find((candidate) => candidate.id === 'tool:deleteVolume')!;
    expect(clock.getState().t).toBe(Math.min(...deletions.eventIds.map((id) => paced.timeOf(id)!)));
    const ghost = container.querySelector<HTMLButtonElement>('[data-node="agent:coding-agent"]');
    await update(() => {
      ghost?.click();
    });
    const agent = layout.nodes.find((candidate) => candidate.id === 'agent:coding-agent')!;
    const agentT = Math.min(...agent.eventIds.map((id) => paced.timeOf(id)!));
    expect(clock.getState().t).toBe(agentT);
    await update(() => {
      container.querySelector<HTMLButtonElement>('[data-node="ghost"]')?.click();
    });
    expect(clock.getState().t).toBe(agentT);
  });

  it('shows an empty run as a stage before the first event', async () => {
    await update(() => {
      root.render(
        <Theatre graph={{ ...graph, nodes: [], edges: [] }} events={[]} onClock={onClock} />,
      );
    });
    expect(container.querySelector('[data-testid="caption"]')?.textContent).toBe(
      'before the first event',
    );
    expect(stage.seen.at(-1)?.model.zones).toHaveLength(0);
    expect(stage.seen.at(-1)?.eventT).toBeUndefined();
  });

  it('falls back to the flat map when the stage throws, or when asked for it', async () => {
    stage.explode = true;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await update(() => {
      root.render(<Theatre graph={graph} events={events} divergence={divergenceResponse} />);
    });
    expect(container.querySelector('[data-testid="stage-stub"]')).toBeNull();
    expect(container.querySelector('[data-testid="map-scene"]')).not.toBeNull();
    quiet.mockRestore();
    stage.explode = false;
    await update(() => {
      root.render(
        <Theatre
          graph={graph}
          events={events}
          divergence={divergenceResponse}
          flat
          onClock={onClock}
        />,
      );
    });
    expect(container.querySelector('[data-testid="stage-stub"]')).toBeNull();
    const svgNode = container.querySelector<SVGGElement>('[data-node="tool:deleteVolume"]');
    await update(() => {
      svgNode?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(clocks[0]!.getState().t).toBeGreaterThan(0);
    const module = await loaders[0]!();
    expect(typeof module).toBe('function');
    await update(() => {
      root.render(
        <Theatre
          graph={{ ...graph, nodes: [], edges: [] }}
          events={[]}
          divergence={{ ...divergenceResponse, freezeFrame: undefined }}
          blast={blast}
          flat
        />,
      );
    });
    expect(container.querySelector('[data-testid="map-scene"]')).not.toBeNull();
  });

  it('ignores a linked event it does not know and a node with no events', async () => {
    const lonely = {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: 'tool:ghost',
          type: 'tool' as const,
          label: 'ghost',
          ts: events[0]!.ts,
          eventIds: [],
        },
      ],
    };
    await update(() => {
      root.render(
        <Theatre graph={lonely} events={events} initialEventId="nope" onClock={onClock} />,
      );
    });
    const clock = clocks[0]!;
    await update(() => {
      clock.getState().seek(400);
    });
    const node = container.querySelector<SVGGElement>('[data-node="tool:ghost"]');
    await update(() => {
      node?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(clock.getState().t).toBe(400);
  });
});
