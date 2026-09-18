import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets, blocks, blockMappings } from '@/db/schema/source';
import { seasons, tasks } from '@/db/schema/camp';
import { ledgerEntries, budgetLines } from '@/db/schema/money';
import { BLOCK_ARCHETYPES } from '@/lib/classify/types';
import { promoteBlock } from '@/lib/import/promote/promote';
import {
  needsReview, blockState, PROMOTABLE_ARCHETYPES,
  blockStates, sheetLabels, promotedRowCounts, promoteUpload, blockGrid,
} from './register';
import { summarise } from './review';

const LEAD = 'lead@shliff.test';

async function makeUpload(db: TestDb, filename: string, sha: string) {
  const [row] = await db.insert(uploads).values({
    filename, sha256: sha.padEnd(64, '0'), storageKey: `uploads/${sha}.xlsx`,
    sizeBytes: 1024, uploadedBy: LEAD,
  }).returning();
  return row;
}

async function makeSheet(
  db: TestDb, uploadId: string, name: string, seasonId: string | null = null,
) {
  const [row] = await db.insert(sheets).values({
    uploadId, name, index: 0, rowCount: 60, colCount: 8, seasonId,
  }).returning();
  return row;
}

async function makeBlock(
  db: TestDb, sheetId: string, over: Partial<typeof blocks.$inferInsert> = {},
) {
  const [row] = await db.insert(blocks).values({
    sheetId, top: 3, left: 1, bottom: 61, right: 8,
    archetype: 'ledger', confidence: '0.9000', headerRow: 3,
    fingerprint: null, pipelineVersion: 1,
    rawGrid: [['תאריך', 'פירוט', 'יצא', 'נכנס']],
    ...over,
  }).returning();
  await db.insert(blockMappings).values({
    blockId: row.id, columnMap: [{ column: 1, field: 'date', confidence: 1 }],
    source: 'rules',
  });
  return row;
}

const base = {
  archetype: 'ledger' as const,
  confidence: 1,
  mappingSource: 'admin',
  columnMap: [{ column: 1, field: 'date', confidence: 1 }],
  confirmedAt: new Date('2026-09-12T10:00:00Z'),
  promotedRows: 0,
  sheetState: 'eligible' as const,
};

describe('needsReview', () => {
  it('sends a rules-mapped block below the threshold to a human', () => {
    expect(needsReview(0.3, 'rules', [{ column: 1, field: 'date', confidence: 1 }])).toBe(true);
  });

  it('sends a rules-mapped block with no columns to a human, however confident', () => {
    expect(needsReview(0.95, 'rules', [])).toBe(true);
  });

  it('leaves a signature-recognised block alone even with an empty map', () => {
    expect(needsReview(1, 'signature', [])).toBe(false);
  });
});

describe('blockState precedence', () => {
  it('calls a non-authoritative copy superseded before anything else', () => {
    expect(blockState({ ...base, sheetState: 'superseded', promotedRows: 9 }))
      .toBe('superseded');
  });

  it('calls a block on an undecided sheet blocked, even when confirmed', () => {
    expect(blockState({ ...base, sheetState: 'undecided' })).toBe('blocked');
    expect(blockState({ ...base, sheetState: 'ambiguous' })).toBe('blocked');
  });

  it('calls an archetype with no promoter no-promoter, even when confirmed', () => {
    expect(blockState({ ...base, archetype: 'income_channels' })).toBe('no-promoter');
    expect(blockState({ ...base, archetype: 'unknown' })).toBe('no-promoter');
  });

  it('calls an unreviewed block needs-review even when its archetype has no promoter', () => {
    // The archetype is exactly what the review changes, so an unconfirmed
    // `unknown` block is an open decision, not a dead end. Break this and a
    // file whose tables all classified `unknown` reports zero open decisions,
    // offers no block for המשך סקירה to open, and reviewStep calls it finished.
    expect(blockState({
      ...base, archetype: 'unknown', confirmedAt: null,
      confidence: 0.2, mappingSource: 'rules', columnMap: [],
    })).toBe('needs-review');
  });

  it('calls an unconfirmed, well-mapped block with no promoter recognised', () => {
    expect(blockState({ ...base, archetype: 'income_channels', confirmedAt: null }))
      .toBe('recognised');
  });

  it('calls a block with rows in the database promoted', () => {
    expect(blockState({ ...base, promotedRows: 52 })).toBe('promoted');
  });

  it('calls a confirmed block with no rows yet confirmed', () => {
    expect(blockState(base)).toBe('confirmed');
  });

  it('calls an unconfirmed block that needs a human needs-review', () => {
    expect(blockState({
      ...base, confirmedAt: null, confidence: 0.3, mappingSource: 'rules',
    })).toBe('needs-review');
  });

  it('calls an unconfirmed, well-mapped block recognised', () => {
    expect(blockState({ ...base, confirmedAt: null })).toBe('recognised');
  });

  it('lists exactly the four archetypes Wave 2 promotes', () => {
    expect([...PROMOTABLE_ARCHETYPES].sort())
      .toEqual(['budget_lines', 'ledger', 'obligations', 'ticket_rounds']);
  });
});

