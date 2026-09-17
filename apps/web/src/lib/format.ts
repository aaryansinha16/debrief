export const shortId = (id: string): string => (id.length > 12 ? `${id.slice(0, 8)}…` : id);

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

export function formatDuration(startedAt: string, endedAt: string | undefined): string {
  if (endedAt === undefined) return 'live';
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (Number.isNaN(ms) || ms < 0) return '—';
  if (ms < 1000) return `${String(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${String(Math.floor(ms / 60_000))} min ${String(Math.round((ms % 60_000) / 1000))} s`;
}
