import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SessionList } from './session-list';

const session = {
  id: '7f3a9c1e-0000-4000-8000-00000000c0de',
  startedAt: '2026-10-25T14:02:04.000Z',
  lastMessageAt: '2026-10-25T14:31:40.000Z',
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
    expect(html).toContain('href="/sessions/7f3a9c1e-0000-4000-8000-00000000c0de"');
    expect(html).toContain('title="7f3a9c1e-0000-4000-8000-00000000c0de"');
    expect(html).toContain('7f3a9c1e…');
    expect(html).toContain('not checked');
    expect(html).toContain('>checked<');
    expect(html).toContain('<span class="font-mono text-text">5</span> messages');
    expect(html).toContain('<span class="font-mono text-text">2</span> claims');
    expect(html).toContain('<span class="font-mono text-text">1</span> verdicts');
  });
});
