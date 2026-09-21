'use client';

import { COLORS } from '@debrief/ui';
import Link from 'next/link';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

import type { Lineage, LineageHop } from '../lib/api';
import {
  type PlacedNode,
  describeMismatch,
  initialFocus,
  lineageTree,
  nextFocus,
} from '../lib/lineage-tree';

export interface LineageSceneProps {
  lineage: Lineage;
  runId: string;
}

const NODE_R = 9;
const RING_R = 22;
const RING_OFFSET = 7;

const nodeFill = (node: PlacedNode): string => {
  if (node.kind === 'action') return COLORS.ember;
  if (node.type === 'agent' || node.type === 'subagent') return COLORS.cyan;
  if (node.type === 'grant') return COLORS.cyanDim;
  return COLORS.text;
};

const ringStroke = (severity: PlacedNode['severity']): string =>
  severity === 'major' ? COLORS.ember : severity === 'minor' ? COLORS.emberDim : COLORS.cyanDim;

const excessOf = (hop: LineageHop): string[] => [
  ...new Set((hop.scopeMismatch ?? []).flatMap((mismatch) => mismatch.excess)),
];

// One item per line under the hop, cut to the column width; the panel has the full text.
const shorten = (item: string, max = 26): string =>
  item.length <= max ? item : `${item.slice(0, max - 1)}…`;

const linkPath = (from: PlacedNode, to: PlacedNode): string => {
  const x1 = from.x + RING_R + 4;
  const x2 = to.x - RING_R - 4;
  const bend = (x2 - x1) / 2;
  return `M ${String(x1)} ${String(from.y)} C ${String(x1 + bend)} ${String(from.y)}, ${String(x2 - bend)} ${String(to.y)}, ${String(x2)} ${String(to.y)}`;
};

