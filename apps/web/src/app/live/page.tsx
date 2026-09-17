import { Notice } from '../../components/notice';
import { ApiNotConfiguredError, createApiClient } from '../../lib/api';
import { ApproachView } from '../../scenes/approach-view';

export const dynamic = 'force-dynamic';

// The approach starts from the run list and follows the feed from the head; the stream is proxied by /api/live.
export default async function LivePage() {
  let content: React.ReactNode;
  try {
    const page = await createApiClient().listRuns({ limit: 50 });
    content = <ApproachView runs={page.runs} />;
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
      <h1 className="mb-2 text-2xl font-semibold">Live</h1>
      <p className="mb-6 text-sm text-text-muted">
        every run is an agent on approach: it leaves its principal, keeps a leash to them and lands
        beside the system it is acting on; a critical call pulses the zone. Hover an agent for its
        run, click to open it.
      </p>
      {content}
    </section>
  );
}
