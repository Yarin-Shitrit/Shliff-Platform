import type { SourceCell } from '@/lib/money/trace';
import type { SourceRef } from '@/components/ui/source-chip';

/**
 * A resolved source cell, in the shape the kit's `SourceChip` takes.
 *
 * `trace.ts` is the one place that *builds* a cell reference, and this does
 * not build a second one: `SourceCell.reference` is already
 * `${sheetName}!${col}${row}`, so the A1 address is that string with its own
 * `sheetName!` prefix removed — a slice of the authoritative answer rather
 * than a re-derivation from `blocks.left`. Two spellings of
 * `תנועות קופה!A41` would be two answers to where a number came from.
 *
 * `undefined` — a row whose `source_block_id` is null, so it never entered
 * the index — becomes `{ kind: 'manual' }`, which the chip renders as
 * `נרשם ידנית`. That is the true answer for a figure a lead typed, not a
 * missing one.
 */
export function chipSource(cell: SourceCell | undefined): SourceRef {
  if (cell === undefined) return { kind: 'manual' };
  return {
    kind: 'workbook',
    sheet: cell.sheetName,
    cell: cell.reference.slice(cell.sheetName.length + 1),
  };
}