function HopDetails({ node, runId }: { node: PlacedNode; runId: string }) {
  const hop = node.hop;
  const action = node.action;
  const excess = hop === undefined ? [] : excessOf(hop);
  const mismatches = hop?.scopeMismatch ?? [];
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="lineage-details" data-node={node.id}>
      <div>
        <p className="font-mono text-xs text-text-muted">
          {node.type} · {node.id}
        </p>
        <p className="mt-1 text-base font-semibold">{node.label}</p>
      </div>
      {action === undefined ? null : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
          {action.target === undefined ? null : (
            <>
              <dt className="text-text-muted">system</dt>
              <dd>{action.target.system}</dd>
              {action.target.resource === undefined ? null : (
                <>
                  <dt className="text-text-muted">resource</dt>
                  <dd className="break-all">{action.target.resource}</dd>
                </>
              )}
              {action.target.environment === undefined ? null : (
                <>
                  <dt className="text-text-muted">environment</dt>
                  <dd className={action.target.environment === 'production' ? 'text-ember' : ''}>
                    {action.target.environment}
                  </dd>
                </>
              )}
              {action.target.risk === undefined ? null : (
                <>
                  <dt className="text-text-muted">risk</dt>
                  <dd className={action.target.risk === 'critical' ? 'text-ember' : ''}>
                    {action.target.risk}
                  </dd>
                </>
              )}
            </>
          )}
          {action.descriptor === undefined ? null : (
            <>
              <dt className="text-text-muted">descriptor</dt>
              <dd className="break-all">{action.descriptor}</dd>
            </>
          )}
        </dl>
      )}
      {hop?.authority === undefined ? null : (
        <div className="flex flex-col gap-2" data-testid="hop-authority">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
            <dt className="text-text-muted">principal</dt>
            <dd>{hop.authority.principalId ?? '—'}</dd>
            <dt className="text-text-muted">token</dt>
            <dd className="break-all">
              {hop.authority.tokenRef ?? hop.authority.grantId ?? hop.authority.grantNodeId}
            </dd>
          </dl>
          <p className="font-mono text-xs text-text-muted">scope</p>
          <ul className="flex flex-wrap gap-1 font-mono text-xs" data-testid="hop-scope">
            {hop.authority.scope.map((item) => (
              <li key={item} className="rounded border border-cyan-dim px-1.5 py-0.5 text-cyan">
                {item}
              </li>
            ))}
          </ul>
          <p className="font-mono text-xs text-text-muted">permissions</p>
          <ul className="flex flex-wrap gap-1 font-mono text-xs" data-testid="hop-permissions">
            {hop.authority.permissions.map((item) => (
              <li
                key={item}
                className={`rounded border px-1.5 py-0.5 ${excess.includes(item) ? 'border-ember text-ember' : 'border-stage-edge text-text'}`}
                data-excess={excess.includes(item) ? 'yes' : 'no'}
              >
                {item}
              </li>
            ))}
          </ul>
          {mismatches.length === 0 ? (
            <p className="font-mono text-xs text-cyan">permissions within scope</p>
          ) : (
            <ul className="flex flex-col gap-1 font-mono text-xs" data-testid="hop-mismatches">
              {mismatches.map((mismatch) => (
                <li
                  key={`${mismatch.kind}:${mismatch.excess.join(',')}`}
                  className={mismatch.severity === 'major' ? 'text-ember' : 'text-ember-dim'}
                >
                  {mismatch.severity} · {describeMismatch(mismatch)}
                </li>
              ))}
            </ul>
          )}
          <ul className="flex flex-col gap-1 font-mono text-xs" data-testid="hop-events">
            {hop.authority.eventIds.map((eventId) => (
              <li key={eventId} className="flex flex-wrap gap-x-3">
                <span className="text-text-muted">{eventId}</span>
                <Link
                  href={`/runs/${encodeURIComponent(runId)}?event=${encodeURIComponent(eventId)}`}
                  className="text-cyan underline"
                  data-testid="open-grant"
                >
                  open the grant in the theatre
                </Link>
                <a
                  href={`/api/proof?event=${encodeURIComponent(eventId)}`}
                  className="text-cyan underline"
                  target="_blank"
                  rel="noreferrer"
                  data-testid="verify-grant"
                >
                  verify ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ARCHITECTURE §11 Lineage: an SVG tree, the mismatch hop highlighted, scope and permissions as two overlapping rings.
export function LineageScene({ lineage, runId }: LineageSceneProps) {
  const layout = useMemo(() => lineageTree(lineage), [lineage]);
  const [active, setActive] = useState(() => initialFocus(layout));
  const [byKeyboard, setByKeyboard] = useState(false);
  const items = useRef(new Map<number, SVGGElement>());
  useEffect(() => {
    setActive(initialFocus(layout));
    setByKeyboard(false);
  }, [layout]);
  useEffect(() => {
    if (byKeyboard) items.current.get(active)?.focus();
  }, [active, byKeyboard]);
  const onKeyDown = (event: KeyboardEvent<SVGGElement>, index: number): void => {
    const next = nextFocus(event.key, index, layout.nodes.length);
    if (next === undefined) return;
    event.preventDefault();
    setByKeyboard(true);
    setActive(next);
  };
  const current = layout.nodes[active] ?? layout.action;
  const height = Math.max(layout.height + 60, 260);
  return (
    <div
      className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]"
      data-testid="lineage-scene"
      data-mismatches={lineage.mismatches}
    >
      <div className="glass flex items-center overflow-x-auto rounded-lg p-2">
        <svg
          role="tree"
          aria-label="authority lineage"
          viewBox={`0 0 ${String(layout.width)} ${String(height)}`}
          width={layout.width}
          height={height}
          className="max-w-full"
          data-testid="lineage-tree"
        >
          {layout.links.map((link) => (
            <path
              key={`${link.from.id}→${link.to.id}`}
              d={linkPath(link.from, link.to)}
              fill="none"
              stroke={link.to.severity === undefined ? COLORS.stageEdge : COLORS.emberDim}
              strokeWidth={link.to.severity === 'major' ? 2 : 1.5}
              data-testid="lineage-link"
            />
          ))}
          {layout.nodes.map((node) => {
            const selected = node.index === active;
            const authority = node.hop?.authority;
            return (
              <g
                key={node.id}
                ref={(element) => {
                  if (element === null) items.current.delete(node.index);
                  else items.current.set(node.index, element);
                }}
                role="treeitem"
                aria-selected={selected}
                aria-level={node.depth + 1}
                aria-label={`${node.type} ${node.label}${node.severity === undefined ? '' : `, ${node.severity} scope mismatch`}`}
                tabIndex={selected ? 0 : -1}
                className="cursor-pointer outline-none"
                data-testid="lineage-node"
                data-node={node.id}
                data-severity={node.severity ?? 'none'}
                onClick={() => {
                  setByKeyboard(false);
                  setActive(node.index);
                }}
                onFocus={() => {
                  setActive(node.index);
                }}
                onKeyDown={(event) => {
                  onKeyDown(event, node.index);
                }}
              >
                {node.severity === undefined ? null : (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={RING_R + 10}
                    fill={COLORS.ember}
                    fillOpacity={node.severity === 'major' ? 0.16 : 0.08}
                    data-testid="mismatch-halo"
                  />
                )}
                {authority === undefined ? null : (
                  <>
                    <circle
                      cx={node.x - RING_OFFSET}
                      cy={node.y}
                      r={RING_R}
                      fill="none"
                      stroke={COLORS.cyan}
                      strokeWidth={1.5}
                      data-testid="scope-ring"
                    />
                    <circle
                      cx={node.x + RING_OFFSET}
                      cy={node.y}
                      r={RING_R}
                      fill="none"
                      stroke={ringStroke(node.severity)}
                      strokeWidth={node.severity === 'major' ? 2.5 : 1.5}
                      strokeDasharray={node.severity === 'minor' ? '4 3' : undefined}
                      data-testid="permissions-ring"
                    />
                  </>
                )}
                {selected ? (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={RING_R + 16}
                    fill="none"
                    stroke={COLORS.text}
                    strokeWidth={1}
                    strokeDasharray="2 3"
                    data-testid="focus-ring"
                  />
                ) : null}
                {node.kind === 'action' ? (
                  <rect
                    x={node.x - NODE_R}
                    y={node.y - NODE_R}
                    width={NODE_R * 2}
                    height={NODE_R * 2}
                    fill={nodeFill(node)}
                    transform={`rotate(45 ${String(node.x)} ${String(node.y)})`}
                  />
                ) : (
                  <circle cx={node.x} cy={node.y} r={NODE_R} fill={nodeFill(node)} />
                )}
                <text
                  x={node.x}
                  y={node.y - RING_R - 22}
                  textAnchor="middle"
                  fill={COLORS.textMuted}
                  fontSize={11}
                  fontFamily="ui-monospace, monospace"
                >
                  {node.type}
                </text>
                <text
                  x={node.x}
                  y={node.y + RING_R + 22}
                  textAnchor="middle"
                  fill={COLORS.text}
                  fontSize={13}
                >
                  {node.label}
                </text>
                {node.severity === undefined || node.hop === undefined ? null : (
                  <text
                    x={node.x}
                    y={node.y + RING_R + 40}
                    textAnchor="middle"
                    fill={node.severity === 'major' ? COLORS.ember : COLORS.emberDim}
                    fontSize={11}
                    fontFamily="ui-monospace, monospace"
                    data-testid="mismatch-label"
                  >
                    <tspan x={node.x}>{node.severity} mismatch</tspan>
                    {excessOf(node.hop).map((item) => (
                      <tspan key={item} x={node.x} dy={14}>
                        +{shorten(item)}
                      </tspan>
                    ))}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <aside className="glass rounded-lg p-4">
        <p className="mb-3 font-mono text-xs text-text-muted" data-testid="lineage-summary">
          {lineage.mismatches} mismatch{lineage.mismatches === 1 ? '' : 'es'} ·{' '}
          {lineage.complete ? 'lineage complete' : 'lineage incomplete'} ·{' '}
          <span className={lineage.authorityObserved ? 'text-ember' : 'text-cyan'}>
            {lineage.authorityObserved ? '● authority observed' : '○ authority reported'}
          </span>
        </p>
        <HopDetails node={current} runId={runId} />
        <p className="mt-4 text-xs text-text-muted">← → walk the chain · Home/End jump</p>
      </aside>
    </div>
  );
}
