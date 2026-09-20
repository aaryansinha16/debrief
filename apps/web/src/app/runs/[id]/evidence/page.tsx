import { notFound } from 'next/navigation';

import { RunHeader } from '../../../../components/run-header';

import { ApiError, createApiClient } from '../../../../lib/api';
import { readEnv } from '../../../../lib/env';
import { SealedFile } from '../../../../scenes/sealed-file';

export const dynamic = 'force-dynamic';

export default async function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = createApiClient();
  let run;
  try {
    run = await api.getRun(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return (
    <section className="flex flex-col gap-6">
      <RunHeader
        run={run}
        view="evidence"
        detail="every event, hash, checkpoint and proof of this run in one signed zip; verified in your browser before you download it"
      />
      <SealedFile runId={run.id} verifyUrl={readEnv().VERIFY_URL} />
    </section>
  );
}
