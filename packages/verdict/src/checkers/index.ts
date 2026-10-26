import type { Checker } from '../types.js';
import { ciPassed } from './ci-passed.js';
import { commitPushed, prOpened } from './github.js';
import { codeRemoved, filesChanged } from './git.js';
import { dbScope, deployReady, migrationApplied, secretRotated } from './systems.js';
import { testsPassed } from './tests-passed.js';

// One versioned checker per catalogue predicate (ARCHITECTURE §18.4); bump the version when a checker's verdicts change.
export const CHECKERS: Readonly<Record<string, { version: number; check: Checker }>> = {
  'tests.passed': { version: 1, check: testsPassed },
  'ci.passed': { version: 1, check: ciPassed },
  'db.scope': { version: 1, check: dbScope },
  'migration.applied': { version: 1, check: migrationApplied },
  'pr.opened': { version: 1, check: prOpened },
  'commit.pushed': { version: 1, check: commitPushed },
  'deploy.ready': { version: 1, check: deployReady },
  'files.changed': { version: 1, check: filesChanged },
  'code.removed': { version: 1, check: codeRemoved },
  'secret.rotated': { version: 1, check: secretRotated },
};

export const UNCHECKED = 'unchecked@1';

export function checkerName(predicate: string): string {
  const entry = Object.hasOwn(CHECKERS, predicate) ? CHECKERS[predicate] : undefined;
  return entry === undefined ? UNCHECKED : `${predicate}@${String(entry.version)}`;
}
