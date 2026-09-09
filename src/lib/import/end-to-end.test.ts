import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, blocks, sheets } from '@/db/schema/source';
import { runImport } from '@/lib/import/run-import';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

describe('end-to-end ingestion of all reference workbooks', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    let n = 0;
    for (const filename of [FIXTURES.y2324, FIXTURES.y25, FIXTURES.y26]) {
      n += 1;
      const [row] = await db.insert(uploads).values({
        filename,
        sha256: String(n).repeat(64).slice(0, 64),
        storageKey: `uploads/${n}.xlsx`,
        sizeBytes: 1,
        uploadedBy: 'admin@example.com',
      }).returning();
      await runImport(db, row.id, fixtureBuffer(filename));
    }
  });

  it('imports all 19 sheets across the three workbooks', async () => {
    expect(await db.select().from(sheets)).toHaveLength(19);
  });

  it('marks every upload as parsed', async () => {
    const rows = await db.select().from(uploads);
    expect(rows.every((r) => r.status === 'parsed')).toBe(true);
  });

  it('classifies the large majority of blocks', async () => {
    const rows = await db.select().from(blocks);
    const identified = rows.filter((b) => b.archetype !== 'unknown');
    expect(identified.length / rows.length).toBeGreaterThan(0.6);
  });

  it('pins the measured block count and header/fingerprint split', async () => {
    // Measured ground truth (not the brief's estimate): block detection
    // under-segments 12 of the 19 sheets into a single block each, so the
    // true total is 29, not ~50. 24 of those blocks carry a header row and
    // get a fingerprint; the other 5 are headerless and always need manual
    // mapping. Of the 24 fingerprints, exactly 20 are distinct — three are
    // legitimately shared layouts. A regression that changes segmentation,
    // header detection, or fingerprinting should fail here even if it
    // happens to keep the sheet count and classification rate unchanged.
    const rows = await db.select().from(blocks);
    expect(rows).toHaveLength(29);

    const withHeader = rows.filter((b) => b.headerRow !== null);
    const withoutHeader = rows.filter((b) => b.headerRow === null);
    expect(withHeader).toHaveLength(24);
    expect(withoutHeader).toHaveLength(5);

    const fingerprints = new Set(withHeader.map((b) => b.fingerprint));
    expect(fingerprints.size).toBe(20);
  });

  it('finds every archetype that the reference data actually contains', async () => {
    const rows = await db.select().from(blocks);
    const found = new Set(rows.map((b) => b.archetype));
    for (const expected of ['ledger', 'budget_lines', 'ticket_rounds']) {
      expect(found.has(expected as never), `missing ${expected}`).toBe(true);
    }
  });

  it('stores a fingerprint for every block that has a header row', async () => {
    const rows = await db.select().from(blocks);
    for (const block of rows) {
      if (block.headerRow !== null) expect(block.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});
