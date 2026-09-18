import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets } from '@/db/schema/source';
import { seasons } from '@/db/schema/camp';
import { HEBREW_FALLBACK } from '@/lib/errors/hebrew';
import { setSheetAuthority, setSheetSeason } from '@/lib/import/sheets';
import {
  AUTHORITY_NEEDS_SEASON, GENERIC_FAILURE, refusalMessage,
} from './sheet-labels';

describe('refusalMessage', () => {
  it('passes the authority refusal through word for word', () => {
    expect(refusalMessage(new Error(AUTHORITY_NEEDS_SEASON)))
      .toBe(AUTHORITY_NEEDS_SEASON);
  });

  it('opens with the sentence the spec quotes', () => {
    expect(AUTHORITY_NEEDS_SEASON)
      .toContain('אי אפשר לסמן גיליון כסמכותי בלי עונה');
  });

  it('never lets an English error reach a Hebrew screen', () => {
    expect(refusalMessage(new Error('unknown sheet 7f3e')))
      .toBe(GENERIC_FAILURE);
    expect(refusalMessage('duplicate key value violates unique constraint'))
      .toBe(GENERIC_FAILURE);
    expect(refusalMessage(undefined)).toBe(GENERIC_FAILURE);
  });

  it('uses the one generic failure sentence the app already ships', () => {
    expect(GENERIC_FAILURE).toBe(HEBREW_FALLBACK);
  });
});

describe('refusalMessage resolves from its map, not from the alphabet', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  /**
   * The discriminating test for this module, and the only one that can fail if
   * the map entry is deleted.
   *
   * `setSheetAuthority` throws a bare `Error` whose message is pure Hebrew, so
   * `toHebrewError`'s alphabet passthrough would return exactly the same
   * string with no map entry at all — every other assertion in this file would
   * still pass. The passthrough is an inference, it logs when it fires (A20),
   * and the standing constraint forbids resting a new refusal on it. So the
   * assertion is about the mechanism: the map answered, and nothing warned.
   */
  it('matches the refusal explicitly, so nothing warns about an unmarked one', () => {
    expect(refusalMessage(new Error(AUTHORITY_NEEDS_SEASON)))
      .toBe(AUTHORITY_NEEDS_SEASON);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads the refusal through a drizzle wrapper, off the cause chain', () => {
    const wrapped = new Error('Failed query: update "sheets" set "authoritative" = $1', {
      cause: new Error(AUTHORITY_NEEDS_SEASON),
    });
    expect(refusalMessage(wrapped)).toBe(AUTHORITY_NEEDS_SEASON);
  });
});

describe('the copied refusal matches what the library throws', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('is the exact string setSheetAuthority raises on an unlabelled sheet', async () => {
    const [upload] = await db.insert(uploads).values({
      filename: 'x.xlsx', sha256: 'a'.repeat(64), storageKey: 'k',
      sizeBytes: 1, uploadedBy: 'lead@shliff.test',
    }).returning();
    const [sheet] = await db.insert(sheets).values({
      uploadId: upload.id, name: 'מסיבות', index: 0, rowCount: 5, colCount: 3,
    }).returning();

    await expect(setSheetAuthority(db, sheet.id, true))
      .rejects.toThrowError(AUTHORITY_NEEDS_SEASON);
  });

  it('stops refusing the moment the sheet has a season', async () => {
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    const [upload] = await db.insert(uploads).values({
      filename: 'y.xlsx', sha256: 'b'.repeat(64), storageKey: 'k',
      sizeBytes: 1, uploadedBy: 'lead@shliff.test',
    }).returning();
    const [sheet] = await db.insert(sheets).values({
      uploadId: upload.id, name: 'מסיבות', index: 0, rowCount: 5, colCount: 3,
    }).returning();

    await setSheetSeason(db, sheet.id, season.id);
    await expect(setSheetAuthority(db, sheet.id, true)).resolves.toBeUndefined();
  });
});
