import { normalizeHebrew } from '@/lib/text/normalize';

/**
 * Shared token-aware term matching for Hebrew header text.
 *
 * This is the single definition of the matching rule, used by both
 * `rules.ts` (block classification) and `map-columns.ts` (column mapping).
 * The rule was previously duplicated between the two — written separately,
 * under separate fix rounds, to the same specification — which is exactly
 * how such copies drift: a term could start matching in one and not the
 * other with no visible failure. Do not reintroduce a second copy.
 *
 * Plain substring matching lets a short Hebrew term false-match inside an
 * unrelated word — Hebrew's root-and-pattern morphology makes this common:
 * `שם` ("name") inside `בושם` ("perfume"), `ספק` ("supplier") inside `אספקה`
 * ("supply") or `מספק` ("provides"), `חבר` ("member") inside `חברה`
 * ("company") or `מחברת` ("notebook"), `ביט` inside `ביטים` ("drill bits"),
 * `בר` inside `ברגים` ("screws"). Single-word terms therefore must match a
 * whole token, never a mere substring. Multi-word terms (e.g. `כמות יחידות`)
 * keep substring matching against the full text: they are long enough that
 * accidental containment is not a realistic risk, and splitting them into
 * tokens would require the words to be adjacent-and-exact anyway.
 */

/** Leading/trailing characters stripped off a token before comparing it to a
 * single-word term. Only letters and digits survive at the edges, so
 * `סה"כ` and `עו"ש` keep their *internal* punctuation (they are never split,
 * since we only ever strip the leading and trailing run), while a token like
 * `(1000)` or `שולם.` loses its wrapping punctuation. */
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Splits already-normalized text into whole words for single-word term
 * matching. Splits on whitespace and on `/` — a genuine word separator in
 * these sheets (`פירוט/תיאור תנועה`, `מזומן/אשראי`, `אתר ווייבז` glued to a
 * neighbour) — but never on other internal punctuation, so `סה"כ קיזוז`
 * yields the two tokens `סה"כ` and `קיזוז`, not four fragments: the gershayim
 * in `סה"כ` is intra-word, unlike a `/` between two words.
 *
 * Hebrew conjunctive prefixes (`ו`/`ה`/`ב`) are deliberately NOT stripped:
 * `אתר ווייבז` still won't match the term `וייבז`. Stripping single-letter
 * prefixes would reintroduce the false-positive class whole-token matching
 * just eliminated.
 */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .split(/[\s/]+/)
      .map((token) => token.replace(EDGE_PUNCTUATION, ''))
      .filter((token) => token !== ''),
  );
}

/**
 * Whether `term` matches within `text`. Both are compared after
 * `normalizeHebrew(...).toLowerCase()`; `text` is expected to already be in
 * that form (callers normalize once per cell rather than once per term
 * checked against it). A multi-word term (contains a space) matches as a
 * substring of `text`; a single-word term must equal one whole token of
 * `text`.
 */
export function termMatches(term: string, text: string): boolean {
  const needle = normalizeHebrew(term).toLowerCase();
  if (needle.includes(' ')) {
    return text.includes(needle);
  }
  const [needleToken] = tokenize(needle);
  return needleToken !== undefined && tokenize(text).has(needleToken);
}
