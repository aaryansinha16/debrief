import { TYPE } from '@debrief/ui';

import { Notice } from '../../components/notice';
import { SessionList } from '../../components/session-list';
import { ApiNotConfiguredError, createApiClient } from '../../lib/api';

export const dynamic = 'force-dynamic';

export default async function SessionsPage() {
  let content: React.ReactNode;
  try {
    const sessions = await createApiClient().listSessions({ limit: 50 });
    content = <SessionList sessions={sessions} />;
  } catch (error) {
    content =
      error instanceof ApiNotConfiguredError ? (
        <Notice title="No API key configured">
          Set <code className="font-mono">DEBRIEF_API_KEY</code> to a tenant key and restart the web
          app.
        </Notice>
      ) : (
        <Notice title="The API is unreachable">
          {error instanceof Error ? error.message : 'unknown error'}
        </Notice>
      );
  }
  return (
    <section>
      <h1 className={`mb-6 ${TYPE.display}`}>Sessions</h1>
      {content}
    </section>
  );
}
