import {
  toHebrewError, HEBREW_FALLBACK, type HebrewErrors,
} from '@/lib/errors/hebrew';

/**
 * `setSheetAuthority`'s refusal, verbatim.
 *
 * A copy rather than an import, because what matters is not sharing a value
 * but noticing a divergence: `sheet-labels.test.ts` calls the real function
 * against a real database and asserts this string is exactly what it raises.
 * The day the promoter rewords its refusal, that test fails — which is
 * precisely the day a shared constant would have hidden the change.
 *
 * `src/lib/import/sheets.ts` is Wave 2's and read-only for this plan, so
 * marking the throw as a `HebrewRefusal` at its source — which is what A20
 * would otherwise prescribe — is not this lane's edit to make.
 */
export const AUTHORITY_NEEDS_SEASON =
  'אי אפשר לסמן גיליון כסמכותי בלי עונה — בלי עונה אי אפשר להבחין בין גרסה כפולה של אותה שנה לגיליון של שנה אחרת';

/**
 * R9's fallback, aliased to the sentence the app already ships rather than
 * written again.
 *
 * The plan specified a second sentence here (`הפעולה נכשלה, נסו שוב.`). Two
 * generic Hebrew failure lines on adjacent screens is the duplication that
 * I3, A7 and A27 each exist to prevent — one boundary, one fallback — so this
 * is `HEBREW_FALLBACK` under the name the plan's later tasks import.
 */
export const GENERIC_FAILURE = HEBREW_FALLBACK;

export type ActionResult = { ok: true } | { ok: false; message: string };

/**
 * The one refusal this module recognises, keyed on the message itself.
 *
 * `toHebrewError`'s map is documented as keyed by English prefix, because the
 * domain libraries throw English. This refusal is the exception: `sheets.ts`
 * throws it already in Hebrew, so there is no English prefix to key on and the
 * key is the sentence. It still behaves as a prefix match (`startsWith`), and
 * it still runs BEFORE the alphabet passthrough — which is the whole point.
 * Left unmapped, the passthrough would return this same string by inferring
 * "it has Hebrew letters and no Latin ones, so somebody meant it", log a
 * warning, and work right up until the refusal interpolates a sheet name in
 * Latin script. A20 calls that the instrument that cannot report absence.
 */
const SHEET_LABEL_ERRORS: HebrewErrors = [
  [AUTHORITY_NEEDS_SEASON, AUTHORITY_NEEDS_SEASON],
];

/**
 * R9 at the action boundary. A refusal this module recognises is Hebrew a
 * lead can act on and goes to the screen as-is; anything else — a bad id, a
 * dropped connection, a constraint — is a programmer's message and becomes
 * the generic line, logged once by the shared helper and never echoed.
 *
 * Delegates to `toHebrewError` rather than testing an allowlist of its own, so
 * this screen gains the cause-chain walk for free: drizzle reports a failed
 * update as `Failed query: update "sheets" …` with the real message on
 * `.cause`, and a private `error.message` check would have missed it (A27).
 */
export function refusalMessage(error: unknown): string {
  return toHebrewError(error, SHEET_LABEL_ERRORS);
}
