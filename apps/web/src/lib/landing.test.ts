import { describe, expect, it } from 'vitest';

import { STORY, renderLanding, verifyDemoHref } from './landing';

describe('landing', () => {
  it('points the verifier at the demo bundle by absolute url', () => {
    expect(verifyDemoHref('http://localhost:5173', 'http://localhost:3000')).toBe(
      'http://localhost:5173/?bundle=http%3A%2F%2Flocalhost%3A3000%2Fdemo%2Fbundle.zip',
    );
    expect(verifyDemoHref('https://verify.example/app/', 'https://debrief.example')).toBe(
      'https://verify.example/app/?bundle=https%3A%2F%2Fdebrief.example%2Fdemo%2Fbundle.zip',
    );
  });

  it('tells the story in five beats ending at the sealed file', () => {
    expect(STORY).toHaveLength(5);
    expect(STORY.at(-1)?.title).toBe('the sealed file');
    expect(STORY.every((beat) => beat.text.length > 40)).toBe(true);
  });

  it('renders one static page with the story, a lazy film, the cta and no framework', () => {
    const html = renderLanding('http://localhost:5173/');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('data-testid="verify-cta"');
    expect(html).toContain('data-verify="http://localhost:5173/"');
    expect(html).toContain('preload="none"');
    expect(html).toContain('/demo/theatre.webm');
    expect(html).toContain('/demo/theatre-poster.jpg');
    expect(html.match(/<li>/g)).toHaveLength(STORY.length);
    for (const beat of STORY) expect(html).toContain(beat.title);
    expect(html).not.toContain('_next/');
    expect(html).not.toMatch(/tamper-proof/i);
    expect(renderLanding('https://v.example/?x=<y>&q="a"')).toContain(
      'data-verify="https://v.example/?x=&lt;y&gt;&amp;q=&quot;a&quot;"',
    );
    expect(Buffer.byteLength(html)).toBeLessThan(12_000);
  });
});
