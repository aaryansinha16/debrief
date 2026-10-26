import { CANVAS_SESSION, CANVAS_SESSION_ID } from './__fixtures__/canvas-claims';
import { type SessionCheck, buildSessionCheck } from './session-check';
import { sessionCheckInputSchema } from './session-check-input';

export const SAMPLE_SESSION_ID = CANVAS_SESSION_ID;

// Until GET /v1/sessions/:id/check exists (P-65.1), the one session is the canvas sample, which says it is one.
export function loadSessionCheck(id: string): Promise<SessionCheck | undefined> {
  if (id !== CANVAS_SESSION_ID) return Promise.resolve(undefined);
  return Promise.resolve(buildSessionCheck(sessionCheckInputSchema.parse(CANVAS_SESSION)));
}
