import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SessionList } from './session-list';

const session = {
  id: 'e7ea2f15-13f5-467e-81b9-e6e6d4cbf33c',
  startedAt: '2026-11-01T18:31:39.574Z',
  lastMessageAt: '2026-11-01T18:32:10.000Z',
  messages: 5,
  claims: 2,
  verdicts: 1,
};

describe('SessionList', () => {
  it('says how to get a first session when there is none', () => {
    const html = renderToStaticMarkup(<SessionList sessions={[]} />);
    expect(html).toContain('data-testid="empty"');
    expect(html).toContain('debrief claude-code install');
  });

  it('links each session by its full id, shows its counts and whether it was checked', () => {
    const html = renderToStaticMarkup(
      <SessionList
        sessions={[session, { ...session, id: 'other', checkedAt: '2026-11-01T18:40:00.000Z' }]}
      />,
    );
    expect(html).toContain('href="/sessions/e7ea2f15-13f5-467e-81b9-e6e6d4cbf33c"');
    expect(html).toContain('title="e7ea2f15-13f5-467e-81b9-e6e6d4cbf33c"');
    expect(html).toContain('e7ea2f15…');
    expect(html).toContain('not checked');
    expect(html).toContain('>checked<');
    expect(html).toContain('<span class="font-mono text-text">5</span> messages');
    expect(html).toContain('<span class="font-mono text-text">2</span> claims');
    expect(html).toContain('<span class="font-mono text-text">1</span> verdicts');
  });
});