describe('blockStates', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('renders the A1 range a lead can find in Excel', async () => {
    const upload = await makeUpload(db, 'קופת קאמפ 2026.xlsx', 'a');
    const sheet = await makeSheet(db, upload.id, 'סיכום כללי');
    await makeBlock(db, sheet.id);

    const [row] = await blockStates(db, upload.id);
    expect(row.range).toBe('A3:H61');
    expect(row.rowCount).toBe(59);
    expect(row.sheetName).toBe('סיכום כללי');
  });

  it('counts the rows a block actually wrote, not the rows it could write', async () => {
    const upload = await makeUpload(db, 'x.xlsx', 'b');
    const sheet = await makeSheet(db, upload.id, 'תנועות');
    const block = await makeBlock(db, sheet.id);
    await db.insert(ledgerEntries).values([
      { occurredOn: new Date('2026-07-05T00:00:00Z'), direction: 'out',
        amount: '4200.00', description: 'תשלום גנרטור', recordedBy: LEAD,
        sourceBlockId: block.id, sourceRow: 4 },
      { occurredOn: new Date('2026-07-08T00:00:00Z'), direction: 'out',
        amount: '1860.00', description: 'קניות מטבח', recordedBy: LEAD,
        sourceBlockId: block.id, sourceRow: 5 },
    ]);

    const counts = await promotedRowCounts(db);
    expect(counts.get(block.id)).toBe(2);
    const [row] = await blockStates(db, upload.id);
    expect(row.promotedRows).toBe(2);
    expect(row.state).toBe('promoted');
  });

  it('marks the copy that lost the authority decision superseded', async () => {
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    const first = await makeUpload(db, "קופת קאמפ 25’.xlsx", 'c');
    const second = await makeUpload(db, 'קופת קאמפ 2026.xlsx', 'd');
    const kept = await makeSheet(db, first.id, 'תקציב קאמפ ברן 26', season.id);
    const lost = await makeSheet(db, second.id, 'תקציב קאמפ ברן 26', season.id);
    await db.update(sheets).set({ authoritative: true })
      .where(eq(sheets.id, kept.id));
    await makeBlock(db, kept.id, { archetype: 'budget_lines' });
    await makeBlock(db, lost.id, { archetype: 'budget_lines' });

    const [keptBlock] = await blockStates(db, first.id);
    const [lostBlock] = await blockStates(db, second.id);
    expect(keptBlock.state).toBe('recognised');
    expect(lostBlock.state).toBe('superseded');
  });

  it('reports every upload when no upload is named', async () => {
    const first = await makeUpload(db, 'a.xlsx', 'e');
    const second = await makeUpload(db, 'b.xlsx', 'f');
    await makeBlock(db, (await makeSheet(db, first.id, 'א')).id);
    await makeBlock(db, (await makeSheet(db, second.id, 'ב')).id);
    expect(await blockStates(db)).toHaveLength(2);
  });

  it('agrees with the promoter about which archetypes have a promoter', async () => {
    const upload = await makeUpload(db, 'all.xlsx', 'g');
    const sheet = await makeSheet(db, upload.id, 'הכול');
    for (const archetype of BLOCK_ARCHETYPES) {
      await makeBlock(db, sheet.id, {
        archetype, confirmedBy: LEAD, confirmedAt: new Date(), confidence: '1.0000',
      });
    }

    const rows = await blockStates(db, upload.id);
    expect(rows).toHaveLength(BLOCK_ARCHETYPES.length);
    for (const row of rows) {
      const result = await promoteBlock(db, row.blockId, {
        dryRun: true, recordedBy: LEAD,
      });
      const promoterRefused = result.refused.some((r) => r.reason === 'no-promoter');
      expect(promoterRefused).toBe(row.state === 'no-promoter');
    }
  });
});

