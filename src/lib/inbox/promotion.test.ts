import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BlockStateRow } from '@/lib/import/register';

const { blockStates } = vi.hoisted(() => ({ blockStates: vi.fn() }));
vi.mock('@/lib/import/register', () => ({ blockStates }));

import { promotionPreview } from './promotion';

const db = {} as never;

function block(over: Partial<BlockStateRow> = {}): BlockStateRow {
  return {
    blockId: 'b1', sheetId: 's1', sheetName: 'תנועות קופה', uploadId: 'u1',
    archetype: 'ledger', confidence: 1, top: 5, left: 1, bottom: 20, right: 6,
    range: 'A5:F20', rowCount: 16, headerRow: 5,
    columnMap: [{ column: 1, field: 'date', confidence: 1 }],
    mappingSource: 'admin', budgetCategory: null,
    confirmedBy: 'lead@shliff.test', confirmedAt: new Date('2026-09-01T00:00:00Z'),
    promotedRows: 0, state: 'confirmed', ...over,
  } as BlockStateRow;
}

beforeEach(() => {
  vi.resetAllMocks();
  blockStates.mockResolvedValue([]);
});

describe('promotionPreview', () => {
  it('runs no dry run at all', async () => {
    // The whole point: this is what the register may render instead of a
    // promote-everything button (A23), and it must cost a page load nothing.
    // `blockStates` reads counted rows; `worklist` would dry-run the promoter.
    const worklist = await import('@/lib/data/worklist');
    const spy = vi.spyOn(worklist, 'worklist');
    await promotionPreview(db);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('names the blocks a promotion would write, and only those', async () => {
    blockStates.mockResolvedValue([
      block({ blockId: 'ready', state: 'confirmed', promotedRows: 0 }),
      block({ blockId: 'done', state: 'promoted', promotedRows: 14 }),
      block({ blockId: 'open', state: 'needs-review', confirmedAt: null }),
      block({ blockId: 'held', state: 'blocked' }),
      block({ blockId: 'old', state: 'superseded' }),
      block({ blockId: 'none', state: 'no-promoter' }),
    ]);

    const preview = await promotionPreview(db);
    expect(preview.ready.map((b) => b.blockId)).toEqual(['ready']);
    expect(preview.alreadyPromoted).toBe(1);
    expect(preview.awaitingReview).toBe(1);
    expect(preview.heldBySheet).toBe(2);
    expect(preview.noPromoter).toBe(1);
  });

  // A34: the per-file promote covers `confirmed` only, and the register's
  // preview must describe the same set. A preview that counted an
  // already-promoted block would be promising a lead a re-run nobody offers.
  it('never counts an already-promoted block as something still to write', async () => {
    blockStates.mockResolvedValue([
      block({ blockId: 'done', state: 'promoted', promotedRows: 14 }),
    ]);
    const preview = await promotionPreview(db);
    expect(preview.ready).toEqual([]);
    expect(preview.readyCount).toBe(0);
  });

  it('points each ready block at the screen that can promote it', async () => {
    blockStates.mockResolvedValue([
      block({ blockId: 'b7', uploadId: 'u9', state: 'confirmed', promotedRows: 0 }),
    ]);
    const [ready] = (await promotionPreview(db)).ready;
    expect(ready.href).toBe('/imports/u9?block=b7');
  });

  it('reports nothing to promote as a fact, not as an empty list to guess at', async () => {
    blockStates.mockResolvedValue([block({ state: 'promoted', promotedRows: 3 })]);
    const preview = await promotionPreview(db);
    expect(preview.readyCount).toBe(0);
    expect(preview.alreadyPromoted).toBe(1);
  });
});
