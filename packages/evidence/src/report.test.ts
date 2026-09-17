import { PROD_GUARD_YAML, parsePolicy } from '@debrief/policy';
import { authorityLineage, blastRadius, divergence, reconstructGraph } from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { describe, expect, it } from 'vitest';

import { demoBundle } from './__fixtures__/demo-bundle.js';
import { DISCLAIMER, regulationMap } from './regulation-map.js';
import { GLOSSARY, type ReportInput, emptySections, renderReport } from './report.js';

const events = demoRunFixture();
const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
const report = divergence(events, parsePolicy(PROD_GUARD_YAML), graph);
const origin = report.freezeFrame!.nodeId!;
const demo = demoBundle();
const input: ReportInput = {
  run: {
    id: DEMO_RUN_ID,
    tenantId: 'tenant-demo',
    agentName: 'coding-agent',
    principalId: 'human:aaryan',
  },
  events: events.filter((event) => event.runId === DEMO_RUN_ID),
  checkpoints: demo.checkpoints,
  policyId: 'prod-guard',
  divergence: report,
  lineage: authorityLineage(graph, origin, events),
  blast: blastRadius(graph, origin, events),
  includeContent: false,
  generatedAt: '2026-09-18T09:00:00.000Z',
};

describe('renderReport', () => {
  const rendered = renderReport(input);
  const { markdown } = rendered;

  it('renders every §12 section for the demo run with none of them empty', () => {
    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([
      'Summary',
      'Narrative',
      'Timeline',
      'Divergence',
      'Authority lineage',
      'Blast radius',
      'Regulation map',
      'Glossary',
    ]);
    expect(emptySections(markdown)).toEqual([]);
    expect(markdown.startsWith(`# Debrief · run ${DEMO_RUN_ID}`)).toBe(true);
    expect(markdown).toContain('47 recorded, 2 observed by world hooks, 45 reported');
    expect(markdown).toContain('tree sizes 30, 49');
    expect(markdown).toContain('1 divergence point');
    expect(markdown).toContain(
      '| 45 | tool.call | require_approval | prod-destructive-needs-approval |',
    );
    expect(markdown).toContain('freeze frame |');
    expect(markdown).toContain('Lineage complete · authority observed · 3 scope mismatches');
    expect(markdown).toContain(
      'Action: **deleteVolume** on orbital production:volumes:deleteVolume',
    );
    expect(markdown).toContain(
      '| grant | legacy migration token | staging:credentials | account:* | major: permissions-exceed-scope (account:*); major: target-outside-scope (production:volumes:deleteVolume) |',
    );
    expect(markdown).toContain('2 resources in 2 waves · not recoverable');
    expect(markdown).toContain(
      '| 2 | orbital | projects/nova/volumes/vol-prod-01/backups | mutates (exact) | no |',
    );
    expect(markdown).toContain('No narrative was requested');
    expect(markdown).toContain('### EU AI Act, Article 12');
    expect(markdown).toContain('### SOC 2 — CC7.2 and CC7.3');
    for (const [term] of GLOSSARY) expect(markdown).toContain(`- **${term}** —`);
    expect(markdown).not.toMatch(/tamper-proof/i);
    expect(markdown).not.toMatch(/certif/i);
    expect(markdown.split('\n').filter((line) => line.startsWith('| ')).length).toBeGreaterThan(60);
  });

  it('escapes pipes and newlines in cells and orders the timeline by seq', () => {
    const bare = { ...input.events[2]! };
    delete bare.summary;
    const odd = renderReport({
      ...input,
      events: [
        { ...input.events[1]!, summary: 'a | b\nc' },
        { ...bare, actor: { type: 'system', id: 'cron' }, target: { system: 'relay' } },
        input.events[0]!,
      ],
    });
    expect(odd.markdown).toContain('a \\| b c');
    expect(odd.markdown).toContain('| cron | relay |  |');
    const rows = odd.markdown.split('\n').filter((line) => /^\| \d+ \| 2026/.test(line));
    expect(rows[0]?.startsWith(`| ${String(input.events[0]!.seq)} |`)).toBe(true);
  });

  it('says something in every section of a run with nothing to report', () => {
    const quiet = renderReport({
      ...input,
      run: { id: 'r', tenantId: 't' },
      events: [],
      checkpoints: [],
      divergence: { runId: 'r', evaluated: 0, points: [] },
      lineage: undefined,
      blast: undefined,
      narrative: [],
    });
    expect(emptySections(quiet.markdown)).toEqual([]);
    expect(quiet.markdown).toContain('No events were recorded');
    expect(quiet.markdown).toContain(
      'No divergence: the policy would have allowed every recorded action.',
    );
    expect(quiet.markdown).toContain('No action was traced');
    expect(quiet.markdown).toContain('No blast radius was computed');
    expect(quiet.markdown).toContain('agent: unknown · principal: unknown');
    expect(quiet.markdown).toContain('period: n/a → n/a');
    expect(quiet.markdown).toContain('0 signed checkpoints (tree sizes none)');
    expect(quiet.regulationMap.frameworks[0]?.elements[2]).toMatchObject({
      support: 'partially-supports',
      sections: ['events.jsonl'],
    });
  });

  it('includes the narrative with its citations, sealed content and an empty blast when given', () => {
    const rich = renderReport({
      ...input,
      includeContent: true,
      narrative: [
        { text: 'The agent rotated a credential.', eventIds: ['e1', 'e2'] },
        { text: 'Then it deleted the volume.', eventIds: ['e3'] },
      ],
      blast: { ...input.blast!, waves: [] },
      lineage: {
        ...input.lineage!,
        action: { nodeId: 'tool:x', label: 'listVolumes' },
        complete: false,
        authorityObserved: false,
        mismatches: 1,
      },
      divergence: {
        ...report,
        points: [{ ...report.points[0]!, ruleId: undefined }],
        freezeFrame: undefined,
      },
    });
    expect(rich.markdown).toContain('The agent rotated a credential. [e1, e2]');
    expect(rich.markdown).toContain('sealed content included');
    expect(rich.markdown).toContain('Nothing downstream of');
    expect(rich.markdown).toContain('Action: **listVolumes** on .');
    const recoverable = renderReport({
      ...input,
      blast: {
        ...input.blast!,
        recoverable: true,
        waves: [
          {
            hop: 1,
            resources: [
              {
                ...input.blast!.waves[0]!.resources[0]!,
                recoverable: true,
                reasons: ['backup-exists'],
              },
            ],
          },
        ],
      },
    });
    expect(recoverable.markdown).toContain('1 resource in 1 wave · recoverable');
    expect(recoverable.markdown).toContain('| mutates (exact) | yes | backup-exists |');
    expect(rich.markdown).toContain('Lineage incomplete · authority reported · 1 scope mismatch');
    expect(rich.markdown).toContain('| default |');
    expect(rich.markdown).not.toContain('freeze frame |');
    expect(
      rich.regulationMap.frameworks[1]?.elements.find(
        (element) => element.id === 'content-retention',
      ),
    ).toMatchObject({ support: 'supports', sections: ['blobs/'] });
  });

  it('finds an empty section when one exists', () => {
    expect(emptySections('## A\n\ntext\n\n## B\n\n\n## C\nmore')).toEqual(['B']);
  });
});

