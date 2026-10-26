import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));

// D-077: the model's work stays off the ingest and verdict paths, so they never import it.
const GUARDED = [
  'apps/api/src/ingest',
  'apps/api/src/otlp',
  'apps/api/src/events',
  'apps/api/src/capture',
  'packages/verdict/src',
  'packages/reconstruct/src',
  'packages/chain/src',
  'packages/schema/src',
];

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });

describe('the claims boundary', () => {
  it('keeps ingest, events, reconstruction and verdict code free of claims imports', () => {
    const files = GUARDED.map((dir) => join(repo, dir))
      .filter((dir) => existsSync(dir))
      .flatMap(sources);
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((file) =>
      /from '(?:@debrief\/claims|[./]+claims\/[^']*)'/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
