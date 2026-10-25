import type { Provenance } from '@debrief/schema';
import { COLORS } from '@debrief/ui';

export interface ProvenanceTone {
  text: string;
  border: string;
  color: string;
  phrase: string;
}

// Derived events (claims, verdicts) never wear the reported or observed tone (D-083).
export const PROVENANCE_TONE: Record<Provenance, ProvenanceTone> = {
  reported: {
    text: 'text-cyan',
    border: 'border-cyan',
    color: COLORS.cyan,
    phrase: '○ reported by the agent',
  },
  observed: {
    text: 'text-ember',
    border: 'border-ember',
    color: COLORS.ember,
    phrase: '● observed by the world',
  },
  derived: {
    text: 'text-text',
    border: 'border-text',
    color: COLORS.text,
    phrase: '◇ derived by Debrief',
  },
};
