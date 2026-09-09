import { createHash } from 'node:crypto';
import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';
import { normalizeHebrew } from '@/lib/text/normalize';
import { PIPELINE_VERSION } from '@/lib/version';

/**
 * Fingerprints a block's layout from its normalized header texts and width.
 *
 * Two blocks with the same fingerprint have the same shape and headers, so a
 * mapping confirmed for one can be reused for the other — this is how a
 * correction made once is applied automatically next year.
 *
 * The fingerprint is order-sensitive by design: Gagarin (qty, price) and
 * Collabo (price, qty) are genuinely different layouts needing different
 * mappings, and must not share a signature.
 *
 * Only the leading contiguous run of non-blank header cells is used, not the
 * full block range. detectBlocks cuts on fully-empty columns, so a single
 * populated "notes" column can keep it from separating an unrelated table
 * bolted onto the right of a real one (e.g. the ברן 26 budget table gains a
 * trailing payment-tracker table in one workbook but not the other, because a
 * notes column prevents the vertical cut). The header row itself is blank at
 * that boundary in both cases, so stopping at the first blank header cell
 * recovers the table's own layout regardless of what XY-cut lumped in next to
 * it. When the range has no header at all (headerRow is null) or the very
 * first header cell is blank, there is nothing meaningful to trim to, so the
 * full range width is used instead.
 *
 * PIPELINE_VERSION is included so that changing parsing logic invalidates old
 * signatures rather than silently reusing a mapping derived under different rules.
 */
export function layoutFingerprint(
  grid: SheetGrid,
  range: CellRange,
  headerRow: number | null,
): string {
  const headers: string[] = [];

  if (headerRow !== null) {
    for (let col = range.left; col <= range.right; col += 1) {
      const text = grid.cells[headerRow - 1]?.[col - 1]?.text ?? '';
      if (text === '') break;
      headers.push(normalizeHebrew(text).toLowerCase());
    }
  }

  const width = headers.length > 0 ? headers.length : range.right - range.left + 1;

  const payload = JSON.stringify({ v: PIPELINE_VERSION, width, headers });
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 32);
}
