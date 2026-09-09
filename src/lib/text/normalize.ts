/** U+05F4 gershayim, U+201C/U+201D curly double quotes → ASCII `"`. */
const DOUBLE_QUOTES = /[״“”"]/g;
/** U+05F3 geresh, U+2018/U+2019 curly single quotes, U+02BC → ASCII `'`. */
const SINGLE_QUOTES = /[׳‘’ʼ']/g;
/** Any run of whitespace including NBSP. */
const WHITESPACE = /[\s ]+/g;

/**
 * Normalizes Hebrew punctuation and whitespace so header strings from different
 * sheets compare equal. Applied before every lexicon lookup and before computing
 * a layout fingerprint.
 */
export function normalizeHebrew(input: string): string {
  return input
    .replace(DOUBLE_QUOTES, '"')
    .replace(SINGLE_QUOTES, "'")
    .replace(WHITESPACE, ' ')
    .trim();
}
