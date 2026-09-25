/**
 * Angles a lead types, in whole degrees: a shade net's rope angle (spec
 * §12, D17). Read the way `metres.ts` reads lengths — spaces around the
 * number, and a direction mark carried in by a paste from a Hebrew document,
 * are nothing; a trailing "°" is the unit, not a typo — and checked against
 * the one range the map allows.
 *
 * Why 20° to 80°: at 90° a rope hangs straight down and holds nothing;
 * towards 0° the stake runs off towards infinity. At 20° the stake stands
 * 2.7 times the net's height out (8.2 m for a 3 m net), and anything
 * shallower is almost certainly a typo; at 80° it stands 0.18 times the
 * height out (53 cm).
 *
 * The refusals are Hebrew here because they never travel: the inspector
 * shows them under the box. The server's own refusal (`ops.ts`, prefix
 * `a rope angle must be`) maps to the same sentence in `failure-messages.ts`.
 */

/** Left-to-right and right-to-left marks and embeddings a Hebrew page can carry into a pasted number. */
const DIRECTION_MARKS = /[‎‏‪-‮⁦-⁩]/g;
const WHOLE = /^-?\d+$/;

export const MIN_ROPE_ANGLE_DEG = 20;
export const MAX_ROPE_ANGLE_DEG = 80;

/** A rope angle the map accepts: a whole number of degrees from 20 to 80. */
export function isRopeAngle(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_ROPE_ANGLE_DEG && value <= MAX_ROPE_ANGLE_DEG;
}

export const NOT_WHOLE_DEGREES = 'צריך מספר שלם של מעלות — למשל 45';

/** Each number isolated (U+2066…U+2069), so it keeps its place in a right-to-left sentence (spec §20). */
export const ROPE_ANGLE_OUT_OF_RANGE =
  `זווית החבלים היא מספר שלם של מעלות, מ־⁦${MIN_ROPE_ANGLE_DEG}⁩ עד ⁦${MAX_ROPE_ANGLE_DEG}⁩`;

export type DegreesReading = { ok: true; deg: number | null } | { ok: false; error: string };

/**
 * A typed rope angle: an empty box is null ("leave it as it is", as
 * `readMetres` reads one), a whole number from 20 to 80 is that number, and
 * anything else is a Hebrew refusal. Never `NaN`.
 */
export function readDegrees(text: string): DegreesReading {
  const cleaned = text.replace(DIRECTION_MARKS, '').trim().replace(/°$/, '').trim();
  if (cleaned === '') return { ok: true, deg: null };
  if (!WHOLE.test(cleaned)) return { ok: false, error: NOT_WHOLE_DEGREES };
  const deg = Number(cleaned);
  return isRopeAngle(deg) ? { ok: true, deg } : { ok: false, error: ROPE_ANGLE_OUT_OF_RANGE };
}
