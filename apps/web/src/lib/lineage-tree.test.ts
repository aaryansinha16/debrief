import { describe, expect, it } from 'vitest';

import lineageGolden from '../../../../packages/reconstruct/__golden__/nine-seconds.lineage.json' with { type: 'json' };
import type { Lineage } from './api';
import {
  GAP_X,
  GAP_Y,
  MARGIN,
  describeMismatch,
  initialFocus,
  lineageNodes,
  lineageTree,
  must,
  nextFocus,
  severityOf,
} from './lineage-tree';

const lineage = lineageGolden as Lineage;

describe('lineageTree', () => {
  it('chains the demo hops into a left-to-right tree ending at the action', () => {
    const layout = lineageTree(lineage);
    expect(layout.nodes.map((node) => node.id)).toEqual([
      'principal:aaryan',
      'agent:coding-agent',
      'grant:tok-acct-9c1d',
      lineage.action.nodeId,
    ]);
    expect(layout.nodes.map((node) => node.kind)).toEqual(['hop', 'hop', 'hop', 'action']);
    expect(layout.nodes.map((node) => node.x)).toEqual(
      [0, 1, 2, 3].map((d) => MARGIN.x + d * GAP_X),
    );
    expect(layout.nodes.every((node) => node.y === MARGIN.y)).toBe(true);
    expect(layout.nodes.map((node) => node.index)).toEqual([0, 1, 2, 3]);
    expect(layout.links.map((link) => `${link.from.id}→${link.to.id}`)).toEqual([
      'principal:aaryan→agent:coding-agent',
      'agent:coding-agent→grant:tok-acct-9c1d',
      `grant:tok-acct-9c1d→${lineage.action.nodeId}`,
    ]);
    expect(layout.width).toBe(MARGIN.x * 2 + 3 * GAP_X);
    expect(layout.height).toBe(MARGIN.y * 2);
    expect(layout.nodes.map((node) => node.severity)).toEqual([
      undefined,
      'minor',
      'major',
      undefined,
    ]);
    expect(layout.nodes[3]?.action?.descriptor).toBe('production:volumes:deleteVolume');
    expect(layout.action).toBe(layout.nodes[3]);
    expect(layout.nodes[3]?.type).toBe('action');
  });

  it('lands the reader on the first major mismatch, else a minor one, else the action', () => {
    const layout = lineageTree(lineage);
    expect(initialFocus(layout)).toBe(2);
    const minorOnly: Lineage = {
      ...lineage,
      hops: lineage.hops.filter((hop) => hop.nodeId !== 'grant:tok-acct-9c1d'),
    };
    expect(initialFocus(lineageTree(minorOnly))).toBe(1);
    const clean: Lineage = { ...lineage, hops: [lineage.hops[0]!], mismatches: 0 };
    expect(initialFocus(lineageTree(clean))).toBe(1);
    const bare: Lineage = { ...lineage, hops: [], mismatches: 0 };
    const single = lineageTree(bare);
    expect(single.nodes).toHaveLength(1);
    expect(single.links).toEqual([]);
    expect(initialFocus(single)).toBe(0);
    expect(lineageNodes(bare).children).toEqual([]);
  });

  it('spreads siblings on the cross axis when a hop has more than one child', async () => {
    const root = lineageNodes(lineage);
    root.children.push({ ...root.children[0]!, id: 'twin', children: [] });
    const { hierarchy, tree } = await import('d3-hierarchy');
    const laid = tree<typeof root>().nodeSize([GAP_Y, GAP_X])(hierarchy(root));
    const [first, twin] = laid.children!;
    expect(Math.abs(first!.x - twin!.x)).toBe(GAP_Y);
  });

  it('rates hops by their worst mismatch and describes each kind', () => {
    expect(severityOf(lineage.hops[0]!)).toBeUndefined();
    expect(severityOf(lineage.hops[1]!)).toBe('minor');
    expect(severityOf(lineage.hops[2]!)).toBe('major');
    const [exceed, outside] = lineage.hops[2]!.scopeMismatch!;
    expect(describeMismatch(exceed!)).toBe('permissions exceed scope: +account:*');
    expect(describeMismatch(outside!)).toBe(
      'target outside scope: production:volumes:deleteVolume',
    );
    expect(describeMismatch({ ...outside!, target: undefined })).toBe(
      'target outside scope: production:volumes:deleteVolume',
    );
  });

  it('refuses a layout without its action', () => {
    expect(must(1, 'one')).toBe(1);
    expect(() => {
      must(undefined, 'action');
    }).toThrow('missing its action');
  });

  it('walks the chain with the arrow keys and jumps with Home and End', () => {
    expect(nextFocus('ArrowRight', 0, 4)).toBe(1);
    expect(nextFocus('ArrowDown', 3, 4)).toBe(3);
    expect(nextFocus('ArrowLeft', 2, 4)).toBe(1);
    expect(nextFocus('ArrowUp', 0, 4)).toBe(0);
    expect(nextFocus('Home', 3, 4)).toBe(0);
    expect(nextFocus('End', 0, 4)).toBe(3);
    expect(nextFocus('Enter', 1, 4)).toBeUndefined();
    expect(nextFocus('ArrowRight', 0, 0)).toBeUndefined();
  });
});
