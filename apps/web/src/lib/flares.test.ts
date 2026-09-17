import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { createReplay } from '@debrief/ui';
import { describe, expect, it } from 'vitest';

import { FLARE_MS, flaresAt } from './flares';

describe('flaresAt', () => {
  const replay = createReplay(demoRunFixture().filter((event) => event.runId === DEMO_RUN_ID));
  const deletion = replay.events.find(
    (entry) =>
      entry.event.kind === 'world.change' && entry.event.target?.operation === 'deleteVolume',
  )!;
  const volume = 'resource:orbital:projects/nova/volumes/vol-prod-01';

  it('flares the deleted volume at full strength at the event and fades it out', () => {
    expect(flaresAt(replay, deletion.t).get(volume)).toBe(1);
    expect(flaresAt(replay, deletion.t + FLARE_MS / 2).get(volume)).toBeCloseTo(0.5, 5);
    expect(flaresAt(replay, deletion.t + FLARE_MS + 1).has(volume)).toBe(false);
    expect(flaresAt(replay, deletion.t - 1).has(volume)).toBe(false);
    expect(flaresAt(replay, -1).size).toBe(0);
  });

  it('keeps the strongest flare per resource and ignores events without a resource', () => {
    const rotate = replay.events.find(
      (entry) =>
        entry.event.target?.operation === 'rotateCredential' && entry.event.kind === 'world.change',
    )!;
    const at = flaresAt(replay, rotate.t, 10_000);
    expect(
      at.get('resource:orbital:projects/nova/environments/staging/credentials/DATABASE_URL'),
    ).toBe(1);
    const both = flaresAt(replay, deletion.t, 10_000);
    expect(both.size).toBe(2);
    expect(both.get(volume)).toBe(1);
    const stripped = createReplay(
      replay.events.map((entry) => ({ ...entry.event, target: undefined })),
    );
    expect(flaresAt(stripped, deletion.t, 10_000).size).toBe(0);
  });
});
