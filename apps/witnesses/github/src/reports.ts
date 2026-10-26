import { unzipSync } from 'fflate';
import {
  countCheckOutput,
  countJunit,
  type GithubWireEvent,
  mapWorkflowRunTests,
  resolveTests,
  TestReportError,
  type TestReport,
  type WorkflowRun,
} from '@debrief/witness-github';

import type { GithubClient } from './github-api.js';

const MIB = 1024 * 1024;

export const REPORT_LIMITS = {
  artifacts: 10,
  zipBytes: 10 * MIB,
  files: 50,
  xmlBytes: 5 * MIB,
  xmlTotalBytes: 25 * MIB,
};

const JUNIT_ARTIFACT = /junit/i;

export interface RunTests {
  events: GithubWireEvent[];
  // A report exists, whether or not it could be trusted; false means look again later.
  found: boolean;
}

interface Budget {
  files: number;
  bytes: number;
  oversize: boolean;
}

function junitFiles(zip: Uint8Array, state: Budget): string[] {
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(zip, {
      filter(file) {
        if (!file.name.toLowerCase().endsWith('.xml')) return false;
        state.files += 1;
        state.bytes += file.originalSize;
        if (file.originalSize > REPORT_LIMITS.xmlBytes) state.oversize = true;
        return state.files <= REPORT_LIMITS.files && state.bytes <= REPORT_LIMITS.xmlTotalBytes;
      },
    });
  } catch {
    throw new TestReportError('artifact is not a readable zip');
  }
  const names = Object.keys(archive);
  if (
    state.oversize ||
    state.files > REPORT_LIMITS.files ||
    state.bytes > REPORT_LIMITS.xmlTotalBytes
  ) {
    throw new TestReportError(
      `JUnit files exceed the limits (${String(REPORT_LIMITS.files)} files, ${String(REPORT_LIMITS.xmlBytes)} bytes each)`,
    );
  }
  return names.map((name) => new TextDecoder().decode(archive[name]));
}

async function junitReports(
  client: GithubClient,
  repo: string,
  run: WorkflowRun,
): Promise<TestReport[]> {
  const listed = (await client.artifacts(repo, run.id)).filter(
    (artifact) => !artifact.expired && JUNIT_ARTIFACT.test(artifact.name),
  );
  if (listed.length > REPORT_LIMITS.artifacts) {
    throw new TestReportError(
      `${String(listed.length)} JUnit artifacts, limit is ${String(REPORT_LIMITS.artifacts)}`,
    );
  }
  const state: Budget = { files: 0, bytes: 0, oversize: false };
  const reports: TestReport[] = [];
  for (const artifact of listed) {
    if (artifact.size_in_bytes > REPORT_LIMITS.zipBytes) {
      throw new TestReportError(
        `artifact ${artifact.name} is ${String(artifact.size_in_bytes)} bytes`,
      );
    }
    const zip = await client.artifactZip(repo, artifact.id, REPORT_LIMITS.zipBytes);
    for (const xml of junitFiles(zip, state))
      reports.push({ source: 'junit', counts: countJunit(xml) });
  }
  return reports;
}

async function reporterReports(
  client: GithubClient,
  repo: string,
  run: WorkflowRun,
): Promise<TestReport[]> {
  const reports: TestReport[] = [];
  for (const check of await client.checkRuns(repo, run.head_sha)) {
    // A reporter's check belongs to a run when both name the same suite; without one the sha decides.
    const suite = check.check_suite?.id;
    if (suite !== undefined && run.check_suite_id != null && suite !== run.check_suite_id) continue;
    const found = countCheckOutput(check);
    if (found) reports.push({ source: 'check-run', counts: found.counts });
  }
  return reports;
}

// Counts come only from a report CI produced; a report that cannot be trusted posts nothing and says why.
export async function readRunTests(
  client: GithubClient,
  repo: string,
  run: WorkflowRun,
  log: (message: string) => void,
): Promise<RunTests> {
  const label = `${repo} run ${String(run.id)}`;
  try {
    const reports = [
      ...(await junitReports(client, repo, run)),
      ...(await reporterReports(client, repo, run)),
    ];
    const resolved = resolveTests(reports);
    if (resolved === undefined) return { events: [], found: false };
    if (!resolved.ok) {
      log(`${label}: no test counts posted, ${resolved.reason}`);
      return { events: [], found: true };
    }
    return { events: mapWorkflowRunTests(repo, run, resolved), found: true };
  } catch (error) {
    if (!(error instanceof TestReportError)) throw error;
    log(`${label}: no test counts posted, ${error.message}`);
    return { events: [], found: true };
  }
}
