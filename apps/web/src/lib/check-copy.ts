import type { CheckCounts, SessionCheck } from './session-check';
import { systemLabel } from './systems';

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
  const { claims: total, holds, contradicted, noWitness, pending, hedged } = counts;
  if (total === 0 && pending > 0) {
    const claims = `${capital(numberWord(pending))} ${counted(pending, 'claim', 'claims')}.`;
    return { claims, verdict: 'None checked yet.', tone: 'muted' };
  }
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

export const listOf = (items: readonly string[]): string =>
  items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${String(items.at(-1))}`;

export function leadOf(check: SessionCheck): string {
  const connected = check.witnesses
    .filter((witness) => witness.state === 'connected')
    .map((witness) => systemLabel(witness.system));
  const { pending, hedged } = check.counts;
  return [
    connected.length === 0
      ? 'No witness is connected, so nothing the agent said could be checked.'
      : `Every sentence the agent said about its work, checked against what ${listOf(connected)} actually recorded.`,
    pending === 0
      ? ''
      : `${capital(numberWord(pending))} ${counted(pending, 'claim is', 'claims are')} not checked yet.`,
    hedged === 0
      ? ''
      : `${capital(numberWord(hedged))} hedged ${counted(hedged, 'claim is', 'claims are')} shown and never scored.`,
  ]
    .filter((sentence) => sentence !== '')
    .join(' ');
}

export function ringLabel(counts: CheckCounts): string {
  const { claims: total, holds, contradicted, noWitness, local } = counts;
  if (total === 0) return 'No claims checked';
  const backed = local === 0 ? '' : `; ${String(local)} backed only by local evidence`;
  return `${String(holds)} of ${String(total)} ${counted(total, 'claim', 'claims')} ${counted(holds, 'holds', 'hold')}, ${String(contradicted)} contradicted, ${String(noWitness)} without a witness${backed}`;
}

const OFFSET = /([+-])(\d{2}):(\d{2})$/;
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const pad = (n: number): string => String(n).padStart(2, '0');

// Minutes east of UTC as written in the timestamp, so a session reads in the clock its agent worked by.
export function offsetOf(iso: string): number {
  const match = OFFSET.exec(iso);
  if (match === null) return 0;
  const [, sign, hours, minutes] = match;
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

const shifted = (iso: string, offset: number): Date => new Date(Date.parse(iso) + offset * 60_000);

export const clockAt = (iso: string, offset: number): string =>
  shifted(iso, offset).toISOString().slice(11, 19);

export function offsetLabel(offset: number): string {
  if (offset === 0) return 'UTC';
  const size = Math.abs(offset);
  return `UTC${offset < 0 ? '−' : '+'}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}

export function dayAt(iso: string, offset: number): string {
  const date = shifted(iso, offset);
  return `${String(date.getUTCDate())} ${String(MONTHS[date.getUTCMonth()])} ${String(date.getUTCFullYear())}`;
}

// claim-check.dc.html's meta line: agent · project · day · window in the session's own offset.
export function sessionLine(session: SessionCheck['session']): string {
  const offset = offsetOf(session.startedAt);
  const from = clockAt(session.startedAt, offset).slice(0, 5);
  const window =
    session.endedAt === undefined
      ? `from ${from}`
      : `${from}–${clockAt(session.endedAt, offset).slice(0, 5)}`;
  return [
    systemLabel(session.agent),
    session.project,
    dayAt(session.startedAt, offset),
    `${window} ${offsetLabel(offset)}`,
  ]
    .filter((part) => part !== undefined)
    .join(' · ');
}
