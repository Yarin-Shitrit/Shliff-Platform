import { toHebrewError, type HebrewErrors } from '@/lib/errors/hebrew';

/**
 * R9: no English reaches a Hebrew screen. Failures are mapped here, at the
 * action boundary, and anything unmapped becomes the Hebrew fallback plus a
 * log line — never an echo of what the library threw.
 *
 * The maps are arguments rather than a registry (integration §5 A7): a
 * registry is global mutable state whose behaviour depends on import order,
 * which works in tests and fails once Next code-splits the bundle.
 *
 * Every key is an ENGLISH PREFIX of the thrown message, because that is what
 * `toHebrewError` matches on. Nothing here may lean on the Hebrew passthrough:
 * these messages interpolate ids, and a single Latin character makes a message
 * fail that test and degrade silently to the fallback.
 *
 * The container behind this screen is stopped by hand from time to time to
 * relieve memory pressure, so a raw driver message reaching a lead is a real
 * path rather than a hypothetical one. That is the case the fallback exists
 * for, and the test asserts it returns no Latin character whatever it is given.
 */
export const CONDITION_ERRORS: HebrewErrors = [
  ['unknown inventory item', 'לא מצאנו את הפריט הזה במחסן'],
  ['unknown condition', 'המצב הזה אינו אחד מארבעת המצבים האפשריים'],
];

/** `toHebrewError` already falls back to `HEBREW_FALLBACK`, so there is no
 *  `??` here: a second fallback would be a second place to keep in step. */
export function conditionFailureMessage(error: unknown): string {
  return toHebrewError(error, CONDITION_ERRORS);
}
