import type { BlockArchetype } from '@/lib/classify/types';
import type { BudgetCategory } from '@/db/schema/money';

/** Every reason the promoter can decline to write a row. */
export type RefusalReason =
  | 'carry-forward'
  | 'total-row'
  | 'blank-row'
  | 'no-amount'
  | 'both-directions'
  | 'no-date'
  | 'no-description'
  | 'no-label'
  | 'no-season'
  /** The block has not been approved by a lead yet. Distinct from
   *  `unmapped-column`: the mapping may be perfect and merely unapproved. */
  | 'unconfirmed'
  | 'unmapped-column'
  | 'no-promoter'
  | 'sheet-undecided'
  | 'sheet-ambiguous'
  | 'sheet-superseded'
  /** A signed amount appears in a direction-carrying column. The column
   *  name already specifies the direction, so a negative sign cannot be
   *  resolved without guessing at intent. Refuse rather than flip. */
  | 'negative-amount'
  /** A value the target column cannot hold: money beyond `numeric(12,2)`, a
   *  count beyond Postgres `integer`, or a count that is not a whole number
   *  at all — `ticket_rounds.quantity` is `integer`, so `0.3333333333` is as
   *  unstorable as `3000000000` and is refused rather than rounded to 0.
   *  Refused before the dry-run branch, so a dry run never reports a row that
   *  a commit would fail on. */
  | 'out-of-range';

export interface Refusal {
  /** Absolute 1-indexed sheet row, or the block's own top row for a
   *  whole-block refusal. */
  sheetRow: number;
  reason: RefusalReason;
  /** Hebrew, shown to a lead in the register. */
  message: string;
  /** The row exactly as it appeared, so the register can show the evidence. */
  cells: string[];
}

export interface PromotedRow {
  table: 'ledger_entries' | 'budget_lines' | 'ticket_rounds' | 'obligations';
  sheetRow: number;
  /** Null on a dry run — nothing was written, so there is no id to give. */
  id: string | null;
  /** Hebrew one-liner for the register. */
  summary: string;
  /** Things true of this row that are not refusals: an unresolved party
   *  name kept as raw text, an arithmetic mismatch flagged and kept. */
  notes: string[];
}

/**
 * A row this block no longer produces, kept because something else depends
 * on it. Deleting it would cascade or silently unlink a decision a lead made
 * that the sheet cannot recreate — a settlement, a task's budget line.
 */
export interface RetainedRow {
  table: PromotedRow['table'];
  id: string;
  /** The row's `source_row`. */
  sheetRow: number | null;
  /** Hebrew, naming what depends on the row. */
  reason: string;
}

/**
 * A confirmed block `promoteBlock` did not promote or refuse this run, and
 * why — currently only a retired sheet (R43). Also what a bulk run
 * (`promoteAll`, `promoteAllGated`) reports for a block it skipped, whether
 * that skip bubbled up from `promoteBlock` (a retired sheet) or was decided
 * by the bulk run's own gate before ever calling it (`promoteAllGated`'s
 * already-owns-rows check). One shape either way — a second, parallel skip
 * vocabulary is how a register ends up unable to explain itself.
 */
export interface SkippedBlock {
  blockId: string;
  /** Machine-readable, so a caller can branch without string-matching the
   *  Hebrew `reason`. */
  code: 'already-promoted' | 'sheet-retired';
  /** For `already-promoted`, the count from `promotedRowCounts` that decided
   *  the skip — not recomputed. For `sheet-retired`, the block's current row
   *  count, reported for context (so a lead can see nothing was lost), but
   *  not itself the reason for the skip: retirement skips a block whether it
   *  owns zero rows or many. */
  rowCount: number;
  /** Hebrew, shown to a lead in the register. */
  reason: string;
}

export interface PromotionResult {
  blockId: string;
  archetype: BlockArchetype;
  dryRun: boolean;
  written: PromotedRow[];
  refused: Refusal[];
  /** Rows removed because this block no longer produces them (W5), in any
   *  of the four target tables. On a dry run, the rows a commit would
   *  remove; nothing is removed. */
  deleted: number;
  /** Rows this block no longer produces but that were kept because
   *  something references them. Filled on a dry run too. A plain array, so
   *  results for several blocks concatenate. */
  retained: RetainedRow[];
  /**
   * Set instead of writing, refusing, deleting, or retaining anything, when
   * `promoteBlock` skipped this block rather than promoting or refusing it
   * (R43: a retired sheet). `written`, `refused`, `deleted`, and `retained`
   * are always at their empty/zero defaults whenever this is set — a skip
   * touches nothing, which is the whole point of it being a skip and not a
   * refusal (a refusal releases the block's rows; see `promoteWithin` in
   * promote.ts). Undefined for every ordinary promote-or-refuse outcome, so
   * existing callers that only ever read `written`/`refused`/etc. keep
   * working unchanged.
   */
  skip?: SkippedBlock;
}

export interface PromoteContext {
  /** Null is legal for ledger and obligations; budget and tickets refuse. */
  seasonId: string | null;
  recordedBy: string;
  blockId: string;
  /**
   * The block mapping's stored budget category decision (Task 15) — a lead's
   * statement of which budget this block is, never inferred. Undefined or
   * null both mean "no decision stored"; `budgetRow` defaults either to
   * `'camp'`, so every existing caller keeps working.
   */
  budgetCategory?: BudgetCategory | null;
}
