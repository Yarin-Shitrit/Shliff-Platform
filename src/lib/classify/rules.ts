import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';
import { normalizeHebrew } from '@/lib/text/normalize';
import { LEXICON } from './lexicon';
import {
  BLOCK_ARCHETYPES,
  CONFIDENCE_THRESHOLD,
  type BlockArchetype,
  type Classification,
} from './types';

/** How many leading rows of a block count as potential headers. */
const HEADER_ROWS = 3;

/** Leading/trailing characters stripped off a token before comparing it to a
 * single-word lexicon term. Only letters and digits survive at the edges, so
 * `סה"כ` and `עו"ש` keep their *internal* punctuation (they are never split,
 * since we only ever strip the leading and trailing run), while a token like
 * `(1000)` or `שולם.` loses its wrapping punctuation. */
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Splits normalized cell text into whole words for single-word lexicon
 * matching. Splits on whitespace ONLY — never on internal punctuation — so
 * `סה"כ קיזוז` yields the two tokens `סה"כ` and `קיזוז`, not four fragments.
 */
function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.replace(EDGE_PUNCTUATION, ''))
    .filter((token) => token !== '');
}

interface Candidates {
  /** Normalized, lowercased full cell text — used for multi-word (phrase) matching. */
  texts: string[];
  /** Whole tokens out of every candidate cell — used for single-word matching. */
  tokens: Set<string>;
}

/**
 * Collects the text a classifier should look at: the block's first rows (for
 * header rows) and its first column (for header columns, as in בצרה where the
 * category label sits on the right and the labels run down column A).
 */
function candidateText(grid: SheetGrid, range: CellRange): Candidates {
  const texts: string[] = [];
  const tokens = new Set<string>();

  const addCell = (raw: string): void => {
    if (raw === '') return;
    const normalized = normalizeHebrew(raw).toLowerCase();
    texts.push(normalized);
    for (const token of tokenize(normalized)) tokens.add(token);
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

  return { texts, tokens };
}

/**
 * Whether a lexicon term is found among the block's candidate text.
 *
 * Single-word terms (no space, e.g. `חוב`, `ביט`) must equal a whole token —
 * plain substring matching let short Hebrew roots false-match inside
 * unrelated words (`ביט` inside `ביטים` "drill bits", `בר` inside `ברגים`
 * "screws" or `חבר` "member"). Multi-word terms (e.g. `כמות יחידות`) keep
 * substring matching against the full cell text: they are long enough that
 * accidental containment is not a realistic risk, and splitting them into
 * tokens would require the words to be adjacent-and-exact anyway.
 */
function matches(candidates: Candidates, term: string): boolean {
  const needle = normalizeHebrew(term).toLowerCase();
  if (needle.includes(' ')) {
    return candidates.texts.some((text) => text.includes(needle));
  }
  const [needleToken] = tokenize(needle);
  return needleToken !== undefined && candidates.tokens.has(needleToken);
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
