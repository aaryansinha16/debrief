'use client';

import type { Event } from '@debrief/schema';
import { Scrubber, type ScrubberMarker, createReplay, createReplayClock } from '@debrief/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ReplayPanel } from '../components/replay-panel';
import type { Counterfactual } from '../lib/api';
import { branchMarkers, branchSummary, haltTime, issueLines, validatePolicy } from '../lib/branch';

export interface BranchSceneProps {
  runId: string;
  events: readonly Event[];
  recordedMarkers?: readonly ScrubberMarker[];
  initialYaml: string;
  initialBranch?: Counterfactual;
  branch: (yaml: string) => Promise<Counterfactual>;
  debounceMs?: number;
}

const STATUS_CLASS = {
  happened: 'text-text',
  'freeze-frame': 'text-ember',
  'would-not-have-happened': 'text-text-muted opacity-50',
} as const;

// ARCHITECTURE §11 Branch: the editor's YAML is validated here, a valid one is posted, and the second timeline halts and greys the rest.
export function BranchScene({
  runId,
  events,
  recordedMarkers = [],
  initialYaml,
  initialBranch,
  branch,
  debounceMs = 150,
}: BranchSceneProps) {
  const replay = useMemo(() => createReplay(events), [events]);
  const [clock] = useState(() => createReplayClock(replay.duration));
  const [yaml, setYaml] = useState(initialYaml);
  const [result, setResult] = useState<Counterfactual | undefined>(initialBranch);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [rebranchMs, setRebranchMs] = useState<number | undefined>(undefined);
  const validation = useMemo(() => validatePolicy(yaml), [yaml]);
  const editedAt = useRef<number | undefined>(undefined);
  const requests = useRef(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (initialBranch !== undefined) return;
    }
    if (!validation.ok) {
      setPending(false);
      return;
    }
    const request = requests.current + 1;
    requests.current = request;
    setPending(true);
    const timer = setTimeout(() => {
      branch(yaml)
        .then((next) => {
          if (request !== requests.current) return;
          setResult(next);
          setFailure(undefined);
          setPending(false);
          const started = editedAt.current;
          if (started !== undefined) setRebranchMs(performance.now() - started);
        })
        .catch((error: unknown) => {
          if (request !== requests.current) return;
          setFailure(error instanceof Error ? error.message : 'the branch request failed');
          setPending(false);
        });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
    };
  }, [yaml, validation, branch, debounceMs, initialBranch]);
  const issues = validation.ok ? [] : validation.issues;
  const flagged = issueLines(issues);
  const lines = yaml.split('\n');
  const timeOf = (eventId: string): number | undefined => replay.timeOf(eventId);
  const halt = result === undefined ? undefined : haltTime(result, timeOf);
  const markers = result === undefined ? [] : branchMarkers(result, timeOf);
  return (
    <div
      className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]"
      data-testid="branch-scene"
      data-run={runId}
      data-pending={pending ? 'yes' : 'no'}
      data-valid={validation.ok ? 'yes' : 'no'}
      data-halted={result?.halted === true ? 'yes' : 'no'}
      data-rebranch-ms={rebranchMs === undefined ? '' : rebranchMs.toFixed(0)}
    >
      <section className="flex flex-col gap-3" aria-label="policy editor">
        <h2 className="text-[11px] font-medium tracking-[0.18em] uppercase text-text-muted">
          policy
        </h2>
        <div
          className={`flex overflow-hidden rounded border bg-stage ${issues.length === 0 ? 'border-stage-edge' : 'border-ember-dim'}`}
        >
          <pre
            className="m-0 shrink-0 border-r border-stage-edge bg-stage-raised px-2 py-3 text-right font-mono text-xs leading-5 text-text-muted select-none"
            aria-hidden="true"
            data-testid="gutter"
          >
            {lines.map((_, index) => (
              <span
                key={index}
                className={`block ${flagged.has(index + 1) ? 'text-ember' : ''}`}
                data-line={index + 1}
                data-issue={flagged.has(index + 1) ? 'yes' : 'no'}
              >
                {flagged.has(index + 1) ? '●' : ''} {index + 1}
              </span>
            ))}
          </pre>
          <textarea
            className="min-h-[24rem] w-full resize-y overflow-x-auto bg-stage px-3 py-3 font-mono text-xs leading-5 whitespace-pre text-text outline-none"
            value={yaml}
            wrap="off"
            spellCheck={false}
            aria-label="policy yaml"
            aria-invalid={issues.length > 0}
            data-testid="policy-editor"
            onChange={(event) => {
              editedAt.current = performance.now();
              setRebranchMs(undefined);
              setYaml(event.target.value);
            }}
          />
        </div>
        {issues.length === 0 ? (
          <p className="font-mono text-xs text-cyan" data-testid="policy-ok">
            policy parses{' '}
            {pending
              ? '· branching…'
              : rebranchMs === undefined
                ? ''
                : `· re-branched in ${rebranchMs.toFixed(0)} ms`}
          </p>
        ) : (
          <ul
            className="flex flex-col gap-1 font-mono text-xs text-ember"
            data-testid="policy-issues"
          >
            {issues.map((issue) => (
              <li key={`${String(issue.line)}:${String(issue.column)}:${issue.message}`}>
                line {issue.line}:{issue.column} · {issue.message}
              </li>
            ))}
          </ul>
        )}
        {failure === undefined ? null : (
          <p className="font-mono text-xs text-ember" data-testid="branch-failure">
            {failure}
          </p>
        )}
      </section>
      <section className="flex min-w-0 flex-col gap-4" aria-label="timelines">
        <div>
          <h2 className="mb-2 text-[11px] font-medium tracking-[0.18em] uppercase text-text-muted">
            as recorded
          </h2>
          <ReplayPanel events={events} markers={recordedMarkers} clock={clock} replay={replay} />
        </div>
        <div>
          <h2 className="mb-2 text-[11px] font-medium tracking-[0.18em] uppercase text-text-muted">
            under this policy
          </h2>
          <p className="mb-2 font-mono text-xs text-text-muted" data-testid="branch-summary">
            {result === undefined ? 'no branch yet' : branchSummary(result)}
          </p>
          <div data-testid="branch-timeline">
            <Scrubber replay={replay} clock={clock} markers={markers} haltAt={halt} />
          </div>
          {result?.freezeFrame === undefined ? null : (
            <p className="mt-2 text-xs text-text-muted" data-testid="branch-explanation">
              {result.freezeFrame.explanation}
            </p>
          )}
        </div>
        {result === undefined ? null : (
          <ol
            className="glass max-h-72 overflow-y-auto rounded-lg font-mono text-xs"
            data-testid="branch-events"
          >
            {result.timeline.map((entry) => (
              <li
                key={entry.event.id}
                className={`flex gap-3 border-b border-stage-edge px-3 py-1 last:border-b-0 ${STATUS_CLASS[entry.status]}`}
                data-status={entry.status}
              >
                <span className="w-10 shrink-0 text-right">#{entry.event.seq}</span>
                <span className="w-32 shrink-0">{entry.event.kind}</span>
                <span className="truncate">
                  {entry.status === 'would-not-have-happened'
                    ? 'would not have happened · '
                    : entry.status === 'freeze-frame'
                      ? 'halt · '
                      : ''}
                  {entry.event.summary ?? ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
