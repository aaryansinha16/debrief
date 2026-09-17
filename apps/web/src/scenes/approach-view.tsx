'use client';

import { type Event, type Run, eventSchema } from '@debrief/schema';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import { type Agent, type ApproachState, createApproachStore, isIdle } from '../lib/approach';
import { LOD_AGENT_THRESHOLD } from '../lib/approach-field';
import type { StageLabel } from './approach-canvas';
import type { RenderStats } from './render-meter';

const ApproachCanvas = dynamic(() => import('./approach-canvas').then((m) => m.ApproachCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-text-muted">
      loading the approach…
    </div>
  ),
});

export interface ApproachViewProps {
  runs?: readonly Run[];
  source?: 'live' | 'none';
  store?: StoreApi<ApproachState>;
  capacity?: number;
  height?: number;
  frameloop?: 'always' | 'demand';
  onRender?: (stats: RenderStats) => void;
  onFrame?: (ms: number) => void;
  navigate?: (href: string) => void;
}

const NO_RUNS: readonly Run[] = [];

export const parseLiveEvent = (data: string): Event | undefined => {
  try {
    const parsed = eventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

// Events arrive in bursts on catch-up; one store update per microtask keeps the canvas at one sync per frame.
export function useLiveFeed(store: StoreApi<ApproachState>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource('/api/live');
    let pending: Event[] = [];
    const flush = (): void => {
      const batch = pending;
      pending = [];
      store.getState().ingest(batch, performance.now());
    };
    const onEvent = (message: MessageEvent<string>): void => {
      const event = parseLiveEvent(message.data);
      if (event === undefined) return;
      if (pending.length === 0) queueMicrotask(flush);
      pending.push(event);
    };
    source.addEventListener('event', onEvent);
    source.onopen = () => {
      store.getState().setConnection('live');
    };
    source.onerror = () => {
      store.getState().setConnection('offline');
    };
    return () => {
      source.removeEventListener('event', onEvent);
      source.close();
    };
  }, [store, enabled]);
}

export function AgentHoverCard({ agent, now }: { agent: Agent; now: number }) {
  return (
    <div
      className="pointer-events-auto absolute top-4 left-4 max-w-sm rounded border border-stage-edge bg-stage-raised p-3 text-sm shadow-lg"
      data-testid="agent-card"
      role="status"
    >
      <p className="font-mono text-xs text-text-muted">run · {agent.runId}</p>
      <p className="mt-1 font-semibold">{agent.agentName}</p>
      <p className="mt-1 font-mono text-xs">
        <span className="text-cyan">{agent.principalId ?? 'no principal'}</span>
        {agent.system === undefined ? '' : ` → ${agent.system}`} ·{' '}
        <span
          className={
            agent.risk === 'critical' || agent.risk === 'high' ? 'text-ember' : 'text-text-muted'
          }
        >
          risk {agent.risk ?? 'unknown'}
        </span>{' '}
        · {agent.events} event{agent.events === 1 ? '' : 's'}
        {isIdle(agent, now) ? ' · idle' : ''}
      </p>
      {agent.summary === undefined ? null : <p className="mt-2 text-text">{agent.summary}</p>}
      <a
        className="mt-2 inline-block font-mono text-xs text-cyan underline"
        href={`/runs/${encodeURIComponent(agent.runId)}`}
        data-testid="open-run"
      >
        open the run ↗
      </a>
    </div>
  );
}

const CONNECTION_TEXT = {
  connecting: 'connecting…',
  live: '● live',
  offline: '○ offline · retrying',
  simulated: '◌ simulated',
} as const;

// ARCHITECTURE §11 Approach: the live canvas, its zone labels, the hovered agent's card and the feed's vital signs.
export function ApproachView({
  runs = NO_RUNS,
  source = 'live',
  store: provided,
  capacity,
  height = 560,
  frameloop,
  onRender,
  onFrame,
  navigate,
}: ApproachViewProps) {
  const router = useRouter();
  const [store] = useState(() => provided ?? createApproachStore());
  useEffect(() => {
    store.getState().seedRuns(runs);
  }, [store, runs]);
  useLiveFeed(store, source === 'live');
  const agents = useStore(store, (state) => state.agents);
  const zones = useStore(store, (state) => state.zones);
  const principals = useStore(store, (state) => state.principals);
  const received = useStore(store, (state) => state.received);
  const critical = useStore(store, (state) => state.critical);
  const connection = useStore(store, (state) => state.connection);
  const [hovered, setHovered] = useState<number | undefined>(undefined);
  const [labels, setLabels] = useState<StageLabel[]>([]);
  const order = useMemo(() => [...agents.values()], [agents]);
  const agent = hovered === undefined ? undefined : order[hovered];
  const open = useCallback(
    (slot: number) => {
      const target = order[slot];
      if (target === undefined) return;
      const href = `/runs/${encodeURIComponent(target.runId)}`;
      if (navigate === undefined) router.push(href);
      else navigate(href);
    },
    [order, navigate, router],
  );
  return (
    <div
      className="relative w-full overflow-hidden rounded border border-stage-edge"
      style={{ height }}
      data-testid="approach-view"
      data-connection={connection}
    >
      <ApproachCanvas
        store={store}
        capacity={capacity}
        hovered={hovered}
        onHover={setHovered}
        onSelect={open}
        onLabels={setLabels}
        onRender={onRender}
        onFrame={onFrame}
        frameloop={frameloop}
      />
      {labels.map((label) =>
        label.kind === 'zone' ? (
          <div
            key={`zone:${label.name}`}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full text-center font-mono text-xs whitespace-nowrap"
            style={{ left: label.x, top: label.y }}
            data-testid="zone-label"
          >
            <span className="text-text">{label.name}</span>
            <span className="text-text-muted">
              {' '}
              · {label.events}
              {label.riskMax === undefined ? '' : ` · ${label.riskMax}`}
            </span>
          </div>
        ) : (
          <div
            key={`principal:${label.name}`}
            className="pointer-events-none absolute -translate-x-1/2 text-center font-mono text-xs whitespace-nowrap text-text-muted"
            style={{ left: label.x, top: label.y }}
            data-testid="principal-label"
          >
            {label.name}
          </div>
        ),
      )}
      {agent === undefined ? null : <AgentHoverCard agent={agent} now={performance.now()} />}
      <p
        className="pointer-events-none absolute bottom-4 left-4 font-mono text-xs text-text-muted"
        data-testid="approach-stats"
      >
        {agents.size} agent{agents.size === 1 ? '' : 's'} · {zones.size} system
        {zones.size === 1 ? '' : 's'} · {principals.size} principal
        {principals.size === 1 ? '' : 's'} · {received} received ·{' '}
        <span className={critical > 0 ? 'text-ember' : ''}>{critical} critical</span>
        {agents.size > LOD_AGENT_THRESHOLD ? ' · trails and leashes off beyond 1,000 agents' : ''}
      </p>
      <p
        className="pointer-events-none absolute right-4 bottom-4 font-mono text-xs"
        data-testid="connection"
      >
        <span className={connection === 'live' ? 'text-cyan' : 'text-text-muted'}>
          {CONNECTION_TEXT[connection]}
        </span>
      </p>
      <div
        className="pointer-events-none absolute top-4 right-4 flex gap-3 font-mono text-xs"
        data-testid="approach-legend"
      >
        <span className="text-cyan">● agent</span>
        <span className="text-ember">● critical</span>
        <span className="text-text-muted">▬ system · leash to principal</span>
      </div>
    </div>
  );
}
