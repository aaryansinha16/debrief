import type { Provenance } from '@debrief/schema';
import { COLORS } from '@debrief/ui';

export interface ProvenanceTone {
  text: string;
  border: string;
  color: string;
  phrase: string;
}

// The replay canvas: what the agent said in off-white, what the world saw in the holds blue; derived events (claims,
// verdicts) never wear either tone (D-083).
export const PROVENANCE_TONE: Record<Provenance, ProvenanceTone> = {
  reported: {
    text: 'text-text',
    border: 'border-text',
    color: COLORS.text,
    phrase: '○ reported by the agent',
  },
  observed: {
    text: 'text-holds',
    border: 'border-holds',
    color: COLORS.holds,
    phrase: '● observed by the world',
  },
  derived: {
    text: 'text-text-subtle',
    border: 'border-text-subtle',
    color: COLORS.textSubtle,
    phrase: '◇ derived by Debrief',
  },
};
