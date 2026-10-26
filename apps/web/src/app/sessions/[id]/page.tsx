import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { loadSessionCheck } from '../../../lib/sessions';
import { ClaimCheck } from '../../../scenes/claim-check';

export const metadata: Metadata = { title: 'Claim check · Debrief' };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await loadSessionCheck(id);
  if (check === undefined) notFound();
  return <ClaimCheck check={check} />;
}
