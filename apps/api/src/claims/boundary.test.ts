import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));

// D-077: the model's work stays off the ingest, reconstruction and verdict paths, so they never import it.
const GUARDED = [
  'apps/api/src/ingest',
  'apps/api/src/otlp',
  'apps/api/src/events',
  'apps/api/src/capture',
  'apps/api/src/reconstruction',
  'apps/api/src/runs',
  'apps/api/src/evidence',
  'packages/verdict/src',
  'packages/reconstruct/src',
  'packages/chain/src',
  'packages/schema/src',
];
const PACKAGES = ['packages/verdict', 'packages/reconstruct', 'packages/chain', 'packages/schema'];

// Any module specifier naming the claims code: static, bare, re-exported or dynamic, either quote.
const CLAIMS =
  /['"](?:@debrief\/claims(?:\/[^'"]*)?|(?:\.\.?\/)+(?:[^'"]*\/)?claims(?:\/[^'"]*)?)['"]/;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });

describe('the claims boundary', () => {
  it('recognises every way of naming the claims code', () => {
    for (const line of [
      "import { x } from '@debrief/claims';",
      "import '@debrief/claims';",
      'export * from "@debrief/claims/fixtures";',
      "const m = await import('../claims/claims.service.js');",
      "import { y } from '../../claims';",
    ]) {
      expect(CLAIMS.test(line), line).toBe(true);
    }
    expect(CLAIMS.test("import { z } from './claimsless.js';")).toBe(false);
  });

  it('keeps ingest, events, reconstruction and verdict code free of claims imports', () => {
    const files = GUARDED.map((dir) => join(repo, dir))
      .filter((dir) => existsSync(dir))
      .flatMap(sources);
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((file) => CLAIMS.test(readFileSync(file, 'utf8')))).toEqual([]);
    const manifests = PACKAGES.map((dir) => join(repo, dir, 'package.json')).filter(existsSync);
    expect(
      manifests.filter((file) => readFileSync(file, 'utf8').includes('@debrief/claims')),
    ).toEqual([]);
  });
});
