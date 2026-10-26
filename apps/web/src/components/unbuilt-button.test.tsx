import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PlayIcon } from './controls';
import { UnbuiltButton } from './unbuilt-button';

describe('UnbuiltButton', () => {
  it('reads as disabled, points at its reason and never looks like a live primary action', () => {
    const html = renderToStaticMarkup(
      <UnbuiltButton reason="soon" icon={<PlayIcon />}>
        Watch what happened
      </UnbuiltButton>,
    );
    expect(html).toMatch(/^<button type="button" disabled="" aria-describedby="soon"/);
    expect(html).toContain('cursor-not-allowed');
    expect(html).toContain('border-dashed border-line-strong');
    expect(html).toContain('text-text-muted');
    expect(html).not.toMatch(/shadow|bg-text|bg-contradicted|opacity|hover:/);
    expect(html).toContain('<span class="inline-flex" aria-hidden="true"><svg');
    expect(renderToStaticMarkup(<UnbuiltButton reason="soon">Seal</UnbuiltButton>)).not.toContain(
      'aria-hidden',
    );
  });
});
