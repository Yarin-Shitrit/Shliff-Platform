import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets, blocks, blockMappings } from '@/db/schema/source';
import type { BlockArchetype } from '@/lib/classify/types';
import { blockEvidence, copyDiff } from './evidence';

const GRID = [
  ['תאריך', 'שם', 'סכום', 'אמצעי'],
  ['12/06/26', 'יונתן מזרחי', '1200', 'ביט'],
  ['14/06/26', 'מאיה פרץ', '600', 'מזומן'],
  ['18/06/26', 'נועה ל.', '1200', 'העברה'],
  ['21/06/26', 'עומר ביטון', '500', 'פייבוקס'],
];

let db: TestDb;
let sheetId: string;
let blockId: string;

// `uploads.sha256` is UNIQUE, and two fixtures below deliberately reuse one
// filename (a copy of the same workbook), so the digest cannot be derived
// from the filename alone — it would violate the constraint rather than
// exercise the comparison.
let uploadSeq = 0;

async function addSheet(name: string, filename: string): Promise<string> {
  uploadSeq += 1;
  const [upload] = await db.insert(uploads).values({
    filename, sha256: `${filename}-sha-${uploadSeq}`, storageKey: `k/${uploadSeq}/${filename}`,
    sizeBytes: 1, uploadedBy: 'lead@shliff.test',
  }).returning();
  const [sheet] = await db.insert(sheets).values({
    uploadId: upload.id, name, index: 0, rowCount: 20, colCount: 6,
  }).returning();
  return sheet.id;
}

async function addBlock(
  sheet: string, grid: string[][], opts: { top?: number; left?: number } = {},
): Promise<string> {
  const top = opts.top ?? 11;
  const left = opts.left ?? 2;
  const [block] = await db.insert(blocks).values({
    sheetId: sheet,
    top, left, bottom: top + grid.length - 1, right: left + grid[0].length - 1,
    archetype: 'ledger', confidence: '1.0000', headerRow: top,
    fingerprint: null, pipelineVersion: 1, rawGrid: grid,
    confirmedBy: 'lead@shliff.test', confirmedAt: new Date(),
  }).returning();
  return block.id;
}

beforeEach(async () => {
  db = await createTestDb();
  sheetId = await addSheet('דמי קאמפ', 'קופת קאמפ 2026.xlsx');
  blockId = await addBlock(sheetId, GRID);
});

describe('blockEvidence', () => {
  it('names the cell in A1, using the block’s own left offset', async () => {
    const evidence = await blockEvidence(db, blockId, 14, { column: 3 });
    expect(evidence?.reference).toBe('דמי קאמפ!C14');
    expect(evidence?.filename).toBe('קופת קאמפ 2026.xlsx');
    expect(evidence?.columns).toEqual(['B', 'C', 'D', 'E']);
  });

  it('marks exactly one cell, and the row it sits in', async () => {
    const evidence = await blockEvidence(db, blockId, 14, { column: 3 });
    const marked = evidence!.rows.filter((row) => row.marked);
    expect(marked).toHaveLength(1);
    expect(marked[0].sheetRow).toBe(14);
    expect(marked[0].cells.filter((c) => c.marked).map((c) => c.text)).toEqual(['נועה ל.']);
    const allMarkedCells = evidence!.rows.flatMap((r) => r.cells).filter((c) => c.marked);
    expect(allMarkedCells).toHaveLength(1);
  });

  it('marks the row but no cell when no column is named', async () => {
    const evidence = await blockEvidence(db, blockId, 14);
    expect(evidence?.reference).toBe('דמי קאמפ!14');
    expect(evidence!.rows.flatMap((r) => r.cells).filter((c) => c.marked)).toHaveLength(0);
    expect(evidence!.rows.find((r) => r.marked)?.sheetRow).toBe(14);
  });

  it('returns the rows within the radius and counts the ones it did not', async () => {
    const evidence = await blockEvidence(db, blockId, 13, { radius: 1 });
    expect(evidence!.rows.map((r) => r.sheetRow)).toEqual([12, 13, 14]);
    expect(evidence!.hiddenBefore).toBe(1);
    expect(evidence!.hiddenAfter).toBe(1);
  });

  it('returns null for a block that does not exist', async () => {
    expect(await blockEvidence(db, '00000000-0000-0000-0000-000000000000', 14)).toBeNull();
  });

  it('returns null for a row outside the block rather than an empty grid', async () => {
    expect(await blockEvidence(db, blockId, 99)).toBeNull();
  });
});

