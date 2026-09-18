import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { uploads, sheets, blocks } from '@/db/schema/source';
import type { BlockArchetype } from '@/lib/classify/types';
import { createBudgetLine } from './budget';
import { createFundingTarget } from './funding';
import { createObligation } from './obligations';
import { recordEntry } from './ledger';
import {
  moneyOverview, fundraisingProgress, sourceKey, sourceIndexFor,
} from './overview';

let db: TestDb;
let s26: string;

const LEAD = 'lead@shliff.camp';

// Copied from trace.test.ts's `addSheet`/`addBlock` shape — the brief's
// `seedBlock` does not exist there either. Wrapped as one helper, because
// every case here wants a block and never a bare sheet.
async function seedBlock(
  database: TestDb,
  opts: { sheetName?: string; left?: number; archetype?: BlockArchetype } = {},
): Promise<string> {
  const sheetName = opts.sheetName ?? 'תנועות קופה';
  const left = opts.left ?? 1;
  const [up] = await database.insert(uploads).values({
    filename: 'קופת קאמפ 2026.xlsx', sha256: `sha/${sheetName}/${left}`,
    storageKey: `k/${sheetName}/${left}`, sizeBytes: 1, uploadedBy: LEAD,
    status: 'committed',
  }).returning();
  const [sheet] = await database.insert(sheets).values({
    uploadId: up.id, name: sheetName, index: 0, rowCount: 60, colCount: 8,
  }).returning();
  const [block] = await database.insert(blocks).values({
    sheetId: sheet.id, top: 1, left, bottom: 50, right: left + 3,
    archetype: opts.archetype ?? 'ledger', confidence: '1.0000',
    headerRow: null, fingerprint: null, pipelineVersion: 1, rawGrid: [['x']],
    confirmedBy: LEAD, confirmedAt: new Date(),
  }).returning();
  return block.id;
}

beforeEach(async () => {
  db = await createTestDb();
  s26 = (await createSeason(db, {
    name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35,
  })).id;
});

describe('fundraising progress', () => {
  it("measures raised money against the camp budget's share of the plan, not the whole plan", async () => {
    await createFundingTarget(db, {
      seasonId: s26, label: 'הורדת מחיר דמי קאמפ', amount: 22375.3,
      countsTowardCampBudget: true,
    });
    // Earmarked for the dancefloor. Counting it here would make this tile
    // argue with the sentence two bands above it.
    await createFundingTarget(db, { seasonId: s26, label: 'הגברה', amount: 35000 });
    await recordEntry(db, {
      occurredOn: new Date('2026-09-12T00:00:00Z'), direction: 'in', amount: 18500,
      description: 'מסיבת גיוס — אוקטובר', seasonId: s26, recordedBy: LEAD,
    });

    const progress = await fundraisingProgress(db, s26);
    expect(progress.targetAgorot).toBe(2237530);
    expect(progress.raisedAgorot).toBe(1850000);
    expect(progress.remainingAgorot).toBe(387530);
  });

  it('never reports a negative remainder once the target is passed', async () => {
    await createFundingTarget(db, {
      seasonId: s26, label: 'הורדת מחיר דמי קאמפ', amount: 1000,
      countsTowardCampBudget: true,
    });
    await recordEntry(db, {
      occurredOn: new Date('2026-09-12T00:00:00Z'), direction: 'in', amount: 1500,
      description: 'מסיבה', seasonId: s26, recordedBy: LEAD,
    });
    expect((await fundraisingProgress(db, s26)).remainingAgorot).toBe(0);
  });
});

describe('the open-decision count', () => {
  it('counts unnamed debts and arithmetic flags, and nothing else', async () => {
    await createObligation(db, {
      direction: 'camp_owes', description: 'מקפיא באיחסון נוסף', amount: 500,
      seasonId: s26, openedOn: null,
    });
    await createObligation(db, {
      direction: 'camp_owes', description: 'החזר לאורי', amount: 300,
      partyName: 'אורי', seasonId: s26, openedOn: null,
    });
    await createBudgetLine(db, {
      seasonId: s26, label: 'ביטוח ואישורים', quantityText: '5', quantityNum: 5,
      unitCost: 700, total: 3875, category: 'camp',
    });

    const overview = await moneyOverview(db, s26);
    expect(overview.decisions.unnamedCount).toBe(1);
    expect(overview.decisions.arithmeticCount).toBe(1);
    expect(overview.decisions.total).toBe(2);
  });
});

describe('the recent movements', () => {
  it('returns the five newest, newest first, and says how many there are in all', async () => {
    for (let day = 1; day <= 7; day += 1) {
      await recordEntry(db, {
        occurredOn: new Date(`2026-09-0${day}T00:00:00Z`), direction: 'out',
        amount: day * 100, description: `תנועה ${day}`, seasonId: s26,
        recordedBy: LEAD,
      });
    }

    const overview = await moneyOverview(db, s26);
    expect(overview.movementCount).toBe(7);
    expect(overview.recent).toHaveLength(5);
    expect(overview.recent.map((move) => move.description)).toEqual([
      'תנועה 7', 'תנועה 6', 'תנועה 5', 'תנועה 4', 'תנועה 3',
    ]);
  });
});

describe('the source index', () => {
  it('resolves one cell reference per promoted row and leaves a typed row unindexed', async () => {
    const blockId = await seedBlock(db, { sheetName: 'תנועות קופה', left: 1 });
    const entryId = await recordEntry(db, {
      occurredOn: new Date('2026-09-12T00:00:00Z'), direction: 'in', amount: 18500,
      description: 'מסיבת גיוס', seasonId: s26, recordedBy: LEAD,
      sourceBlockId: blockId, sourceRow: 41,
    });
    const typedId = await recordEntry(db, {
      occurredOn: new Date('2026-09-07T00:00:00Z'), direction: 'in', amount: 1200,
      description: 'דמי קאמפ', seasonId: s26, recordedBy: LEAD,
    });

    const index = await sourceIndexFor(db, [
      { table: 'ledger_entries', id: entryId, sourceBlockId: blockId },
      { table: 'ledger_entries', id: typedId, sourceBlockId: null },
    ]);

    expect(index.get(sourceKey('ledger_entries', entryId))!.reference)
      .toBe('תנועות קופה!A41');
    expect(index.get(sourceKey('ledger_entries', typedId))).toBeUndefined();
  });

  it('asks the trace module once per block, however many rows that block produced', async () => {
    const blockId = await seedBlock(db, {
      sheetName: 'תקציב 26', left: 3, archetype: 'budget_lines',
    });
    const ids: string[] = [];
    for (let row = 7; row <= 9; row += 1) {
      ids.push(await createBudgetLine(db, {
        seasonId: s26, label: `סעיף ${row}`, total: 1000, category: 'camp',
        sourceBlockId: blockId, sourceRow: row,
      }));
    }

    const index = await sourceIndexFor(db, ids.map((id) => ({
      table: 'budget_lines' as const, id, sourceBlockId: blockId,
    })));
    expect(index.size).toBe(3);
    expect(index.get(sourceKey('budget_lines', ids[0]))!.reference).toBe('תקציב 26!C7');
  });
});
