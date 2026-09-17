import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { uploads, sheets, blocks } from '@/db/schema/source';
import {
  ledgerEntries, budgetLines, ticketRounds, obligations,
} from '@/db/schema/money';
import type { BlockArchetype } from '@/lib/classify/types';
import { toAgorot } from '@/lib/money';
import { traceRow, traceBlock } from './trace';

let db: TestDb;
let seasonId: string;

const LEAD = 'lead@shliff.test';

async function addSheet(filename: string, name: string): Promise<string> {
  const [up] = await db.insert(uploads).values({
    filename, sha256: `${filename}/${name}`, storageKey: `k/${name}`,
    sizeBytes: 1, uploadedBy: LEAD, status: 'committed',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: up.id, name, index: 0, rowCount: 20, colCount: 6,
  }).returning();
  return sheet.id;
}

async function addBlock(
  onSheet: string, archetype: BlockArchetype, opts: { top?: number; left?: number } = {},
): Promise<string> {
  const top = opts.top ?? 1;
  const left = opts.left ?? 1;
  const [block] = await db.insert(blocks).values({
    sheetId: onSheet, top, left, bottom: top, right: left,
    archetype, confidence: '1.0000', headerRow: null, fingerprint: null,
    pipelineVersion: 1, rawGrid: [['x']],
    confirmedBy: LEAD, confirmedAt: new Date(),
  }).returning();
  return block.id;
}

beforeEach(async () => {
  db = await createTestDb();
  seasonId = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35 })).id;
});

describe('traceRow', () => {
  it('a promoted ledger row traces to its sheet and row', async () => {
    const sheetId = await addSheet('2026.xlsx', 'סיכום כללי');
    const blockId = await addBlock(sheetId, 'ledger', { top: 1, left: 2 });
    const [entry] = await db.insert(ledgerEntries).values({
      occurredOn: new Date('2026-01-01T00:00:00Z'), direction: 'in', amount: '100.00',
      description: 'תרומה', recordedBy: LEAD, sourceBlockId: blockId, sourceRow: 4,
    }).returning();

    const source = await traceRow(db, 'ledger_entries', entry.id);

    expect(source).not.toBeNull();
    expect(source!.blockId).toBe(blockId);
    expect(source!.sheetId).toBe(sheetId);
    expect(source!.sheetName).toBe('סיכום כללי');
    expect(source!.filename).toBe('2026.xlsx');
    expect(source!.sheetRow).toBe(4);
    expect(source!.reference).toBe('סיכום כללי!B4');
  });

  it('the reference string is exactly סיכום כללי!A6 for a block at left: 1, top: 5, row 6', async () => {
    const sheetId = await addSheet('2026.xlsx', 'סיכום כללי');
    const blockId = await addBlock(sheetId, 'ledger', { top: 5, left: 1 });
    const [entry] = await db.insert(ledgerEntries).values({
      occurredOn: new Date('2026-01-01T00:00:00Z'), direction: 'out', amount: '50.00',
      description: 'הוצאה', recordedBy: LEAD, sourceBlockId: blockId, sourceRow: 6,
    }).returning();

    const source = await traceRow(db, 'ledger_entries', entry.id);

    expect(source!.reference).toBe('סיכום כללי!A6');
  });

  it('a seeded row with no source_block_id traces to null', async () => {
    const [entry] = await db.insert(ledgerEntries).values({
      occurredOn: new Date('2026-01-01T00:00:00Z'), direction: 'in', amount: '1200.00',
      description: 'דמי חבר — נרשם ידנית', recordedBy: LEAD,
    }).returning();

    const source = await traceRow(db, 'ledger_entries', entry.id);

    expect(source).toBeNull();
  });
});

describe('traceBlock', () => {
  it('returns every row the block produced across all four tables', async () => {
    const sheetId = await addSheet('2026.xlsx', 'סיכום כללי');
    const blockId = await addBlock(sheetId, 'ledger', { top: 1, left: 1 });

    const [entry] = await db.insert(ledgerEntries).values({
      occurredOn: new Date('2026-01-01T00:00:00Z'), direction: 'in', amount: '100.00',
      description: 'תרומה', recordedBy: LEAD, sourceBlockId: blockId, sourceRow: 2,
    }).returning();
    const [budgetLine] = await db.insert(budgetLines).values({
      seasonId, label: 'ציוד', total: '250.00', category: 'camp',
      sourceBlockId: blockId, sourceRow: 3,
    }).returning();
    const [ticketRound] = await db.insert(ticketRounds).values({
      seasonId, label: 'סבב א', total: '500.00',
      sourceBlockId: blockId, sourceRow: 4,
    }).returning();
    const [obligation] = await db.insert(obligations).values({
      direction: 'camp_owes', description: 'חוב יוסף', amount: '300.00',
      sourceBlockId: blockId, sourceRow: 5,
    }).returning();

    const rows = await traceBlock(db, blockId);

    expect(rows).toHaveLength(4);

    const byTable = Object.fromEntries(rows.map((r) => [r.table, r]));

    expect(byTable.ledger_entries).toMatchObject({
      id: entry.id, label: 'תרומה', amountAgorot: toAgorot('100.00'),
    });
    expect(byTable.ledger_entries.source).toMatchObject({ sheetRow: 2, reference: 'סיכום כללי!A2' });

    expect(byTable.budget_lines).toMatchObject({
      id: budgetLine.id, label: 'ציוד', amountAgorot: toAgorot('250.00'),
    });
    expect(byTable.budget_lines.source).toMatchObject({ sheetRow: 3, reference: 'סיכום כללי!A3' });

    expect(byTable.ticket_rounds).toMatchObject({
      id: ticketRound.id, label: 'סבב א', amountAgorot: toAgorot('500.00'),
    });
    expect(byTable.ticket_rounds.source).toMatchObject({ sheetRow: 4, reference: 'סיכום כללי!A4' });

    expect(byTable.obligations).toMatchObject({
      id: obligation.id, label: 'חוב יוסף', amountAgorot: toAgorot('300.00'),
    });
    expect(byTable.obligations.source).toMatchObject({ sheetRow: 5, reference: 'סיכום כללי!A5' });
  });

  it('on a block that produced nothing returns an empty array', async () => {
    const sheetId = await addSheet('2026.xlsx', 'סיכום כללי');
    const blockId = await addBlock(sheetId, 'ledger', { top: 1, left: 1 });

    const rows = await traceBlock(db, blockId);

    expect(rows).toEqual([]);
  });
});
