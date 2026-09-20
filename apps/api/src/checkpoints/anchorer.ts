import { type Anchorer, NO_ANCHOR, rfc3161Anchorer } from '@debrief/chain';
import { randomBytes } from 'node:crypto';

import type { Config } from '../config/config.js';

export const ANCHORER = Symbol('ANCHORER');

// ARCHITECTURE §7.6: the anchor kind is configuration; the RFC 3161 transport is one POST of application/timestamp-query.
export function anchorerFor(config: Pick<Config, 'ANCHOR_KIND' | 'ANCHOR_TSA_URL'>): Anchorer {
  if (config.ANCHOR_KIND === 'none') return NO_ANCHOR;
  const url = config.ANCHOR_TSA_URL;
  if (url === undefined) throw new Error('ANCHOR_TSA_URL is required when ANCHOR_KIND is rfc3161');
  return rfc3161Anchorer(
    async (request) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/timestamp-query' },
        body: new Blob([request]),
      });
      if (!response.ok) throw new Error(`${String(response.status)} from the timestamp authority`);
      return new Uint8Array(await response.arrayBuffer());
    },
    () => randomBytes(8),
  );
}
