import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import {
  ledgerEntries, budgetLines, ticketRounds, obligations,
} from '@/db/schema/money';
import { blocks, sheets, uploads } from '@/db/schema/source';
import { colLabel } from '@/lib/xlsx/col-label';
import { toAgorot } from '@/lib/money';

export interface SourceCell {
  blockId: string;
  sheetId: string;
  sheetName: string;
  filename: string;
  sheetRow: number;
  /** `סיכום כללי!A14` — the block's first column, at the row's absolute
   *  position in the sheet. */
  reference: string;
}

export interface TracedRow {
  table: 'ledger_entries' | 'budget_lines' | 'ticket_rounds' | 'obligations';
  id: string;
  label: string;
  amountAgorot: number;
  source: SourceCell | null;
}

interface BlockSourceInfo {
  blockId: string;
  sheetId: string;
  sheetName: string;
  filename: string;
  /** The block's first column, 1-indexed — see `blocks.left`. */
  left: number;
}

/**
 * The sheet and upload a block belongs to, once, so `traceBlock` does not
 * re-join for every row it produced.
 */
async function getBlockSourceInfo(db: AnyDb, blockId: string): Promise<BlockSourceInfo | null> {
  const [row] = await db
    .select({
      blockId: blocks.id,
      left: blocks.left,
      sheetId: sheets.id,
      sheetName: sheets.name,
      filename: uploads.filename,
    })
    .from(blocks)
    .innerJoin(sheets, eq(sheets.id, blocks.sheetId))
    .innerJoin(uploads, eq(uploads.id, sheets.uploadId))
    .where(eq(blocks.id, blockId));
  return row ?? null;
}

/**
 * `sourceRow` is the absolute 1-indexed sheet row, not an index into the
 * block — a block re-detected against a moved boundary must not change the
 * cell a figure points at.
 */
function buildSourceCell(info: BlockSourceInfo, sourceRow: number): SourceCell {
  return {
    blockId: info.blockId,
    sheetId: info.sheetId,
    sheetName: info.sheetName,
    filename: info.filename,
    sheetRow: sourceRow,
    reference: `${info.sheetName}!${colLabel(info.left)}${sourceRow}`,
  };
}

/**
 * Traces one promoted row back to the workbook cell it came from. Null
 * `sourceBlockId` — a row the seed wrote from a lead's adjudication, never a
 * workbook — traces to `null`, the honest answer, rather than a guess.
 */
export async function traceRow(
  db: AnyDb, table: TracedRow['table'], id: string,
): Promise<SourceCell | null> {
  let sourceBlockId: string | null;
  let sourceRow: number | null;

  switch (table) {
    case 'ledger_entries': {
      const [row] = await db.select({
        sourceBlockId: ledgerEntries.sourceBlockId, sourceRow: ledgerEntries.sourceRow,
      }).from(ledgerEntries).where(eq(ledgerEntries.id, id));
      if (!row) return null;
      ({ sourceBlockId, sourceRow } = row);
      break;
    }
    case 'budget_lines': {
      const [row] = await db.select({
        sourceBlockId: budgetLines.sourceBlockId, sourceRow: budgetLines.sourceRow,
      }).from(budgetLines).where(eq(budgetLines.id, id));
      if (!row) return null;
      ({ sourceBlockId, sourceRow } = row);
      break;
    }
    case 'ticket_rounds': {
      const [row] = await db.select({
        sourceBlockId: ticketRounds.sourceBlockId, sourceRow: ticketRounds.sourceRow,
      }).from(ticketRounds).where(eq(ticketRounds.id, id));
      if (!row) return null;
      ({ sourceBlockId, sourceRow } = row);
      break;
    }
    case 'obligations': {
      const [row] = await db.select({
        sourceBlockId: obligations.sourceBlockId, sourceRow: obligations.sourceRow,
      }).from(obligations).where(eq(obligations.id, id));
      if (!row) return null;
      ({ sourceBlockId, sourceRow } = row);
      break;
    }
    default:
      return null;
  }

  if (sourceBlockId === null || sourceRow === null) return null;
  const info = await getBlockSourceInfo(db, sourceBlockId);
  if (!info) return null;
  return buildSourceCell(info, sourceRow);
}

/**
 * Every row a block produced, across all four money tables — a block that
 * was re-picked from one archetype to another can own rows in more than one.
 */
export async function traceBlock(db: AnyDb, blockId: string): Promise<TracedRow[]> {
  const info = await getBlockSourceInfo(db, blockId);
  const sourceFor = (sourceRow: number | null): SourceCell | null => (
    info && sourceRow !== null ? buildSourceCell(info, sourceRow) : null
  );

  const results: TracedRow[] = [];

  const ledgerRows = await db.select({
    id: ledgerEntries.id, label: ledgerEntries.description,
    amount: ledgerEntries.amount, sourceRow: ledgerEntries.sourceRow,
  }).from(ledgerEntries).where(eq(ledgerEntries.sourceBlockId, blockId));
  for (const row of ledgerRows) {
    results.push({
      table: 'ledger_entries', id: row.id, label: row.label,
      amountAgorot: toAgorot(row.amount), source: sourceFor(row.sourceRow),
    });
  }

  const budgetRows = await db.select({
    id: budgetLines.id, label: budgetLines.label,
    amount: budgetLines.total, sourceRow: budgetLines.sourceRow,
  }).from(budgetLines).where(eq(budgetLines.sourceBlockId, blockId));
  for (const row of budgetRows) {
    results.push({
      table: 'budget_lines', id: row.id, label: row.label,
      amountAgorot: toAgorot(row.amount), source: sourceFor(row.sourceRow),
    });
  }

  const ticketRows = await db.select({
    id: ticketRounds.id, label: ticketRounds.label,
    amount: ticketRounds.total, sourceRow: ticketRounds.sourceRow,
  }).from(ticketRounds).where(eq(ticketRounds.sourceBlockId, blockId));
  for (const row of ticketRows) {
    results.push({
      table: 'ticket_rounds', id: row.id, label: row.label,
      amountAgorot: toAgorot(row.amount), source: sourceFor(row.sourceRow),
    });
  }

  const obligationRows = await db.select({
    id: obligations.id, label: obligations.description,
    amount: obligations.amount, sourceRow: obligations.sourceRow,
  }).from(obligations).where(eq(obligations.sourceBlockId, blockId));
  for (const row of obligationRows) {
    results.push({
      table: 'obligations', id: row.id, label: row.label,
      amountAgorot: toAgorot(row.amount), source: sourceFor(row.sourceRow),
    });
  }

  return results;
}
