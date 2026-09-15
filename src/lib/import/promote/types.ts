import type { BlockArchetype } from '@/lib/classify/types';

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
  | 'sheet-superseded';

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

export interface PromotionResult {
  blockId: string;
  archetype: BlockArchetype;
  dryRun: boolean;
  written: PromotedRow[];
  refused: Refusal[];
  /** Rows removed because this block no longer produces them (W5). */
  deleted: number;
}

export interface PromoteContext {
  /** Null is legal for ledger and obligations; budget and tickets refuse. */
  seasonId: string | null;
  recordedBy: string;
  blockId: string;
}
