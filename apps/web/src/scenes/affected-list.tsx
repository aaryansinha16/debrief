import type { BlastRadius, BlastResource, GraphResponse } from '../lib/api';

export interface AffectedListProps {
  blast: BlastRadius;
  graph: GraphResponse['graph'];
  progress?: number;
}

const REASON_TEXT: Record<BlastResource['reasons'][number], string> = {
  'backups-deleted': 'backups deleted',
  'backup-exists': 'a backup exists',
  'irreversible-operation': 'irreversible operation',
  'reversible-operation': 'reversible operation',
  'read-only': 'read only',
};

const plural = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

// ARCHITECTURE §11: the affected list groups the blast by system; each resource carries its recoverable flag and the wave that reached it.
export function AffectedList({
  blast,
  graph,
  progress = Number.POSITIVE_INFINITY,
}: AffectedListProps) {
  const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const reached = new Map<string, { resource: BlastResource; hop: number }>();
  for (const wave of blast.waves) {
    for (const resource of wave.resources)
      reached.set(resource.nodeId, { resource, hop: wave.hop });
  }
  const systems = Object.entries(blast.groups).sort(([a], [b]) => a.localeCompare(b));
  return (
    <section
      className="flex flex-col gap-4"
      data-testid="affected"
      data-recoverable={blast.recoverable ? 'yes' : 'no'}
      aria-label="affected resources"
    >
      <div>
        <h2 className="text-sm tracking-wider text-text-muted uppercase">blast radius</h2>
        <p className="mt-1 text-sm">
          <span className="font-mono">{labels.get(blast.origin) ?? blast.origin}</span> reaches{' '}
          {plural(reached.size, 'resource')} across {plural(systems.length, 'system')} ·{' '}
          <span className={blast.recoverable ? 'text-cyan' : 'text-ember'}>
            {blast.recoverable ? 'recoverable' : 'not recoverable'}
          </span>
        </p>
      </div>
      {systems.map(([system, ids]) => (
        <div key={system} data-testid="affected-system" data-system={system}>
          <h3 className="mb-2 font-mono text-sm text-text-muted">
            {system} · {ids.length}
          </h3>
          <ul className="flex flex-col gap-2">
            {ids.map((id) => {
              const entry = reached.get(id);
              if (entry === undefined) return null;
              const { resource, hop } = entry;
              const lit = progress >= hop;
              return (
                <li
                  key={id}
                  className={`rounded border p-3 text-sm transition-opacity ${resource.recoverable ? 'border-stage-edge' : 'border-ember-dim'} ${lit ? '' : 'opacity-40'}`}
                  data-testid="affected-resource"
                  data-hop={hop}
                  data-recoverable={resource.recoverable ? 'yes' : 'no'}
                  data-lit={lit ? 'yes' : 'no'}
                >
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="font-mono break-all">
                      {labels.get(id) ?? resource.resource}
                    </span>
                    <span
                      className={`shrink-0 font-mono text-xs ${resource.recoverable ? 'text-cyan' : 'text-ember'}`}
                    >
                      {resource.recoverable ? '✓ recoverable' : '✗ unrecoverable'}
                    </span>
                  </p>
                  <p className="mt-1 font-mono text-xs text-text-muted">
                    wave {hop} · via {resource.via.type} ({resource.via.confidence}) ·{' '}
                    {resource.reasons.map((reason) => REASON_TEXT[reason]).join(', ')}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {reached.size === 0 ? (
        <p className="text-sm text-text-muted" data-testid="affected-empty">
          nothing downstream at strong confidence or better.
        </p>
      ) : null}
    </section>
  );
}
