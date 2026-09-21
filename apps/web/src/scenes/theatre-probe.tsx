'use client';

import { PROD_GUARD_YAML, parsePolicy } from '@debrief/policy';
import { blastRadius, divergence, reconstructGraph } from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import type { ReplayClock } from '@debrief/ui';
import { useCallback, useMemo } from 'react';

import { Theatre } from './theatre';

export interface TheatreHandle {
  ready: boolean;
  freezeT?: number;
  frames: number;
}

declare global {
  interface Window {
    __theatre?: TheatreHandle;
    __theatreSeek?: (t: number) => void;
    __theatrePlay?: (rate?: number) => void;
    __theatreFreeze?: () => void;
    __theatreDuration?: () => number;
    __theatreState?: () => { t: number; playing: boolean; frozenAt?: number; stopAt?: number };
  }
}

// The demo run reconstructed in the browser so the theatre check and the film need no API: the clock is the page's own.
export function TheatreProbe() {
  const data = useMemo(() => {
    const events = demoRunFixture();
    const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
    const report = divergence(events, parsePolicy(PROD_GUARD_YAML), graph);
    const blast =
      report.freezeFrame?.nodeId === undefined
        ? undefined
        : blastRadius(graph, report.freezeFrame.nodeId, events);
    return {
      events,
      graph,
      blast,
      divergence: {
        runId: DEMO_RUN_ID,
        evaluated: report.evaluated,
        points: report.points,
        ...(report.freezeFrame === undefined ? {} : { freezeFrame: report.freezeFrame }),
      },
    };
  }, []);
  const onClock = useCallback((clock: ReplayClock): void => {
    window.__theatreSeek = (t: number) => {
      clock.getState().pause();
      clock.getState().seek(t);
    };
    window.__theatrePlay = (rate = 1) => {
      clock.getState().setRate(rate);
      clock.getState().seek(0);
      clock.getState().play();
    };
    // Lands on the divergence the way playback does: crossing the stop freezes the clock.
    window.__theatreFreeze = () => {
      const stopAt = clock.getState().stopAt;
      if (stopAt === undefined) return;
      clock.getState().seek(Math.max(0, stopAt - 1));
      clock.getState().play();
      clock.getState().tick(2);
    };
    window.__theatreDuration = () => clock.getState().duration;
    window.__theatreState = () => {
      const { t, playing, frozenAt, stopAt } = clock.getState();
      return {
        t,
        playing,
        ...(frozenAt === undefined ? {} : { frozenAt }),
        ...(stopAt === undefined ? {} : { stopAt }),
      };
    };
    window.__theatre = { ready: true, frames: 0 };
    const unsubscribe = clock.subscribe((state) => {
      window.__theatre = {
        ready: true,
        frames: window.__theatre?.frames ?? 0,
        ...(state.stopAt === undefined ? {} : { freezeT: state.stopAt }),
      };
    });
    window.addEventListener('beforeunload', unsubscribe);
  }, []);
  const onFrame = useCallback((): void => {
    if (window.__theatre !== undefined) window.__theatre.frames += 1;
  }, []);
  return (
    <div data-testid="theatre-probe">
      <Theatre
        graph={data.graph}
        events={data.events}
        divergence={data.divergence}
        {...(data.blast === undefined ? {} : { blast: data.blast })}
        policyId="prod-guard"
        policyYaml={PROD_GUARD_YAML}
        onClock={onClock}
        onFrame={onFrame}
      />
    </div>
  );
}
