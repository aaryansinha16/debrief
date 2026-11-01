import type { Metadata } from 'next';
import { ZodError } from 'zod';
import { notFound } from 'next/navigation';

import { Notice } from '../../../components/notice';
import { ApiNotConfiguredError } from '../../../lib/api';
import { type SessionCheck } from '../../../lib/session-check';
import { loadSessionCheck } from '../../../lib/sessions';
import { ClaimCheck } from '../../../scenes/claim-check';

export const metadata: Metadata = { title: 'Claim check · Debrief' };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let check: SessionCheck | undefined;
  try {
    check = await loadSessionCheck(id);
  } catch (error) {
    // D-092: a payload the page cannot vouch for is refused and said so, never shown with a gap.
    if (error instanceof ZodError) {
      return (
        <Notice title="This check could not be shown">
          {error.issues.map((issue) => issue.message).join('; ')}
        </Notice>
      );
    }
    return error instanceof ApiNotConfiguredError ? (
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
  if (check === undefined) notFound();
  return <ClaimCheck check={check} />;
}
