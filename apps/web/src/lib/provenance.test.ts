import { provenanceSchema } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import { PROVENANCE_TONE } from './provenance';

describe('PROVENANCE_TONE', () => {
  it('gives every provenance its own text, border, color and phrase', () => {
    const tones = provenanceSchema.options.map((provenance) => PROVENANCE_TONE[provenance]);
    for (const field of ['text', 'border', 'color', 'glyph', 'phrase'] as const) {
      expect(new Set(tones.map((tone) => tone[field])).size).toBe(tones.length);
    }
    for (const tone of tones) expect(tone.phrase.startsWith(`${tone.glyph} `)).toBe(true);
  });
});
