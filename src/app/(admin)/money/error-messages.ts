import type { HebrewErrors } from '@/lib/errors/hebrew';

/**
 * R9 at the money screens' action boundary: the map `toHebrewError` is given.
 *
 * ## Why this is a map and not a `hebrewError(error)` helper
 *
 * Plan 09 sketches a local helper that tests a message for a Hebrew letter
 * and passes it through. That would be a **fourth** copy of an inference the
 * project has already ruled against: `src/lib/errors/hebrew.ts` is the one
 * boundary, its maps are passed as arguments rather than registered (§5 A7),
 * and the alphabet test is precisely what `HebrewRefusal` exists to retire,
 * because it answers "is this Hebrew?" when the question is "did someone mean
 * this?" (§5 A20, A27). So the refusals these screens raise are thrown as
 * `HebrewRefusal`, and this array carries only the English a library can
 * still throw at us.
 *
 * ## What is deliberately absent
 *
 * The Hebrew messages `ledger.ts` and `obligations.ts` throw as plain
 * `Error`s are **not** listed here, and that is on purpose. They are static
 * strings with no Latin character, so the alphabet passthrough still carries
 * them — and it logs a warning each time it fires, by design, so that the log
 * is the list of call sites still to migrate. Self-mapping them (Hebrew
 * prefix to the same Hebrew sentence) would silence that warning and hide
 * those call sites from the lane that is retiring the passthrough, while
 * adding a second copy of each sentence that could drift from the throw.
 *
 * Prefixes, because both entries interpolate the offending value.
 */
export const MONEY_ERRORS: HebrewErrors = [
  // `toAgorot` in src/lib/money.ts, reachable whenever a form sends something
  // that is not a number — an empty number input arrives as NaN.
  ['not a number',
    'הסכום שהוזן אינו מספר. הקלידו סכום בשקלים.'],
  // `fromAgorot`, for a value that survived parsing but is not a whole number
  // of agorot.
  ['agorot must be an integer',
    'הסכום שהוזן אינו סכום תקין בשקלים ואגורות.'],
];
