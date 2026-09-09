import { createHash } from 'node:crypto';
import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';
import { normalizeHebrew } from '@/lib/text/normalize';
import { PIPELINE_VERSION } from '@/lib/version';
import { headerRunEnd } from '@/lib/classify/header';

/**
 * Fingerprints a block's layout from its normalized header texts and header
 * column count.
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
 * full block range — the boundary is `headerRunEnd` from `header.ts`, the
 * single shared definition `mapColumns` also bounds itself to. detectBlocks
 * cuts on fully-empty columns, so a single populated "notes" column can keep
 * it from separating an unrelated table bolted onto the right of a real one
 * (e.g. the ברן 26 budget table gains a trailing payment-tracker table in one
 * workbook but not the other, because a notes column prevents the vertical
 * cut). The header row itself is blank at that boundary in both cases, so
 * stopping at the first blank header cell recovers the table's own layout
 * regardless of what XY-cut lumped in next to it. A signature and a mapping
 * must never disagree about where a block's own header ends — two blocks
 * sharing a fingerprint must be layouts the same stored mapping actually
 * fits — so this must stay imported from the one definition, not
 * reimplemented here.
 *
 * When the range has no header row at all (headerRow is null), or the very
 * first header cell is itself blank, `headerRunEnd` falls back to the full
 * range — there is nothing meaningful to trim to — so this hashes every
 * column's (normalized) header text rather than collapsing to an empty list.
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
    const runEnd = headerRunEnd(grid, range, headerRow);
    for (let col = range.left; col <= runEnd; col += 1) {
      const text = grid.cells[headerRow - 1]?.[col - 1]?.text ?? '';
      headers.push(normalizeHebrew(text).toLowerCase());
    }
  }

  // Header-run length when there was a header row (this already equals the
  // full range width in the no-usable-run fallback, since headerRunEnd
  // itself falls back to range.right); the raw range width when there was no
  // header row to measure a run against at all.
  const headerColumnCount = headers.length > 0 ? headers.length : range.right - range.left + 1;

  const payload = JSON.stringify({ v: PIPELINE_VERSION, width: headerColumnCount, headers });
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 32);
}
