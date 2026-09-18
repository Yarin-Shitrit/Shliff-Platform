import { CONFIDENCE_THRESHOLD, type BlockArchetype } from '@/lib/classify/types';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { SheetState } from '@/lib/import/sheets';

/** The four archetypes Wave 2's promoter dispatches on (W6). The rest are
 *  refused with a stated reason and appear as parked, never silently absent. */
export const PROMOTABLE_ARCHETYPES: readonly BlockArchetype[] = [
  'ledger', 'budget_lines', 'ticket_rounds', 'obligations',
];

/**
 * Exactly one state per block, in W17's vocabulary. Both this screen's rail
 * and לטיפול's queue render from here, so the count of open decisions is one
 * number computed once rather than two numbers that drift.
 *
 * This vocabulary is deliberately finer than `src/lib/data/worklist.ts`'s
 * six states: `needs-review` and `recognised` are both `unconfirmed` there,
 * and `blocked` is part of its `refused`. The one fact the two must agree on
 * is what `promoted` means, and they do — rows counted in the four target
 * tables, never rows a dry run predicts.
 */
export type BlockState =
  | 'needs-review' | 'recognised' | 'confirmed' | 'promoted'
  | 'no-promoter' | 'superseded' | 'blocked';

/**
 * A block still needs a human only if nothing has reviewed it yet. Once a
 * signature auto-recognized it, or an admin confirmed it, it is resolved —
 * even if the column map it was confirmed with is empty.
 *
 * Lifted unchanged from the review page, where it was a private function, so
 * that the file list, the rail and לטיפול all answer this the same way.
 */
export function needsReview(
  confidence: number, mappingSource: string, columnMap: ColumnMapping[],
): boolean {
  return mappingSource === 'rules'
    && (confidence < CONFIDENCE_THRESHOLD || columnMap.length === 0);
}

/**
 * Precedence is first-match-wins, and the order is chosen so the most
 * actionable truth is the one on the pill. A superseded copy and a block with
 * no promoter can never promote, so saying so outranks saying it was
 * confirmed; an undecided sheet outranks both because it is the only one of
 * the three a lead can fix.
 */
export function blockState(input: {
  archetype: BlockArchetype;
  confidence: number;
  mappingSource: string;
  columnMap: ColumnMapping[];
  confirmedAt: Date | null;
  promotedRows: number;
  sheetState: SheetState;
}): BlockState {
  if (input.sheetState === 'superseded') return 'superseded';
  if (input.sheetState !== 'eligible') return 'blocked';
  if (!PROMOTABLE_ARCHETYPES.includes(input.archetype)) return 'no-promoter';
  if (input.promotedRows > 0) return 'promoted';
  if (input.confirmedAt !== null) return 'confirmed';
  if (needsReview(input.confidence, input.mappingSource, input.columnMap)) {
    return 'needs-review';
  }
  return 'recognised';
}
