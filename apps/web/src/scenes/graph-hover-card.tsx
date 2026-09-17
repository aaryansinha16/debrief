import type { SceneNode } from '../lib/scene';

export interface GraphHoverCardProps {
  node: SceneNode;
  eventCount: number;
}

// Every glyph's hover card: the node, its provenance, the first event summary, and the verify affordance (§11).
export function GraphHoverCard({ node, eventCount }: GraphHoverCardProps) {
  const firstEvent = node.eventIds[0];
  return (
    <div
      className="pointer-events-auto absolute top-4 left-4 max-w-sm rounded border border-stage-edge bg-stage-raised p-3 text-sm shadow-lg"
      data-testid="hover-card"
      role="status"
    >
      <p className="font-mono text-xs text-text-muted">
        {node.type} · {node.id}
      </p>
      <p className="mt-1 font-semibold">{node.label}</p>
      <p className={`mt-1 text-xs ${node.provenance === 'observed' ? 'text-ember' : 'text-cyan'}`}>
        {node.provenance === 'observed' ? '● observed by the world' : '○ reported by the agent'} ·{' '}
        {eventCount} event{eventCount === 1 ? '' : 's'}
      </p>
      {node.summary === undefined ? null : <p className="mt-2 text-text">{node.summary}</p>}
      {firstEvent === undefined ? null : (
        <a
          className="mt-2 inline-block font-mono text-xs text-cyan underline"
          href={`/api/proof?event=${encodeURIComponent(firstEvent)}`}
          target="_blank"
          rel="noreferrer"
          data-testid="verify"
        >
          verify inclusion proof ↗
        </a>
      )}
    </div>
  );
}

export function ProvenanceLegend() {
  return (
    <div
      className="pointer-events-none absolute right-4 bottom-4 flex gap-4 font-mono text-xs"
      data-testid="legend"
    >
      <span className="text-cyan">○ reported</span>
      <span className="text-ember">● observed</span>
    </div>
  );
}
