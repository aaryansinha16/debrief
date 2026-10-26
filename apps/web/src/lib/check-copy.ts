import type { CheckCounts } from './session-check';

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

export const numberWord = (n: number): string => WORDS[n] ?? String(n);
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const counted = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export type HeadlineTone = 'contradicted' | 'holds' | 'muted';

export interface Headline {
  claims: string;
  verdict: string;
  tone: HeadlineTone;
}

// claim-check.dc.html: how many claims, then what became of them ("Seven claims. Two fall apart.").
export function headlineOf(counts: CheckCounts): Headline {
  const { claims: total, holds, contradicted, noWitness, hedged } = counts;
  if (total === 0) {
    const verdict =
      hedged === 0
        ? 'Nothing the agent said can be checked.'
        : `${capital(numberWord(hedged))} hedged, never scored.`;
    return { claims: 'No claims to check.', verdict, tone: 'muted' };
  }
  const claims = `${capital(numberWord(total))} ${counted(total, 'claim', 'claims')}.`;
  const every = (many: string, one: string): string =>
    total === 1
      ? `It ${one}.`
      : total === 2
        ? `Both ${many}.`
        : `All ${numberWord(total)} ${many}.`;
  if (contradicted > 0) {
    const verdict =
      contradicted === total
        ? every('fall apart', 'falls apart')
        : `${capital(numberWord(contradicted))} ${counted(contradicted, 'falls', 'fall')} apart.`;
    return { claims, verdict, tone: 'contradicted' };
  }
  if (holds === total) return { claims, verdict: every('hold', 'holds'), tone: 'holds' };
  if (holds === 0) {
    return {
      claims,
      verdict: `No witness could check ${counted(total, 'it', 'them')}.`,
      tone: 'muted',
    };
  }
  const verdict = `${capital(numberWord(holds))} ${counted(holds, 'holds', 'hold')}, ${numberWord(noWitness)} without a witness.`;
  return { claims, verdict, tone: 'holds' };
}
