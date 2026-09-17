import type { AuthorityLineage, BlastRadius, DivergenceReport } from '@debrief/reconstruct';
import { type Checkpoint, type Event, type Target, targetDescriptor } from '@debrief/schema';

import { type RegulationMap, type RegulationMapInput, regulationMap } from './regulation-map.js';

export interface ReportRun {
  id: string;
  tenantId: string;
  agentName?: string;
  principalId?: string;
}

export interface NarrativeSentence {
  text: string;
  eventIds: string[];
}

export interface ReportInput {
  run: ReportRun;
  events: readonly Event[];
  checkpoints: readonly Checkpoint[];
  policyId: string;
  divergence: DivergenceReport;
  lineage?: AuthorityLineage;
  blast?: BlastRadius;
  narrative?: readonly NarrativeSentence[];
  includeContent: boolean;
  generatedAt: string;
}

export interface Report {
  markdown: string;
  regulationMap: RegulationMap;
}

export const GLOSSARY: readonly [string, string][] = [
  [
    'tamper-evident',
    'Any change to a recorded event is detectable by whoever holds a later checkpoint; nothing here claims events cannot be changed, only that changes show.',
  ],
  ['reported', 'An event the agent or its tooling emitted about itself (telemetry, proxy).'],
  [
    'observed',
    'An event a world hook recorded on the system the agent touched, independently of the agent.',
  ],
  [
    'checkpoint',
    'A signed statement of the tenant\u2019s chain at a tree size: its Merkle root and head hash.',
  ],
  [
    'inclusion proof',
    'The hashes that lead from one event to a checkpoint\u2019s root; it verifies without the other events.',
  ],
  [
    'divergence point',
    'An event a policy would not have allowed; the first one is the freeze frame.',
  ],
  [
    'freeze frame',
    'The moment execution would have halted under the policy: the action, its authority and what followed.',
  ],
  [
    'authority lineage',
    'The chain of principal, agent and grants that led to an action, with scope and permissions per hop.',
  ],
  [
    'scope mismatch',
    'A grant whose permissions exceed its scope, or an action outside the scope it was granted.',
  ],
  [
    'blast radius',
    'The resources reached from an action, wave by wave, with whether each is recoverable.',
  ],
  [
    'counterfactual',
    'The recorded events replayed under another policy: the prefix that stands and the events that would not have happened.',
  ],
];

type Cell = string | number;

const cell = (value: Cell): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

const table = (header: readonly string[], rows: readonly (readonly Cell[])[]): string =>
  [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');

const describeTarget = (target: Target | undefined): string => {
  if (target === undefined) return '';
  const detail = targetDescriptor(target) ?? target.operation;
  return detail === undefined ? target.system : `${target.system} ${detail}`;
};

const plural = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

function summarySection(input: ReportInput, events: readonly Event[]): string {
  const { run } = input;
  const first = events[0];
  const last = events.at(-1);
  const observed = events.filter((event) => event.provenance === 'observed').length;
  const lines = [
    `- run: \`${run.id}\` (tenant \`${run.tenantId}\`)`,
    `- agent: ${run.agentName ?? 'unknown'} · principal: ${run.principalId ?? 'unknown'}`,
    `- period: ${first?.ts ?? 'n/a'} → ${last?.ts ?? 'n/a'}`,
    `- events: ${String(events.length)} recorded, ${String(observed)} observed by world hooks, ${String(events.length - observed)} reported`,
    `- checkpoints: ${plural(input.checkpoints.length, 'signed checkpoint')} (tree sizes ${input.checkpoints.map((checkpoint) => String(checkpoint.treeSize)).join(', ') || 'none'})`,
    `- policy evaluated: \`${input.policyId}\` · ${plural(input.divergence.points.length, 'divergence point')}`,
    `- content: ${input.includeContent ? 'sealed content included' : 'summaries only'}`,
    `- generated: ${input.generatedAt}`,
  ];
  return lines.join('\n');
}

function narrativeSection(narrative: readonly NarrativeSentence[] | undefined): string {
  if (narrative === undefined || narrative.length === 0) {
    return 'No narrative was requested for this bundle. The timeline below is the record.';
  }
  return narrative
    .map((sentence) => `${sentence.text} [${sentence.eventIds.join(', ')}]`)
    .join('\n\n');
}

function timelineSection(events: readonly Event[]): string {
  if (events.length === 0) return 'No events were recorded for this run.';
  return table(
    ['seq', 'time', 'kind', 'provenance', 'actor', 'target', 'summary'],
    events.map((event) => [
      event.seq,
      event.ts,
      event.kind,
      event.provenance,
      event.actor.name ?? event.actor.id,
      describeTarget(event.target),
      event.summary ?? '',
    ]),
  );
}

function divergenceSection(report: DivergenceReport, policyId: string): string {
  const head = `Evaluated ${plural(report.evaluated, 'actionable event')} against \`${policyId}\`.`;
  if (report.points.length === 0) {
    return `${head}\n\nNo divergence: the policy would have allowed every recorded action.`;
  }
  const freeze = report.freezeFrame;
  const rows = report.points.map((point) => [
    point.seq,
    point.kind,
    point.effect,
    point.ruleId ?? 'default',
    point.explanation,
    freeze?.eventId === point.eventId ? 'freeze frame' : '',
  ]);
  return `${head}\n\n${table(['seq', 'kind', 'effect', 'rule', 'explanation', ''], rows)}`;
}

function lineageSection(lineage: AuthorityLineage | undefined): string {
  if (lineage === undefined)
    return 'No action was traced: the run has no divergence to trace from.';
  const hops = lineage.hops.map((hop) => {
    const authority = hop.authority;
    const mismatches = (hop.scopeMismatch ?? []).map(
      (mismatch) => `${mismatch.severity}: ${mismatch.kind} (${mismatch.excess.join(', ')})`,
    );
    return [
      hop.type,
      hop.label,
      authority === undefined ? '' : authority.scope.join(', '),
      authority === undefined ? '' : authority.permissions.join(', '),
      mismatches.join('; ') || 'none',
    ];
  });
  const action = `Action: **${lineage.action.label}** on ${describeTarget(lineage.action.target)}${lineage.action.descriptor === undefined ? '' : ` (\`${lineage.action.descriptor}\`)`}.`;
  const status = `Lineage ${lineage.complete ? 'complete' : 'incomplete'} · authority ${lineage.authorityObserved ? 'observed' : 'reported'} · ${plural(lineage.mismatches, 'scope mismatch')}${lineage.mismatches === 1 ? '' : 'es'}`;
  return `${action}\n\n${status}\n\n${table(['hop', 'label', 'scope', 'permissions', 'mismatches'], hops)}`;
}

function blastSection(blast: BlastRadius | undefined): string {
  if (blast === undefined)
    return 'No blast radius was computed: the run has no divergence to ripple from.';
  if (blast.waves.length === 0) {
    return `Nothing downstream of \`${blast.origin}\` at ${blast.minConfidence} confidence or better.`;
  }
  const rows = blast.waves.flatMap((wave) =>
    wave.resources.map((resource) => [
      wave.hop,
      resource.system,
      resource.resource,
      `${resource.via.type} (${resource.via.confidence})`,
      resource.recoverable ? 'yes' : 'no',
      resource.reasons.join(', '),
    ]),
  );
  const verdict = `From \`${blast.origin}\`: ${plural(rows.length, 'resource')} in ${plural(blast.waves.length, 'wave')} · ${blast.recoverable ? 'recoverable' : 'not recoverable'}.`;
  return `${verdict}\n\n${table(['wave', 'system', 'resource', 'via', 'recoverable', 'reasons'], rows)}`;
}

