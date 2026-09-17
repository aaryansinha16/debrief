// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import lineageGolden from '../../../../packages/reconstruct/__golden__/nine-seconds.lineage.json' with { type: 'json' };
import type { Lineage } from '../lib/api';
import { LineageScene } from './lineage-scene';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const lineage = lineageGolden as Lineage;

const update = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
    await Promise.resolve();
  });
};

describe('LineageScene', () => {
  let root: Root;
  let container: HTMLDivElement;
  const nodes = (): SVGGElement[] => [
    ...container.querySelectorAll<SVGGElement>('[data-testid="lineage-node"]'),
  ];
  const selected = (): string | null | undefined =>
    container.querySelector('[aria-selected="true"]')?.getAttribute('data-node');
  const details = (): string | null | undefined =>
    container.querySelector('[data-testid="lineage-details"]')?.getAttribute('data-node');
  const press = async (key: string): Promise<void> => {
    await update(() => {
      const target = container.querySelector<SVGGElement>('[aria-selected="true"]')!;
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
  };

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await update(() => {
      root.render(<LineageScene lineage={lineage} runId="run-9" />);
    });
  });

  afterEach(async () => {
    await update(() => {
      root.unmount();
    });
    container.remove();
  });

  it('shows the demo mismatch without any interaction', () => {
    expect(selected()).toBe('grant:tok-acct-9c1d');
    expect(details()).toBe('grant:tok-acct-9c1d');
    const grant = container.querySelector('[data-node="grant:tok-acct-9c1d"]')!;
    expect(grant.getAttribute('data-severity')).toBe('major');
    expect(grant.getAttribute('aria-label')).toBe(
      'grant legacy migration token, major scope mismatch',
    );
    expect(grant.querySelector('[data-testid="mismatch-halo"]')).not.toBeNull();
    expect(
      [...grant.querySelectorAll('[data-testid="mismatch-label"] tspan')].map(
        (span) => span.textContent,
      ),
    ).toEqual(['major mismatch', '+account:*', '+production:volumes:delete…']);
    expect(grant.querySelector('[data-testid="permissions-ring"]')?.getAttribute('stroke')).toBe(
      '#ff7a3d',
    );
    expect(grant.querySelector('[data-testid="scope-ring"]')).not.toBeNull();
    const agent = container.querySelector('[data-node="agent:coding-agent"]')!;
    expect(agent.getAttribute('data-severity')).toBe('minor');
    expect(
      agent.querySelector('[data-testid="permissions-ring"]')?.getAttribute('stroke-dasharray'),
    ).toBe('4 3');
    expect(
      container.querySelector('[data-node="principal:aaryan"] [data-testid="scope-ring"]'),
    ).toBeNull();
    expect(container.querySelector('[data-testid="lineage-summary"]')?.textContent).toBe(
      '3 mismatches · lineage complete · ● authority observed',
    );
    expect(container.querySelectorAll('[data-testid="lineage-link"]')).toHaveLength(3);
    expect(container.querySelector('[data-testid="focus-ring"]')).not.toBeNull();
    const permissions = [...container.querySelectorAll('[data-testid="hop-permissions"] li')].map(
      (item) => `${item.textContent}:${item.getAttribute('data-excess') ?? ''}`,
    );
    expect(permissions).toEqual(['account:*:yes']);
    expect(container.querySelector('[data-testid="hop-scope"]')?.textContent).toBe(
      'staging:credentials',
    );
    expect(
      [...container.querySelectorAll('[data-testid="hop-mismatches"] li')].map(
        (item) => item.textContent,
      ),
    ).toEqual([
      'major · permissions exceed scope: +account:*',
      'major · target outside scope: production:volumes:deleteVolume',
    ]);
    expect(container.querySelector('[data-testid="open-grant"]')?.getAttribute('href')).toBe(
      '/runs/run-9?event=01M2QF4GQ20P3FZVFVBRWCNNP7',
    );
    expect(container.querySelector('[data-testid="verify-grant"]')?.getAttribute('href')).toBe(
      '/api/proof?event=01M2QF4GQ20P3FZVFVBRWCNNP7',
    );
  });

  it('walks the chain with the keyboard, moving focus and the details with it', async () => {
    expect(nodes().map((node) => node.getAttribute('tabindex'))).toEqual(['-1', '-1', '0', '-1']);
    await press('ArrowRight');
    expect(selected()).toBe(lineage.action.nodeId);
    expect(details()).toBe(lineage.action.nodeId);
    expect(document.activeElement?.getAttribute('data-node')).toBe(lineage.action.nodeId);
    expect(container.querySelector('[data-testid="lineage-details"]')?.textContent).toContain(
      'production:volumes:deleteVolume',
    );
    expect(container.querySelector('[data-testid="hop-authority"]')).toBeNull();
    await press('ArrowRight');
    expect(selected()).toBe(lineage.action.nodeId);
    await press('Home');
    expect(selected()).toBe('principal:aaryan');
    expect(document.activeElement?.getAttribute('data-node')).toBe('principal:aaryan');
    expect(container.querySelector('[data-testid="lineage-details"]')?.textContent).toContain(
      'Aaryan',
    );
    await press('ArrowLeft');
    expect(selected()).toBe('principal:aaryan');
    await press('ArrowDown');
    expect(selected()).toBe('agent:coding-agent');
    expect(container.querySelector('[data-testid="hop-permissions"]')?.textContent).toContain(
      'staging:files:read',
    );
    await press('End');
    expect(selected()).toBe(lineage.action.nodeId);
    await press('Enter');
    expect(selected()).toBe(lineage.action.nodeId);
    expect(nodes().map((node) => node.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '0']);
  });

  it('selects a hop on click or focus without stealing focus', async () => {
    await update(() => {
      container
        .querySelector<SVGGElement>('[data-node="agent:coding-agent"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(selected()).toBe('agent:coding-agent');
    expect(document.activeElement?.getAttribute('data-node')).not.toBe('agent:coding-agent');
    await update(() => {
      container.querySelector<SVGGElement>('[data-node="principal:aaryan"]')!.focus();
    });
    expect(selected()).toBe('principal:aaryan');
  });

  it('says when a hop keeps its permissions within scope', async () => {
    const within: Lineage = {
      ...lineage,
      hops: [{ ...lineage.hops[1]!, scopeMismatch: undefined }],
      mismatches: 0,
    };
    await update(() => {
      root.render(<LineageScene lineage={within} runId="run-9" />);
    });
    expect(selected()).toBe(lineage.action.nodeId);
    await press('Home');
    expect(details()).toBe('agent:coding-agent');
    expect(container.querySelector('[data-testid="hop-authority"]')?.textContent).toContain(
      'permissions within scope',
    );
    expect(container.querySelector('[data-testid="hop-mismatches"]')).toBeNull();
  });

  it('falls back from the token to the grant id to the grant node', async () => {
    const authority = lineage.hops[2]!.authority!;
    const byGrantId: Lineage = {
      ...lineage,
      hops: [
        {
          ...lineage.hops[2]!,
          authority: { ...authority, principalId: undefined, tokenRef: undefined },
        },
      ],
    };
    await update(() => {
      root.render(<LineageScene lineage={byGrantId} runId="run-9" />);
    });
    expect(details()).toBe('grant:tok-acct-9c1d');
    expect(container.querySelector('[data-testid="hop-authority"]')?.textContent).toContain(
      'principal—',
    );
    expect(container.querySelector('[data-testid="hop-authority"]')?.textContent).toContain(
      'tokentok-acct-9c1d',
    );
    const byNode: Lineage = {
      ...lineage,
      hops: [
        {
          ...lineage.hops[2]!,
          authority: { ...authority, tokenRef: undefined, grantId: undefined },
        },
      ],
    };
    await update(() => {
      root.render(<LineageScene lineage={byNode} runId="run-9" />);
    });
    expect(container.querySelector('[data-testid="hop-authority"]')?.textContent).toContain(
      'tokengrant:tok-acct-9c1d',
    );
  });
});

describe('LineageScene without mismatches', () => {
  it('lands on the action, says the permissions are within scope and reads the plurals', () => {
    const clean: Lineage = {
      ...lineage,
      hops: [
        lineage.hops[0]!,
        {
          ...lineage.hops[1]!,
          scopeMismatch: [],
          authority: {
            ...lineage.hops[1]!.authority!,
            principalId: undefined,
            tokenRef: undefined,
            grantId: undefined,
          },
        },
      ],
      action: { nodeId: 'tool:x', label: 'listVolumes' },
      mismatches: 1,
      complete: false,
      authorityObserved: false,
    };
    const html = renderToStaticMarkup(<LineageScene lineage={clean} runId="r" />);
    expect(html).toContain(
      '1 mismatch · lineage incomplete · <span class="text-cyan">○ authority reported',
    );
    expect(html).toContain('data-testid="lineage-details" data-node="tool:x"');
    expect(html).not.toContain('mismatch-halo');
    const agentOnly = renderToStaticMarkup(
      <LineageScene lineage={{ ...clean, hops: [clean.hops[1]!], mismatches: 0 }} runId="r" />,
    );
    expect(agentOnly).toContain('0 mismatches');
    const subagent: Lineage = {
      ...clean,
      hops: [{ ...clean.hops[1]!, type: 'subagent', nodeId: 'subagent:s' }],
      action: {
        nodeId: 'tool:y',
        label: 'read',
        target: { system: 'vault', resource: 'r', environment: 'staging', risk: 'low' },
      },
    };
    const markup = renderToStaticMarkup(<LineageScene lineage={subagent} runId="r" />);
    expect(markup).toContain('#4fd6ff');
    expect(markup).toContain('>staging<');
    expect(markup).toContain('>low<');
    const bareTarget = renderToStaticMarkup(
      <LineageScene
        lineage={{
          ...subagent,
          action: { nodeId: 'tool:z', label: 'ping', target: { system: 'relay' } },
        }}
        runId="r"
      />,
    );
    expect(bareTarget).toContain('>relay<');
    expect(bareTarget).not.toContain('>resource<');
    expect(bareTarget).not.toContain('>environment<');
    expect(bareTarget).not.toContain('>risk<');
  });
});
