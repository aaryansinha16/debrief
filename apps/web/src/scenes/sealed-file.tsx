'use client';

import {
  type Bundle,
  type BundleVerification,
  type RegulationMap,
  regulationMapSchema,
  unpackBundle,
  verifyBundle,
} from '@debrief/evidence';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Segmented } from '../components/controls';
import type { EvidenceJob } from '../lib/api';

export interface SealedFileProps {
  runId: string;
  verifyUrl: string;
  policyIds?: readonly string[];
  pollMs?: number;
}

export type SealState =
  | { phase: 'idle' }
  | { phase: 'sealing'; job: EvidenceJob }
  | { phase: 'verifying'; job: EvidenceJob }
  | {
      phase: 'sealed';
      job: EvidenceJob;
      bundle: Bundle;
      verdict: BundleVerification;
      bytes: Uint8Array;
    }
  | { phase: 'rejected'; job: EvidenceJob; verdict?: BundleVerification; reason: string }
  | { phase: 'failed'; reason: string };

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : 'unknown error';

const readMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { message?: unknown };
    return typeof body.message === 'string'
      ? body.message
      : `${String(response.status)} from the api`;
  } catch {
    return `${String(response.status)} from the api`;
  }
};

export async function queueSeal(
  runId: string,
  options: { includeContent: boolean; policyId: string },
): Promise<EvidenceJob> {
  const response = await fetch(`/api/evidence?run=${encodeURIComponent(runId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!response.ok) throw new Error(await readMessage(response));
  return (await response.json()) as EvidenceJob;
}

export async function pollSeal(jobId: string): Promise<EvidenceJob> {
  const response = await fetch(`/api/evidence/${encodeURIComponent(jobId)}`);
  if (!response.ok) throw new Error(await readMessage(response));
  return (await response.json()) as EvidenceJob;
}

export async function fetchBundle(jobId: string): Promise<Uint8Array> {
  const response = await fetch(`/api/evidence/${encodeURIComponent(jobId)}/bundle`);
  if (!response.ok) throw new Error(await readMessage(response));
  return new Uint8Array(await response.arrayBuffer());
}

// The bundle is unpacked and verified here, in the browser, with the chain package; the download appears only after it passes.
export function verifyBytes(bytes: Uint8Array): { bundle: Bundle; verdict: BundleVerification } {
  const bundle = unpackBundle(bytes);
  return { bundle, verdict: verifyBundle(bundle) };
}

// A bundle written by another version may carry a map this page cannot read; the download is still verified.
const readMap = (raw: unknown): RegulationMap | undefined => {
  const parsed = regulationMapSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
};

const SUPPORT_CLASS = {
  supports: 'text-cyan',
  'partially-supports': 'text-text-muted',
  'not-applicable': 'text-text-muted opacity-60',
} as const;

const SUPPORT_MARK = { supports: '✓', 'partially-supports': '◐', 'not-applicable': '—' } as const;

export function RegulationChecklist({ map }: { map: RegulationMap | undefined }) {
  if (map === undefined) {
    return (
      <p className="text-xs text-text-muted" data-testid="regulation-checklist">
        This bundle carries a regulation map this page cannot read; open regulation_map.json in the
        bundle.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="regulation-checklist">
      <p className="text-xs text-text-muted">{map.disclaimer}</p>
      {map.frameworks.map((framework) => (
        <div key={framework.id} data-testid="framework" data-framework={framework.id}>
          <h3 className="mb-1 text-sm font-semibold">{framework.title}</h3>
          <p className="mb-2 font-mono text-xs text-text-muted">{framework.reference}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {framework.elements.map((element) => (
              <li
                key={element.id}
                className="grid grid-cols-[1.25rem_1fr] gap-x-2"
                data-testid="element"
                data-support={element.support}
              >
                <span className={SUPPORT_CLASS[element.support]} aria-hidden="true">
                  {SUPPORT_MARK[element.support]}
                </span>
                <span>
                  <span>{element.requirement}</span>{' '}
                  <span className={`font-mono text-xs ${SUPPORT_CLASS[element.support]}`}>
                    {element.support}
                    {element.sections.length === 0 ? '' : ` · ${element.sections.join(', ')}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function VerificationSummary({ verdict }: { verdict: BundleVerification }) {
  const byName = new Map<string, { ok: number; total: number }>();
  for (const check of verdict.checks) {
    const entry = byName.get(check.name) ?? { ok: 0, total: 0 };
    entry.total += 1;
    if (check.ok) entry.ok += 1;
    byName.set(check.name, entry);
  }
  return (
    <ul className="flex flex-col gap-1 font-mono text-xs" data-testid="verification">
      {[...byName.entries()].map(([name, entry]) => (
        <li key={name} className={entry.ok === entry.total ? 'text-cyan' : 'text-ember'}>
          {entry.ok === entry.total ? '✓' : '✗'} {name} · {entry.ok}/{entry.total}
        </li>
      ))}
      {verdict.failedAt === undefined ? null : (
        <li className="text-ember" data-testid="verification-failure">
          first failure: {verdict.failedAt.name} at{' '}
          {[
            verdict.failedAt.subject,
            verdict.failedAt.seq === undefined
              ? undefined
              : `(seq ${String(verdict.failedAt.seq)})`,
            verdict.failedAt.detail,
          ]
            .filter((part) => part !== undefined)
            .join(' · ')}
        </li>
      )}
    </ul>
  );
}

// ARCHITECTURE §11 Sealed File: export form, seal on completion, download and verifier link, checklist from the regulation map.
export function SealedFile({
  runId,
  verifyUrl,
  policyIds = ['prod-guard', 'allow-all'],
  pollMs = 500,
}: SealedFileProps) {
  const [includeContent, setIncludeContent] = useState(false);
  const [policyId, setPolicyId] = useState(policyIds[0] ?? 'prod-guard');
  const [state, setState] = useState<SealState>({ phase: 'idle' });
  const [downloadHref, setDownloadHref] = useState<string | undefined>(undefined);
  const cancelled = useRef(false);
  useEffect(
    () => () => {
      cancelled.current = true;
      if (downloadHref !== undefined) URL.revokeObjectURL(downloadHref);
    },
    [downloadHref],
  );
  const seal = useCallback(async () => {
    setDownloadHref(undefined);
    try {
      let job = await queueSeal(runId, { includeContent, policyId });
      setState({ phase: 'sealing', job });
      while (job.status === 'queued' || job.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        if (cancelled.current) return;
        job = await pollSeal(job.id);
        setState({ phase: 'sealing', job });
      }
      if (job.status === 'failed') {
        setState({ phase: 'failed', reason: job.error ?? 'the evidence job failed' });
        return;
      }
      setState({ phase: 'verifying', job });
      const bytes = await fetchBundle(job.id);
      let checked: { bundle: Bundle; verdict: BundleVerification };
      try {
        checked = verifyBytes(bytes);
      } catch (error) {
        setState({ phase: 'rejected', job, reason: describeError(error) });
        return;
      }
      if (!checked.verdict.ok) {
        setState({
          phase: 'rejected',
          job,
          verdict: checked.verdict,
          reason: 'the bundle did not verify; the download is withheld',
        });
        return;
      }
      setDownloadHref(
        URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' })),
      );
      setState({ phase: 'sealed', job, bundle: checked.bundle, verdict: checked.verdict, bytes });
    } catch (error) {
      setState({ phase: 'failed', reason: describeError(error) });
    }
  }, [runId, includeContent, policyId, pollMs]);
  const busy = state.phase === 'sealing' || state.phase === 'verifying';
  return (
    <div
      className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]"
      data-testid="sealed-file"
      data-phase={state.phase}
    >
      <form
        className="glass flex flex-col gap-4 rounded-lg p-4"
        aria-label="export"
        onSubmit={(event) => {
          event.preventDefault();
          void seal();
        }}
      >
        <h2 className="text-[11px] font-medium tracking-[0.18em] uppercase text-text-muted">
          export
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeContent}
            disabled={busy}
            onChange={(event) => {
              setIncludeContent(event.target.checked);
            }}
            data-testid="include-content"
          />
          include sealed content (summaries are always included)
        </label>
        <div className="flex items-center gap-2 text-sm" data-testid="policy" data-value={policyId}>
          policy
          <Segmented
            label="policy"
            options={policyIds.map((id) => ({ value: id, label: id }))}
            value={policyId}
            onChange={(id: string) => {
              if (!busy) setPolicyId(id);
            }}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          className="justify-center"
          disabled={busy}
          data-testid="seal"
        >
          {state.phase === 'sealing'
            ? `sealing… (${state.job.status})`
            : state.phase === 'verifying'
              ? 'verifying in the browser…'
              : 'seal the file'}
        </Button>
        {state.phase === 'failed' ? (
          <p className="font-mono text-xs text-ember" data-testid="seal-failure">
            {state.reason}
          </p>
        ) : null}
        {state.phase === 'rejected' ? (
          <div className="flex flex-col gap-2" data-testid="seal-rejected">
            <p className="font-mono text-xs text-ember">{state.reason}</p>
            {state.verdict === undefined ? null : <VerificationSummary verdict={state.verdict} />}
          </div>
        ) : null}
      </form>
      <section className="glass relative min-h-64 rounded-lg p-4" aria-label="sealed file">
        {state.phase === 'sealed' ? (
          <div className="flex flex-col gap-4" data-testid="sealed">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">
                  <span className="text-ember">sealed</span> · verified in this browser
                </h2>
                <p className="mt-1 font-mono text-xs text-text-muted">
                  {state.verdict.events} events · {state.verdict.checkpoints} checkpoint
                  {state.verdict.checkpoints === 1 ? '' : 's'} · {state.verdict.checks.length}{' '}
                  checks passed · key {state.bundle.manifest.keyId} ·{' '}
                  {state.bytes.byteLength.toLocaleString('en-US')} bytes
                </p>
              </div>
              <div
                className="animate-seal flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-ember font-mono text-xs tracking-widest text-ember uppercase"
                data-testid="seal-stamp"
                aria-hidden="true"
              >
                sealed
              </div>
            </div>
            <VerificationSummary verdict={state.verdict} />
            <div className="flex flex-wrap items-center gap-3">
              <a
                className="rounded border border-cyan px-4 py-2 font-mono text-sm text-cyan hover:bg-stage-raised"
                href={downloadHref}
                download={`debrief-evidence-${state.job.id}.zip`}
                data-testid="download"
              >
                download bundle.zip
              </a>
              {state.job.downloadUrl?.startsWith('http') === true ? (
                <a
                  className="font-mono text-xs text-text-muted underline"
                  href={state.job.downloadUrl}
                  data-testid="storage-link"
                >
                  storage link (15 min)
                </a>
              ) : null}
              <a
                className="font-mono text-xs text-cyan underline"
                href={verifyUrl}
                target="_blank"
                rel="noreferrer"
                data-testid="verifier-link"
              >
                open the verifier ↗
              </a>
            </div>
            <RegulationChecklist map={readMap(state.bundle.regulationMap)} />
          </div>
        ) : (
          <p className="text-sm text-text-muted" data-testid="sealed-placeholder">
            {state.phase === 'idle'
              ? 'Seal the file to build the bundle: events, checkpoints, proofs, report and regulation map, signed by the API. It is verified here, in your browser, before you can download it.'
              : state.phase === 'sealing'
                ? `Sealing run ${runId} · job ${state.job.id} is ${state.job.status}…`
                : state.phase === 'verifying'
                  ? 'Checking every hash, proof and signature with the chain package…'
                  : 'The file was not sealed.'}
          </p>
        )}
      </section>
    </div>
  );
}
