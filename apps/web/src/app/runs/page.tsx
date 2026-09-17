import { Notice } from '../../components/notice';
import { RunList } from '../../components/run-list';
import { ApiNotConfiguredError, createApiClient } from '../../lib/api';

export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  let content: React.ReactNode;
  try {
    const page = await createApiClient().listRuns({ limit: 50 });
    content = <RunList runs={page.runs} />;
  } catch (error) {
    content =
      error instanceof ApiNotConfiguredError ? (
        <Notice title="No API key configured">
          Set <code className="font-mono">DEBRIEF_API_KEY</code> to a tenant key (
          <code className="font-mono">pnpm --filter @debrief/api seed --tenant demo</code>) and
          restart the web app.
        </Notice>
      ) : (
        <Notice title="The API is unreachable">
          {error instanceof Error ? error.message : 'unknown error'}
        </Notice>
      );
  }
  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">Runs</h1>
      {content}
    </section>
  );
}
