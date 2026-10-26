import { describe, expect, it } from 'vitest';

import { theatreStageOf } from './theatre-stage';

describe('theatreStageOf', () => {
  it('opens the flat map unless the url asks for the 3d stage', () => {
    expect(theatreStageOf('3d')).toBe('3d');
    expect(theatreStageOf(undefined)).toBe('map');
    expect(theatreStageOf('map')).toBe('map');
    expect(theatreStageOf(['3d'])).toBe('map');
  });
});
