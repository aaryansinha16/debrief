'use client';

import { useCallback } from 'react';

import type { Counterfactual } from '../lib/api';
import { BranchScene, type BranchSceneProps } from './branch-scene';

export type BranchViewProps = Omit<BranchSceneProps, 'branch'>;

// ARCHITECTURE §11: the editor posts to counterfactual through the same-origin proxy; the response is the branch.
export async function postBranch(runId: string, yaml: string): Promise<Counterfactual> {
  const response = await fetch(`/api/counterfactual?run=${encodeURIComponent(runId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ policy: yaml }),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String(body.message)
        : `${String(response.status)} from the api`;
    throw new Error(message);
  }
  return body as Counterfactual;
}

export function BranchView(props: BranchViewProps) {
  const branch = useCallback((yaml: string) => postBranch(props.runId, yaml), [props.runId]);
  return <BranchScene {...props} branch={branch} />;
}
