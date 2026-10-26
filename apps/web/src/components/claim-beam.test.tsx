import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ClaimBeam } from './claim-beam';

describe('ClaimBeam', () => {
  it('lights a claim that holds with a pulse that waits its turn', () => {
    const html = renderToStaticMarkup(<ClaimBeam state="holds" delay={1.8} />);
    expect(html).toContain('bg-holds shadow-glow-holds');
    expect(html).toContain('class="beam-run" style="animation-delay:1.8s"');
    expect(html).toContain('class="beam-pulse"');
    expect(html).toContain('border-holds');
    expect(renderToStaticMarkup(<ClaimBeam state="holds" />)).toContain('animation-delay:0s');
  });

  it('fractures a contradicted claim into a zigzag that flickers once the ring has drawn', () => {
    const html = renderToStaticMarkup(<ClaimBeam state="contradicted" delay={1.2} />);
    expect(html).toContain('class="beam-fracture shrink-0" style="animation-delay:1.2s"');
    expect(html).toContain('M2 20l10-9 6 14 9-17 7 18 8-10 12 4');
    expect(html).toContain('bg-contradicted/40');
    expect(html).not.toContain('beam-pulse');
  });

  it('dots the line where no witness saw, and greys it where nothing is scored', () => {
    const none = renderToStaticMarkup(<ClaimBeam state="no-witness" />);
    expect(none).toContain('border-dotted border-no-witness');
    expect(none).not.toContain('beam-run');
    for (const state of ['pending', 'hedged'] as const) {
      expect(renderToStaticMarkup(<ClaimBeam state={state} />)).toContain(
        'border-dotted border-line-strong',
      );
    }
  });

  it('is decoration: the verdict beside it carries the word', () => {
    expect(renderToStaticMarkup(<ClaimBeam state="holds" />)).toMatch(
      /^<span class="[^"]*" aria-hidden="true" data-beam="holds">/,
    );
  });
});