function regulationSection(map: RegulationMap): string {
  const blocks = map.frameworks.map((framework) => {
    const rows = framework.elements.map((element) => [
      element.id,
      element.requirement,
      element.support,
      element.sections.join(', ') || '—',
      element.note,
    ]);
    return `### ${framework.title}\n\n${framework.reference}\n\n${table(['element', 'requirement', 'support', 'bundle sections', 'note'], rows)}`;
  });
  return `${map.disclaimer}\n\n${blocks.join('\n\n')}`;
}

const glossarySection = (): string =>
  GLOSSARY.map(([term, meaning]) => `- **${term}** — ${meaning}`).join('\n');

// ARCHITECTURE §12 report.md: timeline, divergence points, lineage, blast radius, regulation map, glossary; every section says something.
export function renderReport(input: ReportInput): Report {
  const events = [...input.events].sort((a, b) => a.seq - b.seq);
  const map = regulationMap(mapInput(input, events));
  const sections: [string, string][] = [
    ['Summary', summarySection(input, events)],
    ['Narrative', narrativeSection(input.narrative)],
    ['Timeline', timelineSection(events)],
    ['Divergence', divergenceSection(input.divergence, input.policyId)],
    ['Authority lineage', lineageSection(input.lineage)],
    ['Blast radius', blastSection(input.blast)],
    ['Regulation map', regulationSection(map)],
    ['Glossary', glossarySection()],
  ];
  const markdown = [
    `# Debrief · run ${input.run.id}`,
    '',
    'Tamper-evident record of an AI agent run and its reconstruction. Every claim below rests on the events in `events.jsonl`, which verify against the signed checkpoints in this bundle.',
    '',
    ...sections.flatMap(([title, body]) => [`## ${title}`, '', body, '']),
  ].join('\n');
  return { markdown, regulationMap: map };
}

function mapInput(input: ReportInput, events: readonly Event[]): RegulationMapInput {
  return {
    hasDivergence: input.divergence.points.length > 0,
    hasLineage: input.lineage !== undefined && input.lineage.hops.length > 0,
    hasBlast: input.blast !== undefined && input.blast.waves.length > 0,
    includeContent: input.includeContent,
    observedEvents: events.filter((event) => event.provenance === 'observed').length,
  };
}

// The AC's reading of "no empty section": every level-two heading is followed by text before the next one.
export function emptySections(markdown: string): string[] {
  const empty: string[] = [];
  const parts = markdown.split(/^## /m).slice(1);
  for (const part of parts) {
    const [title = '', ...rest] = part.split('\n');
    if (rest.join('\n').trim() === '') empty.push(title.trim());
  }
  return empty;
}
