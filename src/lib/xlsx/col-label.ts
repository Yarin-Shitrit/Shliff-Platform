/**
 * A 1-indexed spreadsheet column number as its A1 letters: 1 → A, 26 → Z,
 * 27 → AA.
 *
 * Every surface that points a human at a cell range speaks A1 — the review
 * cards, the data explorer, and the generated ingestion report — so all three
 * read the spelling from here. It had drifted into three separate copies once
 * already.
 *
 * A bijective base-26 numbering, not plain base-26: there is no zero digit, so
 * each step subtracts one before taking the remainder. Indexes below 1 have no
 * A1 spelling and yield an empty string.
 */
export function colLabel(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
