import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';
import { normalizeHebrew } from '@/lib/text/normalize';
import { termMatches } from './match';
import { LEXICON } from './lexicon';
import {
  BLOCK_ARCHETYPES,
  CONFIDENCE_THRESHOLD,
  type BlockArchetype,
  type Classification,
} from './types';

/** How many leading rows of a block count as potential headers. */
const HEADER_ROWS = 3;

interface Candidates {
  /** Normalized, lowercased full cell text — one entry per candidate cell,
   * used for both phrase (multi-word) and token (single-word) matching via
   * `termMatches`. */
  texts: string[];
}

/**
 * Collects the text a classifier should look at: the block's first rows (for
 * header rows) and its first column (for header columns, as in בצרה where the
 * category label sits on the right and the labels run down column A).
 */
function candidateText(grid: SheetGrid, range: CellRange): Candidates {
  const texts: string[] = [];

  const addCell = (raw: string): void => {
    if (raw === '') return;
    texts.push(normalizeHebrew(raw).toLowerCase());
  };

  const lastHeaderRow = Math.min(range.bottom, range.top + HEADER_ROWS - 1);
  for (let row = range.top; row <= lastHeaderRow; row += 1) {
    for (let col = range.left; col <= range.right; col += 1) {
      addCell(grid.cells[row - 1]?.[col - 1]?.text ?? '');
    }
  }

  for (let row = range.top; row <= range.bottom; row += 1) {
    addCell(grid.cells[row - 1]?.[range.left - 1]?.text ?? '');
  }

  return { texts };
}

/**
 * Whether a lexicon term is found among the block's candidate text, using the
 * shared matching rule from `match.ts` (see its docs for why single-word
 * terms must equal a whole token rather than matching as a substring).
 */
function matches(candidates: Candidates, term: string): boolean {
  return candidates.texts.some((text) => termMatches(term, text));
}

function emptyScores(): Record<BlockArchetype, number> {
  return Object.fromEntries(
    BLOCK_ARCHETYPES.map((a) => [a, 0]),
  ) as Record<BlockArchetype, number>;
}

/** Absolute score at which the winning archetype's evidence is considered
 * "strong" — several corroborating signals, or one high-weight phrase match.
 * Chosen so a single weight-1 or weight-2 hint (a common word with no other
 * support) cannot saturate this term on its own. */
const EVIDENCE_SATURATION_SCORE = 6;

/** Minimum absolute score the winner must reach before its confidence is
 * allowed to reach CONFIDENCE_THRESHOLD at all, even when uncontested. Without
 * this gate, a single uncontested weight-1 signal (margin = 1, almost no real
 * evidence) still averaged above the threshold and was silently pre-confirmed. */
const MIN_SCORE_FOR_THRESHOLD = 3;

/**
 * Confidence is high only when the winner is BOTH clearly ahead of the
 * runner-up (margin) AND individually well-supported (evidence). A plain
 * average of the two lets either half alone carry a weak case across
 * CONFIDENCE_THRESHOLD:
 *  - a tie (margin 0) with a saturated evidence score still averaged to
 *    exactly 0.5 — a coin flip presenting as confident;
 *  - a lone uncontested weight-1 signal (margin 1, evidence near 0) still
 *    averaged to ~0.58 — one weak word presenting as confident.
 *
 * Both cases are gated below the threshold here, but not zeroed out: a
 * non-empty score is still a real (if weak) guess, and callers that check
 * "did we find any signal at all" should still see a positive number.
 * Confidence 0 is reserved for bestScore === 0 (the 'unknown' archetype).
 */
function computeConfidence(bestScore: number, runnerUpScore: number): number {
  if (bestScore <= 0) return 0;

  const margin = (bestScore - runnerUpScore) / bestScore;
  const evidence = Math.min(bestScore / EVIDENCE_SATURATION_SCORE, 1);
  const raw = margin * 0.5 + evidence * 0.5;

  const isWeak = margin <= 0 || bestScore < MIN_SCORE_FOR_THRESHOLD;
  // Strictly below the threshold, not merely at it — a gated match must
  // never register as pre-confirmed.
  const confidence = isWeak ? Math.min(raw, CONFIDENCE_THRESHOLD - 0.01) : raw;

  return Math.max(0, Math.min(1, confidence));
}

/**
 * Scores a block against every archetype's keyword signals and returns the best
 * match with a confidence derived from its margin over the runner-up.
 *
 * Column order is irrelevant: every candidate cell is scored independently, so
 * Gagarin (qty, price) and Collabo (price, qty) score identically.
 */
export function classifyBlock(grid: SheetGrid, range: CellRange): Classification {
  const candidates = candidateText(grid, range);
  const scores = emptyScores();

  for (const [archetype, signals] of Object.entries(LEXICON)) {
    let score = 0;
    for (const signal of signals) {
      // Count each signal at most once, so a repeated word cannot dominate.
      if (matches(candidates, signal.term)) score += signal.weight;
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

  const confidence = computeConfidence(best.score, runnerUp?.score ?? 0);

  return { archetype: best.archetype, confidence, scores };
}
