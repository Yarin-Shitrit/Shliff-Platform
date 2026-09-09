import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';
import { normalizeHebrew } from '@/lib/text/normalize';
import { LEXICON } from './lexicon';
import { BLOCK_ARCHETYPES, type BlockArchetype, type Classification } from './types';

/** How many leading rows of a block count as potential headers. */
const HEADER_ROWS = 3;

/**
 * Collects the text a classifier should look at: the block's first rows (for
 * header rows) and its first column (for header columns, as in בצרה where the
 * category label sits on the right and the labels run down column A).
 */
function candidateText(grid: SheetGrid, range: CellRange): string[] {
  const out: string[] = [];

  const lastHeaderRow = Math.min(range.bottom, range.top + HEADER_ROWS - 1);
  for (let row = range.top; row <= lastHeaderRow; row += 1) {
    for (let col = range.left; col <= range.right; col += 1) {
      const text = grid.cells[row - 1]?.[col - 1]?.text ?? '';
      if (text !== '') out.push(normalizeHebrew(text).toLowerCase());
    }
  }

  for (let row = range.top; row <= range.bottom; row += 1) {
    const text = grid.cells[row - 1]?.[range.left - 1]?.text ?? '';
    if (text !== '') out.push(normalizeHebrew(text).toLowerCase());
  }

  return out;
}

function emptyScores(): Record<BlockArchetype, number> {
  return Object.fromEntries(
    BLOCK_ARCHETYPES.map((a) => [a, 0]),
  ) as Record<BlockArchetype, number>;
}

/**
 * Scores a block against every archetype's keyword signals and returns the best
 * match with a confidence derived from its margin over the runner-up.
 *
 * Column order is irrelevant: every candidate cell is scored independently, so
 * Gagarin (qty, price) and Collabo (price, qty) score identically.
 */
export function classifyBlock(grid: SheetGrid, range: CellRange): Classification {
  const haystack = candidateText(grid, range);
  const scores = emptyScores();

  for (const [archetype, signals] of Object.entries(LEXICON)) {
    let score = 0;
    for (const signal of signals) {
      const needle = normalizeHebrew(signal.term).toLowerCase();
      // Count each signal at most once, so a repeated word cannot dominate.
      if (haystack.some((text) => text.includes(needle))) score += signal.weight;
    }
    scores[archetype as BlockArchetype] = score;
  }

  const ranked = BLOCK_ARCHETYPES
    .filter((a) => a !== 'unknown')
    .map((a) => ({ archetype: a, score: scores[a] }))
    .sort((x, y) => y.score - x.score);

  const best = ranked[0];
  const runnerUp = ranked[1];

  if (!best || best.score === 0) {
    return { archetype: 'unknown', confidence: 0, scores };
  }

  const margin = (best.score - (runnerUp?.score ?? 0)) / best.score;
  // Absolute evidence matters as much as margin: one weak signal is not enough.
  const evidence = Math.min(best.score / 6, 1);
  const confidence = Math.max(0, Math.min(1, margin * 0.5 + evidence * 0.5));

  return { archetype: best.archetype, confidence, scores };
}
