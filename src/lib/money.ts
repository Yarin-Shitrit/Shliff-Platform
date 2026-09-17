/**
 * Money is stored as `numeric(12,2)` and comes back from Postgres as a string.
 * In JS we work in integer agorot so that summing a season's dues never drifts.
 * Never do arithmetic on the parsed float directly.
 */

export function toAgorot(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${value}`);
  return Math.round(n * 100);
}

export function fromAgorot(agorot: number): string {
  if (!Number.isInteger(agorot)) throw new Error(`agorot must be an integer: ${agorot}`);
  return (agorot / 100).toFixed(2);
}

export function sumAgorot(values: Array<string | number>): number {
  return values.reduce<number>((total, value) => total + toAgorot(value), 0);
}

/** Display form: `60,955` when the decimals are empty, `33,740.55` otherwise. */
export function formatILS(agorot: number): string {
  return (agorot / 100).toLocaleString('he-IL', {
    minimumFractionDigits: agorot % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export const SHEKEL = '₪';

/**
 * A11. The one place an amount and its symbol are put together.
 *
 * The number — sign included — is formatted in a single `Intl` call, so the
 * minus stays welded to the digits. The symbol goes last, and the whole thing
 * is rendered inside a `<bdi>` by `Money` in `src/components/format.tsx`.
 * Direction is carried by the column an amount sits in, never by its sign.
 *
 * Never write `` `${formatILS(x)} ₪` `` at a call site. That is the same
 * string by luck, and the luck runs out the first time somebody writes the
 * minus separately.
 */
export function formatShekels(agorot: number): string {
  return `${formatILS(agorot)} ${SHEKEL}`;
}
