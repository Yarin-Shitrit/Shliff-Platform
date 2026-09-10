const DOUBLE_QUOTES = /[״“”]/g;
/** U+05F3 geresh, U+2018/U+2019 curly single quotes, U+02BC → ASCII `'`. */
const SINGLE_QUOTES = /[׳‘’ʼ]/g;
/** Any run of whitespace including NBSP. */
const WHITESPACE = /[\s ]+/g;
/** LRM (U+200E), RLM (U+200F), zero-width space (U+200B), zero-width joiner (U+200D) → removed. */
const DIRECTIONAL_AND_ZERO_WIDTH = /[‎‏​‍]/g;
/**
 * Normalizes Hebrew punctuation and whitespace so header strings from different
 * sheets compare equal. Applied before every lexicon lookup and before computing
 * a layout fingerprint.
 */
export function normalizeHebrew(input: string): string {
  return input
    .replace(DOUBLE_QUOTES, '"')
    .replace(SINGLE_QUOTES, "'")
    .replace(DIRECTIONAL_AND_ZERO_WIDTH, '')
    .replace(WHITESPACE, ' ')
    .trim();
}

/**
 * True when a string a person typed carries no visible content.
 *
 * Use this for every blankness check on user input. `.trim()` is not enough:
 * it leaves LRM, RLM and zero-width marks standing, and in this RTL admin UI a
 * browser injects those invisibly on copy-paste — so a field that looks empty
 * to a human passes a trim check and gets stored. That defect was found three
 * separate times (an exception reason, an offset note, a task title) before it
 * got a name.
 *
 * This is for validating input only. Never normalize the value you store: the
 * original spelling is evidence, and rewriting it loses information — the
 * geresh in `ראנצ׳ו` becomes an ASCII apostrophe that appears in no sheet.
 */
export function isBlank(value: string | null | undefined): boolean {
  return !normalizeHebrew(value ?? '');
}
