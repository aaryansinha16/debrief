import { PROD_GUARD_YAML, parsePolicy } from '@debrief/policy';
import { blastRadius, divergence, reconstructGraph } from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BlastRadius } from '../lib/api';
import { AffectedList } from './affected-list';

describe('AffectedList', () => {
  const events = demoRunFixture();
  const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
  const origin = divergence(events, parsePolicy(PROD_GUARD_YAML), graph).freezeFrame!.nodeId!;
  const blast = blastRadius(graph, origin, events);
  const total = blast.waves.reduce((count, wave) => count + wave.resources.length, 0);

  it('groups the blast by system with a recoverable flag and the wave per resource', () => {
    const html = renderToStaticMarkup(<AffectedList blast={blast} graph={graph} />);
    expect(html).toContain('data-recoverable="no"');
    expect(html).toContain('data-system="orbital"');
    expect(html).toContain('✗ unrecoverable');
    expect(html).toContain('backups deleted');
    expect(html).toContain('wave 1 · via mutates (exact)');
    expect(html).toContain('wave 2 · via mutates (exact)');
    expect(html).toContain(`reaches ${String(total)} resources across 1 system ·`);
    expect(html).toContain('not recoverable');
    expect(html).not.toContain('data-lit="no"');
    expect(html).not.toContain('data-testid="affected-empty"');
  });

  it('lights each resource only once the front has reached its wave', () => {
    const html = renderToStaticMarkup(<AffectedList blast={blast} graph={graph} progress={1} />);
    expect(html).toContain('data-hop="1" data-recoverable="no" data-lit="yes"');
    expect(html).toContain('data-hop="2" data-recoverable="no" data-lit="no"');
  });

  it('names recoverable resources, falls back to raw ids and says when nothing is downstream', () => {
    const recoverable: BlastRadius = {
      origin: 'tool:orbital.rotateCredential',
      minConfidence: 'strong',
      waves: [
        {
          hop: 1,
          resources: [
            {
              nodeId: 'resource:orbital:ghost',
              system: 'orbital',
              resource: 'ghost',
              via: {
                from: 'tool:orbital.rotateCredential',
                to: 'resource:orbital:ghost',
                type: 'observes',
                confidence: 'strong',
                eventIds: [],
              },
              recoverable: true,
              reasons: ['read-only', 'backup-exists', 'reversible-operation'],
            },
          ],
        },
      ],
      groups: {
        vault: ['resource:vault:key'],
        orbital: ['resource:orbital:ghost', 'resource:orbital:missing'],
      },
      recoverable: true,
    };
    recoverable.waves[0]!.resources.push({
      nodeId: 'resource:vault:key',
      system: 'vault',
      resource: 'key',
      via: {
        from: 'tool:orbital.rotateCredential',
        to: 'resource:vault:key',
        type: 'observes',
        confidence: 'strong',
        eventIds: [],
      },
      recoverable: true,
      reasons: ['read-only'],
    });
    const html = renderToStaticMarkup(<AffectedList blast={recoverable} graph={graph} />);
    expect(html).toContain('✓ recoverable');
    expect(html).toContain('read only, a backup exists, reversible operation');
    expect(html).toContain('>ghost<');
    expect(html).toContain('reaches 2 resources across 2 systems');
    expect(html.match(/data-testid="affected-resource"/g)).toHaveLength(2);
    expect(html.indexOf('data-system="orbital"')).toBeLessThan(html.indexOf('data-system="vault"'));
    const empty = renderToStaticMarkup(
      <AffectedList
        blast={{ ...recoverable, origin: 'tool:x', waves: [], groups: {} }}
        graph={graph}
      />,
    );
    expect(empty).toContain('data-testid="affected-empty"');
    expect(empty).toContain('tool:x');
    expect(empty).toContain('0 resources across 0 systems');
  });
});