describe('regulationMap', () => {
  it('lists the Article 12 elements, the record elements and CC7.2/CC7.3 with supports wording only', () => {
    const map = regulationMap({
      hasDivergence: true,
      hasLineage: true,
      hasBlast: true,
      includeContent: false,
      observedEvents: 2,
    });
    expect(map.wording).toBe('supports');
    expect(map.disclaimer).toBe(DISCLAIMER);
    expect(map.frameworks.map((framework) => framework.id)).toEqual([
      'eu-ai-act-art-12',
      'ai-agent-act-records',
      'soc2-cc7',
    ]);
    const [euAiAct, agentAct, soc2] = map.frameworks;
    expect(euAiAct!.elements.map((element) => element.id)).toEqual([
      'art-12-1-automatic-recording',
      'art-12-2-traceability',
      'art-12-2-a-risk-situations',
      'art-12-2-b-post-market-monitoring',
      'art-12-2-c-operation-monitoring',
      'art-12-3-period-of-use',
      'art-12-3-reference-database',
      'art-12-3-matching-input',
      'art-12-3-natural-persons',
    ]);
    expect(agentAct!.elements.length).toBeGreaterThanOrEqual(6);
    expect(soc2!.elements.map((element) => element.id)).toEqual([
      'cc7-2-anomaly-monitoring',
      'cc7-3-incident-evaluation',
    ]);
    const text = JSON.stringify(map);
    expect(text).not.toMatch(/certif/i);
    expect(text).not.toMatch(/compl(ies|iant)/i);
    for (const framework of map.frameworks) {
      for (const element of framework.elements) {
        expect(['supports', 'partially-supports', 'not-applicable']).toContain(element.support);
        if (element.support !== 'not-applicable')
          expect(element.sections.length).toBeGreaterThan(0);
      }
    }
    expect(soc2!.elements[1]?.sections).toEqual([
      'report.md § Divergence',
      'report.md § Blast radius',
      'report.md § Authority lineage',
    ]);
  });

  it('downgrades to partial support when the bundle lacks the evidence', () => {
    const map = regulationMap({
      hasDivergence: false,
      hasLineage: false,
      hasBlast: false,
      includeContent: true,
      observedEvents: 0,
    });
    const supports = map.frameworks
      .flatMap((framework) => framework.elements)
      .map((element) => element.support);
    expect(
      supports.filter((support) => support === 'partially-supports').length,
    ).toBeGreaterThanOrEqual(6);
    const cc73 = map.frameworks[2]!.elements[1]!;
    expect(cc73.support).toBe('partially-supports');
    expect(cc73.sections).toEqual([]);
    expect(map.frameworks[0]!.elements[4]).toMatchObject({
      support: 'partially-supports',
      sections: ['events.jsonl'],
    });
    expect(
      map.frameworks[1]!.elements.find((element) => element.id === 'content-retention')?.support,
    ).toBe('supports');
  });
});
