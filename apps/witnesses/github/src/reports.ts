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
}

const exceeded = (): TestReportError =>
  new TestReportError(
    `JUnit files exceed the limits (${String(REPORT_LIMITS.files)} files, ${String(REPORT_LIMITS.xmlBytes)} bytes each)`,
  );

function junitFiles(zip: Uint8Array, budget: Budget): [string, string][] {
  const state = { breach: false };
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(zip, {
      filter(file) {
        if (!file.name.toLowerCase().endsWith('.xml')) return false;
        budget.files += 1;
        // A directory entry may understate its size, so the larger of the two counts.
        const size = Math.max(file.size, file.originalSize);
        budget.bytes += size;
        state.breach ||=
          budget.files > REPORT_LIMITS.files ||
          budget.bytes > REPORT_LIMITS.xmlTotalBytes ||
          size > REPORT_LIMITS.xmlBytes ||
          (file.compression === 0 && file.size !== file.originalSize);
        return !state.breach;
      },
    });
  } catch {
    throw new TestReportError('artifact is not a readable zip');
  }
  const entries = Object.entries(archive);
  const actual = entries.reduce((sum, [, bytes]) => sum + bytes.length, 0);
  const largest = Math.max(0, ...entries.map(([, bytes]) => bytes.length));
  if (state.breach || largest > REPORT_LIMITS.xmlBytes || actual > REPORT_LIMITS.xmlTotalBytes) {
    throw exceeded();
  }
  return entries.map(([name, bytes]) => [name, new TextDecoder().decode(bytes)]);
}

function countFile(name: string, xml: string): TestReport {
  try {
    return { source: 'junit', counts: countJunit(xml) };
  } catch (error) {
    if (error instanceof TestReportError) throw new TestReportError(`${name}: ${error.message}`);
    throw error;
  }
}

async function junitReports(
  client: GithubClient,
  repo: string,
  run: WorkflowRun,
  startedAt: number | undefined,
): Promise<TestReport[]> {
  const listed = (await client.artifacts(repo, run.id)).filter(
    (artifact) => !artifact.expired && JUNIT_ARTIFACT.test(artifact.name),
  );
  if (listed.length > REPORT_LIMITS.artifacts) {
    throw new TestReportError(
      `${String(listed.length)} JUnit artifacts, limit is ${String(REPORT_LIMITS.artifacts)}`,
    );
  }
  const budget: Budget = { files: 0, bytes: 0 };
  const reports: TestReport[] = [];
  for (const artifact of listed) {
    // The artifacts list has no attempt filter; one from before this attempt began is not its report.
    const created = artifact.created_at ? Date.parse(artifact.created_at) : undefined;
    if (
      startedAt !== undefined &&
      (created === undefined ? run.run_attempt > 1 : created < startedAt)
    ) {
      throw new TestReportError(
        `artifact ${artifact.name} does not belong to attempt ${String(run.run_attempt)}`,
      );
    }
    if (artifact.size_in_bytes > REPORT_LIMITS.zipBytes) {
      throw new TestReportError(
        `artifact ${artifact.name} is ${String(artifact.size_in_bytes)} bytes`,
      );
    }
    const zip = await client.artifactZip(repo, artifact.id, REPORT_LIMITS.zipBytes);
    for (const [name, xml] of junitFiles(zip, budget)) reports.push(countFile(name, xml));
  }
  return reports;
}

async function reporterReports(
  client: GithubClient,
  repo: string,
  run: WorkflowRun,
  startedAt: number | undefined,
): Promise<TestReport[]> {
  const reports: TestReport[] = [];
  for (const check of await client.checkRuns(repo, run.head_sha, true)) {
    // A reporter's check belongs to a run when both name the same suite; without one the sha decides.
    const suite = check.check_suite?.id;
    if (suite !== undefined && run.check_suite_id != null && suite !== run.check_suite_id) continue;
    const finished = check.completed_at ? Date.parse(check.completed_at) : undefined;
    if (
      run.run_attempt > 1 &&
      startedAt !== undefined &&
      finished !== undefined &&
      finished < startedAt
    ) {
      continue;
    }
    const found = countCheckOutput(check);
    if (found)
      reports.push({ source: 'check-run', reporter: found.reporter, counts: found.counts });
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
  const startedAt = run.run_started_at ? Date.parse(run.run_started_at) : undefined;
  try {
    if (run.run_attempt > 1 && startedAt === undefined) {
      throw new TestReportError(
        'a re-run without run_started_at cannot be told from its first attempt',
      );
    }
    const reports = [
      ...(await junitReports(client, repo, run, startedAt)),
      ...(await reporterReports(client, repo, run, startedAt)),
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
