import { MIN_SIDE_CM, metres } from '../geometry';
import { MAX_HEIGHT_CM, MAX_SIDE_CM } from './ops';

/**
 * Lengths a lead types, in metres, the way people type them on a Hebrew
 * keyboard: "2,5" is two and a half metres, spaces around the number are
 * nothing, and a direction mark carried in by a paste from a Hebrew document
 * is nothing too. What comes out is whole centimetres, like everything the
 * map stores.
 *
 * `parseMetres` answers three ways on purpose. `null` is an empty field —
 * "leave this as it is", which is how the several-items inspector reads a
 * field it showed as mixed. `'invalid'` is text that is not a length. A
 * number is centimetres. Nothing here ever answers `NaN`, so no `NaN` can
 * reach an op, a refusal or the server.
 */

/** Left-to-right and right-to-left marks and embeddings a Hebrew page can carry into a pasted number. */
const DIRECTION_MARKS = /[‎‏‪-‮⁦-⁩]/g;
const LENGTH = /^(-?)(\d*)(?:\.(\d{1,2}))?$/;

export function parseMetres(text: string): number | null | 'invalid' {
  const cleaned = text.replace(DIRECTION_MARKS, '').trim().replace(',', '.');
  if (cleaned === '') return null;
  const match = LENGTH.exec(cleaned);
  if (match === null || (match[2] === '' && match[3] === undefined)) return 'invalid';
  // Digit by digit rather than Number(text) * 100, so "2.55" is 255 and never 254.99999999999997.
  const whole = match[2] === '' ? 0 : Number(match[2]);
  const fraction = match[3] === undefined ? 0 : Number(match[3].padEnd(2, '0'));
  const cm = whole * 100 + fraction;
  return match[1] === '-' && cm !== 0 ? -cm : cm;
}

export interface MetresRange {
  minCm: number;
  maxCm: number;
}

/** A width or a depth: the same bounds the op refusals hold (`ops.ts`). */
export const SIDE_RANGE: MetresRange = { minCm: MIN_SIDE_CM, maxCm: MAX_SIDE_CM };
/** A height: ten centimetres to twenty metres. */
export const HEIGHT_RANGE: MetresRange = { minCm: MIN_SIDE_CM, maxCm: MAX_HEIGHT_CM };
/** A position may be past the fence — outside is reported, not impossible — but not past half a kilometre. */
export const POSITION_RANGE: MetresRange = { minCm: -MAX_SIDE_CM, maxCm: MAX_SIDE_CM };
/** Zero or more: the gap in a row, a net's unshaded strip. */
export const GAP_RANGE: MetresRange = { minCm: 0, maxCm: MAX_SIDE_CM };

export const NOT_A_LENGTH = 'צריך מספר במטרים, עם עד שתי ספרות אחרי הנקודה — למשל 2.5';

export type MetresReading = { ok: true; cm: number | null } | { ok: false; error: string };

/**
 * A typed field, read and checked, with the Hebrew the inspector shows under
 * it. The message is Hebrew here rather than an English prefix mapped later
 * because it never travels: it is not thrown, and no server sees it.
 */
export function readMetres(text: string, range: MetresRange): MetresReading {
  const cm = parseMetres(text);
  if (cm === 'invalid') return { ok: false, error: NOT_A_LENGTH };
  if (cm !== null && (cm < range.minCm || cm > range.maxCm)) {
    return { ok: false, error: `צריך מספר בין ${metres(range.minCm)} ל־${metres(range.maxCm)} מטר` };
  }
  return { ok: true, cm };
}
