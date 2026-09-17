export type Support = 'supports' | 'partially-supports' | 'not-applicable';

export interface RegulationElement {
  id: string;
  requirement: string;
  support: Support;
  sections: string[];
  note: string;
}

export interface RegulationFramework {
  id: string;
  title: string;
  reference: string;
  elements: RegulationElement[];
}

export interface RegulationMap {
  version: '1';
  wording: 'supports';
  disclaimer: string;
  frameworks: RegulationFramework[];
}

export interface RegulationMapInput {
  hasDivergence: boolean;
  hasLineage: boolean;
  hasBlast: boolean;
  includeContent: boolean;
  observedEvents: number;
}

export const DISCLAIMER =
  'This map states which sections of the bundle support each requirement element. It describes what the bundle contains and makes no claim beyond that; the element texts are paraphrased for review against the enacted wording.';

const EVENTS = 'events.jsonl';
const CHECKPOINTS = 'checkpoints.json';
const PROOFS = 'proofs.json';
const MANIFEST = 'manifest.json';
const TIMELINE = 'report.md § Timeline';
const DIVERGENCE = 'report.md § Divergence';
const LINEAGE = 'report.md § Authority lineage';
const BLAST = 'report.md § Blast radius';

// ARCHITECTURE §12: which bundle sections support which requirement element — "supports", never "certifies".
export function regulationMap(input: RegulationMapInput): RegulationMap {
  const ifPresent = (present: boolean, sections: string[]): [Support, string[]] =>
    present ? ['supports', sections] : ['partially-supports', [EVENTS]];
  const [divergenceSupport, divergenceSections] = ifPresent(input.hasDivergence, [
    DIVERGENCE,
    EVENTS,
  ]);
  const [lineageSupport, lineageSections] = ifPresent(input.hasLineage, [LINEAGE, EVENTS]);
  const [blastSupport, blastSections] = ifPresent(input.hasBlast, [BLAST, EVENTS]);
  return {
    version: '1',
    wording: 'supports',
    disclaimer: DISCLAIMER,
    frameworks: [
      {
        id: 'eu-ai-act-art-12',
        title: 'EU AI Act, Article 12 — record-keeping',
        reference: 'Regulation (EU) 2024/1689, Article 12',
        elements: [
          {
            id: 'art-12-1-automatic-recording',
            requirement:
              'The system technically allows the automatic recording of events (logs) over its lifetime.',
            support: 'supports',
            sections: [EVENTS, CHECKPOINTS, PROOFS],
            note: 'Every event is appended to a per-tenant hash chain and covered by a signed Merkle checkpoint; the bundle carries the run’s events with their inclusion proofs.',
          },
          {
            id: 'art-12-2-traceability',
            requirement:
              'Logging enables traceability of the system’s functioning appropriate to its intended purpose.',
            support: 'supports',
            sections: [TIMELINE, EVENTS, MANIFEST],
            note: 'The timeline orders every recorded event with its actor, target and provenance; the manifest fixes the time range.',
          },
          {
            id: 'art-12-2-a-risk-situations',
            requirement:
              'Identification of situations that may result in the system presenting a risk or in a substantial modification.',
            support: divergenceSupport,
            sections: divergenceSections,
            note: input.hasDivergence
              ? 'Policy divergence points name the events a policy would have stopped and the rule that matched.'
              : 'No divergence was found under the policy used for this bundle; the events remain available for other policies.',
          },
          {
            id: 'art-12-2-b-post-market-monitoring',
            requirement: 'Facilitation of post-market monitoring.',
            support: 'supports',
            sections: [TIMELINE, BLAST, EVENTS],
            note: 'The report and the raw events can be re-evaluated against any later policy without the original system.',
          },
          {
            id: 'art-12-2-c-operation-monitoring',
            requirement:
              'Monitoring of the operation of the system by the deployer (Article 26(5)).',
            support: input.observedEvents > 0 ? 'supports' : 'partially-supports',
            sections: input.observedEvents > 0 ? [TIMELINE, EVENTS] : [EVENTS],
            note:
              input.observedEvents > 0
                ? 'Observed world-hook events record what the systems the agent touched actually did, kept apart from what the agent reported.'
                : 'Only agent-reported events are present; no world hook observed this run.',
          },
          {
            id: 'art-12-3-period-of-use',
            requirement:
              'For systems referred to in Article 12(3): recording of the period of each use (start and end date and time).',
            support: 'supports',
            sections: [MANIFEST, TIMELINE],
            note: 'The manifest’s time range and the first and last events give the period of the run.',
          },
          {
            id: 'art-12-3-reference-database',
            requirement:
              'For systems referred to in Article 12(3): the reference database against which input data has been checked.',
            support: 'not-applicable',
            sections: [],
            note: 'The element addresses remote biometric identification; an agent run has no reference database of that kind.',
          },
          {
            id: 'art-12-3-matching-input',
            requirement:
              'For systems referred to in Article 12(3): the input data for which the search led to a match.',
            support: 'not-applicable',
            sections: [],
            note: 'The element addresses remote biometric identification.',
          },
          {
            id: 'art-12-3-natural-persons',
            requirement:
              'For systems referred to in Article 12(3): identification of the natural persons involved in the verification of results.',
            support: lineageSupport,
            sections: lineageSections,
            note: 'The authority lineage names the principal who authorised the agent and every grant on the way to the action.',
          },
        ],
      },
      {
        id: 'ai-agent-act-records',
        title: 'AI AGENT Act — record elements',
        reference: 'AI AGENT Act, record-keeping provisions (element list paraphrased for review)',
        elements: [
          {
            id: 'agent-identity',
            requirement:
              'A record identifying the agent that acted and the system it acted through.',
            support: 'supports',
            sections: [EVENTS, TIMELINE],
            note: 'Each event carries its actor (type, id, name) and its source (telemetry, proxy, world hook).',
          },
          {
            id: 'principal-and-authorisation',
            requirement:
              'A record of the person or entity on whose behalf the agent acted and of the authorisation it held.',
            support: lineageSupport,
            sections: lineageSections,
            note: 'Delegation grants record principal, token, scope and permissions; the lineage traces them to the action.',
          },
          {
            id: 'action-log',
            requirement:
              'A time-stamped record of each action the agent took, including the tools and external systems it used.',
            support: 'supports',
            sections: [EVENTS, TIMELINE],
            note: 'Tool calls, results and MCP requests are recorded in order with the target system, operation and risk.',
          },
          {
            id: 'delegated-authority-limits',
            requirement:
              'A record of the limits of the delegated authority and of any action taken outside them.',
            support: lineageSupport,
            sections: lineageSections,
            note: 'Scope-versus-permission mismatches and out-of-scope targets are flagged per hop of the lineage.',
          },
          {
            id: 'outcome-record',
            requirement:
              'A record of the effects of the agent’s actions on the systems it touched.',
            support: blastSupport,
            sections: blastSections,
            note: 'Observed world changes and the blast radius list every resource reached, with whether it is recoverable.',
          },
          {
            id: 'integrity-and-retention',
            requirement:
              'Records are retained in a form that makes later alteration detectable and can be produced to a third party.',
            support: 'supports',
            sections: [CHECKPOINTS, PROOFS, MANIFEST],
            note: 'The bundle verifies offline with the chain package alone: hashes, inclusion proofs, checkpoint and manifest signatures.',
          },
          {
            id: 'content-retention',
            requirement:
              'Retention of the content exchanged with the model where the record policy requires it.',
            support: input.includeContent ? 'supports' : 'partially-supports',
            sections: input.includeContent ? ['blobs/'] : [EVENTS],
            note: input.includeContent
              ? 'Sealed content documents are included and hash to their names.'
              : 'Summaries are included; sealed content was not exported under this bundle’s policy.',
          },
        ],
      },
      {
        id: 'soc2-cc7',
        title: 'SOC 2 — CC7.2 and CC7.3',
        reference: 'AICPA Trust Services Criteria, CC7.2, CC7.3',
        elements: [
          {
            id: 'cc7-2-anomaly-monitoring',
            requirement:
              'CC7.2: system components are monitored for anomalies indicative of malicious acts, natural disasters and errors affecting the entity’s objectives.',
            support: input.observedEvents > 0 ? 'supports' : 'partially-supports',
            sections:
              input.observedEvents > 0 ? [TIMELINE, DIVERGENCE, EVENTS] : [TIMELINE, EVENTS],
            note: 'Agent actions and observed world changes are recorded continuously and evaluated against policy; divergences are the anomalies found.',
          },
          {
            id: 'cc7-3-incident-evaluation',
            requirement:
              'CC7.3: security events are evaluated to determine whether they could or did result in a failure to meet objectives, and actions are taken to address such failures.',
            support: input.hasDivergence && input.hasBlast ? 'supports' : 'partially-supports',
            sections: [DIVERGENCE, BLAST, LINEAGE].filter(
              (section, index) => [input.hasDivergence, input.hasBlast, input.hasLineage][index],
            ),
            note: 'The freeze frame, blast radius and authority lineage are the evaluation of the incident this bundle records.',
          },
        ],
      },
    ],
  };
}
