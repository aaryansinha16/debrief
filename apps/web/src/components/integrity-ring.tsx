const SIZE = 320;
const RADIUS = 128;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Round caps reach STROKE / 2 past each end; this leaves a visible gap of 6 between neighbouring arcs.
const INSET = STROKE / 2 + 3;

const round = (n: number): number => Math.round(n * 100) / 100;

const pointAt = (length: number): string => {
  const angle = (length / CIRCUMFERENCE) * 2 * Math.PI;
  const x = SIZE / 2 + RADIUS * Math.sin(angle);
  const y = SIZE / 2 - RADIUS * Math.cos(angle);
  return `${String(round(x))} ${String(round(y))}`;
};

// An arc of the ring from `from` to `to` (fractions, clockwise from the top), drawn shorter so caps never touch.
export function arcPath(from: number, to: number): string {
  const span = (to - from) * CIRCUMFERENCE;
  const inset = Math.min(INSET, span / 4);
  const start = from * CIRCUMFERENCE + inset;
  const end = to * CIRCUMFERENCE - inset;
  const large = end - start > CIRCUMFERENCE / 2 ? 1 : 0;
  return `M ${pointAt(start)} A ${String(RADIUS)} ${String(RADIUS)} 0 ${String(large)} 1 ${pointAt(end)}`;
}