describe('sheetLabels', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('reports a sheet with no season as having none, and keeps it eligible', async () => {
    const upload = await makeUpload(db, 'x.xlsx', 'h');
    await makeSheet(db, upload.id, 'מסיבות');

    const [label] = await sheetLabels(db, upload.id);
    expect(label.seasonId).toBeNull();
    expect(label.seasonName).toBeNull();
    expect(label.state).toBe('eligible');
  });

  it('names the sheets a colliding copy is contested with', async () => {
    const first = await makeUpload(db, "25’.xlsx", 'i');
    const second = await makeUpload(db, '2026.xlsx', 'j');
    const a = await makeSheet(db, first.id, 'תקציב קאמפ ברן 26');
    const b = await makeSheet(db, second.id, 'תקציב קאמפ ברן 26');

    const [label] = await sheetLabels(db, first.id);
    expect(label.state).toBe('undecided');
    expect(label.contestedWith).toEqual([b.id]);
    expect(a.id).not.toBe(b.id);
  });
});

describe('promoteUpload', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('writes nothing on a dry run and reports what a commit would write', async () => {
    const upload = await makeUpload(db, 'קופת קאמפ 2026.xlsx', 'k');
    const sheet = await makeSheet(db, upload.id, 'תנועות קופה');
    await makeBlock(db, sheet.id, {
      top: 1, bottom: 3, left: 1, right: 4, headerRow: 1,
      confirmedBy: LEAD, confirmedAt: new Date(), confidence: '1.0000',
      rawGrid: [
        ['תאריך', 'פירוט', 'הוצאות', 'הכנסות'],
        ['05/07/2026', 'תשלום גנרטור', '4200', ''],
        ['', 'סה"כ', '4200', ''],
      ],
    });
    await db.update(blockMappings).set({
      source: 'admin',
      columnMap: [
        { column: 1, field: 'date', confidence: 1 },
        { column: 2, field: 'description', confidence: 1 },
        { column: 3, field: 'outflow', confidence: 1 },
        { column: 4, field: 'inflow', confidence: 1 },
      ],
    });

    const dry = await promoteUpload(db, upload.id, { dryRun: true, recordedBy: LEAD });
    const counts = summarise(dry);
    expect(counts.blocks).toBe(1);
    expect(counts.written).toBe(1);
    expect(counts.refused).toBe(1);
    expect(await promotedRowCounts(db)).toEqual(new Map());
  });

  it('skips a block nobody has confirmed rather than reporting it refused', async () => {
    const upload = await makeUpload(db, 'x.xlsx', 'l');
    const sheet = await makeSheet(db, upload.id, 'א');
    await makeBlock(db, sheet.id);

    expect(await promoteUpload(db, upload.id, { dryRun: true, recordedBy: LEAD }))
      .toEqual([]);
  });

  it('never reaches another file’s blocks', async () => {
    const mine = await makeUpload(db, 'שלי.xlsx', 'm');
    const theirs = await makeUpload(db, 'שלהם.xlsx', 'n');
    const mySheet = await makeSheet(db, mine.id, 'א');
    const theirSheet = await makeSheet(db, theirs.id, 'ב');
    await makeBlock(db, mySheet.id, {
      confirmedBy: LEAD, confirmedAt: new Date(), confidence: '1.0000',
    });
    await makeBlock(db, theirSheet.id, {
      confirmedBy: LEAD, confirmedAt: new Date(), confidence: '1.0000',
    });

    const results = await promoteUpload(db, mine.id, { dryRun: true, recordedBy: LEAD });
    const mineBlocks = await blockStates(db, mine.id);
    expect(results).toHaveLength(1);
    expect(results[0].blockId).toBe(mineBlocks[0].blockId);
  });
});