const BUDGET_A = [
  ['סוג הוצאה', 'עלות כוללת'],
  ['שכירות גנרטור', '41300'],
  ['צל ומבנה', '18600'],
  ['מטבח ואוכל', '8400'],
  ['ביטוח ואישורים', '3875'],
];
const BUDGET_B = [
  ['סוג הוצאה', 'עלות כוללת'],
  ['שכירות גנרטור', '38000'],
  ['צל ומבנה', '17400'],
  ['מטבח ואוכל', '8400'],
];

async function addBudget(
  name: string, filename: string, grid: string[][], mapped: boolean,
): Promise<string> {
  const sheet = await addSheet(name, filename);
  const [block] = await db.insert(blocks).values({
    sheetId: sheet, top: 1, left: 1, bottom: grid.length, right: 2,
    archetype: 'budget_lines' as BlockArchetype, confidence: '1.0000', headerRow: 1,
    fingerprint: null, pipelineVersion: 1, rawGrid: grid,
    confirmedBy: 'lead@shliff.test', confirmedAt: new Date(),
  }).returning();
  if (mapped) {
    await db.insert(blockMappings).values({
      blockId: block.id, source: 'admin',
      columnMap: [
        { column: 1, field: 'item', confidence: 1 },
        { column: 2, field: 'total', confidence: 1 },
      ],
    });
  }
  return sheet;
}

describe('copyDiff', () => {
  it('lists every line from both copies and marks the ones that differ', async () => {
    const a = await addBudget('תקציב 26', 'קופת קאמפ 2026.xlsx', BUDGET_A, true);
    const b = await addBudget('תקציב 26', 'קופת קאמפ 25.xlsx', BUDGET_B, true);
    const result = await copyDiff(db, [a, b]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.label)).toEqual([
      'שכירות גנרטור', 'צל ומבנה', 'מטבח ואוכל', 'ביטוח ואישורים',
    ]);
    expect(result.rows[0].values).toEqual(['41300', '38000']);
    expect(result.rows[0].differs).toBe(true);
    expect(result.rows[2].differs).toBe(false);
    expect(result.differing).toBe(3);
  });

  it('shows a line missing from one copy as null on that side, and as differing', async () => {
    const a = await addBudget('תקציב 26', 'קופת קאמפ 2026.xlsx', BUDGET_A, true);
    const b = await addBudget('תקציב 26', 'קופת קאמפ 25.xlsx', BUDGET_B, true);
    const result = await copyDiff(db, [a, b]);
    if (!result.ok) throw new Error('expected a comparison');
    const missing = result.rows.find((r) => r.label === 'ביטוח ואישורים')!;
    expect(missing.values).toEqual(['3875', null]);
    expect(missing.differs).toBe(true);
  });

  it('refuses to compare when a copy has no confirmed column mapping', async () => {
    const a = await addBudget('תקציב 26', 'קופת קאמפ 2026.xlsx', BUDGET_A, true);
    const b = await addBudget('תקציב 26', 'קופת קאמפ 25.xlsx', BUDGET_B, false);
    const result = await copyDiff(db, [a, b]);
    expect(result).toEqual({
      ok: false,
      reason: 'אי אפשר להשוות בין העותקים עד שיאושר שיוך עמודות לשני הצדדים',
    });
  });
});

describe('the evidence reader', () => {
  it('never reads a workbook from disk', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/data/evidence.ts'), 'utf8');
    // Positive control: a net that asserts only absence passes just as
    // happily against a file it failed to read.
    expect(source).toContain('export async function blockEvidence');
    expect(source).not.toMatch(/readFileSync|node:fs|extractWorkbook|detectBlocks/);
    expect(source).not.toMatch(/reference-data/);
  });
});