/**
 * A34: the per-file button covers `confirmed` blocks only, and the reason is
 * not tidiness — it is that a re-promotion can leave two copies of the same
 * money standing.
 *
 * `promoteBlock` sweeps a block's prior rows before writing, so a re-run is
 * normally a replacement. The exception is a row something else references:
 * that one is `retained`, not deleted. When the re-run then produces rows the
 * old ones did not cover, the retained rows stay and the new ones land beside
 * them — the count grows, and the growth is money counted twice.
 *
 * The workbook below is the shape A23 recorded: a dancefloor budget with two
 * cost columns, promoted off the wrong one, its lines carrying task references
 * and no foreign key. Fixing the column map is the blessed reason to re-run
 * (W4/W5) and is exactly what makes the retained rows bite.
 */
describe('promoteUpload and an already-promoted block (A34)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  const DANCEFLOOR_GRID = [
    ['פריט', 'עלות ברן 25', 'עלות ברן 26'],
    ['רחבה — הגברה', '42000', ''],
    ['רחבה — תאורה', '22375.30', ''],
    ['רחבה — הגברה', '', '30000'],
    ['רחבה — תאורה', '', '25000'],
  ];

  /** The column a lead first mapped as the total: ברן 25's. */
  const COL_25 = [
    { column: 1, field: 'item', confidence: 1 },
    { column: 2, field: 'total', confidence: 1 },
  ];
  /** The column they meant, corrected on the review screen. */
  const COL_26 = [
    { column: 1, field: 'item', confidence: 1 },
    { column: 3, field: 'total', confidence: 1 },
  ];

  /** 42,000 + 22,375.30, in agorot — ברן 26's whole budget, per A23. */
  const BERN_25_AGOROT = 6_437_530;
  /** 30,000 + 25,000, in agorot: what the corrected map produces. */
  const BERN_26_AGOROT = 5_500_000;

  async function dancefloorUpload() {
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    const upload = await makeUpload(db, 'קופת קאמפ 2026.xlsx', 'a34');
    const sheet = await makeSheet(db, upload.id, 'תקציב רחבה', season.id);
    const block = await makeBlock(db, sheet.id, {
      archetype: 'budget_lines', top: 1, bottom: 5, left: 1, right: 3, headerRow: 1,
      confirmedBy: LEAD, confirmedAt: new Date(), confidence: '1.0000',
      rawGrid: DANCEFLOOR_GRID,
    });
    await db.update(blockMappings)
      .set({ source: 'admin', columnMap: COL_25, budgetCategory: 'dancefloor' })
      .where(eq(blockMappings.blockId, block.id));
    return { season, upload, block };
  }

  /** What the camp's budget actually holds right now. */
  async function linesNow() {
    const rows = await db.select().from(budgetLines).orderBy(budgetLines.sourceRow);
    return {
      count: rows.length,
      ids: rows.map((row) => row.id),
      agorot: rows.reduce((n, row) => n + Math.round(Number(row.total) * 100), 0),
    };
  }

  /** A task against every line: the reference that makes a row `retained`. */
  async function assignTasks(seasonId: string) {
    const rows = await db.select().from(budgetLines);
    for (const line of rows) {
      await db.insert(tasks).values({
        seasonId, kind: 'deliverable', title: `רחבה: ${line.label}`,
        budgetLineId: line.id,
      });
    }
  }

  async function fixTheColumnMap(blockId: string) {
    await db.update(blockMappings).set({ columnMap: COL_26 })
      .where(eq(blockMappings.blockId, blockId));
  }

  it('leaves the rows of an already-promoted block exactly as they were', async () => {
    const { season, upload, block } = await dancefloorUpload();
    await promoteUpload(db, upload.id, { dryRun: false, recordedBy: LEAD });
    const before = await linesNow();
    expect(before.count).toBe(2);
    expect(before.agorot).toBe(BERN_25_AGOROT);

    await assignTasks(season.id);
    await fixTheColumnMap(block.id);

    await promoteUpload(db, upload.id, { dryRun: false, recordedBy: LEAD });

    // Not "the same number of rows": the same rows. A sweep that deleted two
    // and wrote two would also count 2, and would not be what happened here.
    // Asserted as one shape so a regression prints the count, the identities
    // and the money together — the three facts a lead would be lied to about.
    expect(await linesNow()).toEqual(before);
  });

  it('still promotes a confirmed block that has never been promoted', async () => {
    const { upload } = await dancefloorUpload();

    const results = await promoteUpload(db, upload.id, { dryRun: false, recordedBy: LEAD });

    expect(results).toHaveLength(1);
    const after = await linesNow();
    expect(after.count).toBe(2);
    expect(after.agorot).toBe(BERN_25_AGOROT);
  });

  /**
   * The per-block path stays, and this is what it does: the review screen
   * renders `retained` and `deleted` before a lead presses it, so the four
   * rows below are a known outcome rather than a surprise behind one number.
   */
  it('keeps the single-block re-promotion a lead uses after editing a sheet', async () => {
    const { season, upload, block } = await dancefloorUpload();
    await promoteUpload(db, upload.id, { dryRun: false, recordedBy: LEAD });
    await assignTasks(season.id);
    await fixTheColumnMap(block.id);

    const result = await promoteBlock(db, block.id, { dryRun: false, recordedBy: LEAD });

    expect(result.written).toHaveLength(2);
    expect(result.retained).toHaveLength(2);
    expect(result.deleted).toBe(0);
    const after = await linesNow();
    expect(after.count).toBe(4);
    expect(after.agorot).toBe(BERN_25_AGOROT + BERN_26_AGOROT);
  });

  /**
   * The positive control for the test above: with nothing referencing them,
   * the same re-promotion replaces the rows outright. So the growth up there
   * comes from `retained` specifically, not from re-running as such.
   */
  it('replaces the rows outright when nothing references them', async () => {
    const { upload, block } = await dancefloorUpload();
    await promoteUpload(db, upload.id, { dryRun: false, recordedBy: LEAD });
    await fixTheColumnMap(block.id);

    const result = await promoteBlock(db, block.id, { dryRun: false, recordedBy: LEAD });

    expect(result.deleted).toBe(2);
    expect(result.retained).toHaveLength(0);
    const after = await linesNow();
    expect(after.count).toBe(2);
    expect(after.agorot).toBe(BERN_26_AGOROT);
  });
});

/**
 * The review screen needs one block's cells, and only the open one's. Keeping
 * `rawGrid` out of `BlockStateRow` is deliberate: the file list calls
 * `blockStates` for every upload, and carrying every block's whole grid
 * through it to render one would be the same waste as the eleven dry runs the
 * page already refuses to make.
 */
describe('blockGrid', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('answers with the block’s own cells', async () => {
    const upload = await makeUpload(db, 'x.xlsx', 'a');
    const sheet = await makeSheet(db, upload.id, 'סיכום כללי');
    const block = await makeBlock(db, sheet.id, {
      rawGrid: [['תאריך', 'פירוט'], ['05/07/26', 'גנרטור']],
    });

    expect(await blockGrid(db, block.id)).toEqual([
      ['תאריך', 'פירוט'], ['05/07/26', 'גנרטור'],
    ]);
  });

  it('answers null for a block that is not there, rather than throwing', async () => {
    expect(await blockGrid(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
