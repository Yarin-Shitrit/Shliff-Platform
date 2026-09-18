import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PromotionResult } from '@/lib/import/promote/types';

/**
 * `./actions` is a `'use server'` module that imports `@/db` at module scope
 * (which throws at import time without `DATABASE_URL`), so `@/db` is
 * replaced before the module is imported — same convention as every other
 * `actions.test.ts` in this repo (e.g. `src/app/(admin)/upload/actions.test.ts`).
 *
 * `promoteAllAction` no longer delegates to `promoteAll`: it queries the
 * confirmed blocks itself (`db.select(...).from(blocks).innerJoin(sheets,
 * ...).where(...).orderBy(...)`), so the `db` stand-in has to answer that
 * chain. `dbMock` builds just enough of it — every link returns the next
 * link, and `.orderBy()` resolves through `confirmedBlocks`, a plain
 * `vi.fn()` each test configures. `promoteBlock` and `promotedRowCounts` are
 * mocked as themselves rather than simulated through `dbMock`, so a test can
 * assert on them directly (in particular: that `promoteBlock` is never
 * *called* for a block the gate skips — the proof that its rows are left
 * untouched, since nothing else in this action writes anywhere).
 */
const mocks = vi.hoisted(() => {
  const confirmedBlocks = vi.fn();
  const dbMock = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => confirmedBlocks(),
          }),
        }),
      }),
    }),
  };
  return {
    requireAdmin: vi.fn(),
    setSheetSeason: vi.fn(),
    setSheetAuthority: vi.fn(),
    promoteBlock: vi.fn(),
    promotedRowCounts: vi.fn(),
    revalidatePath: vi.fn(),
    confirmedBlocks,
    dbMock,
  };
});

vi.mock('@/db', () => ({ db: mocks.dbMock }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/import/sheets', () => ({
  setSheetSeason: mocks.setSheetSeason,
  setSheetAuthority: mocks.setSheetAuthority,
}));
vi.mock('@/lib/import/promote/promote', () => ({
  promoteBlock: mocks.promoteBlock,
  promotedRowCounts: mocks.promotedRowCounts,
}));

const ADMIN = { ok: true, email: 'lead@shliff.test' } as const;

function result(blockId: string, writtenCount: number): PromotionResult {
  return {
    blockId,
    archetype: 'ledger',
    dryRun: false,
    written: Array.from({ length: writtenCount }, (_, i) => ({
      table: 'ledger_entries', sheetRow: i + 2, id: `row-${blockId}-${i}`, summary: 's', notes: [],
    })),
    refused: [],
    deleted: 0,
    retained: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirmedBlocks.mockResolvedValue([]);
  mocks.promotedRowCounts.mockResolvedValue(new Map());
});

describe('data server actions', () => {
  it('refuses a non-admin without touching the database', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false });
    const { setSeasonAction, setAuthorityAction, promoteAllAction } = await import('./actions');

    await expect(setSeasonAction('s', 'x')).rejects.toThrow('unauthorized');
    await expect(setAuthorityAction('s', true)).rejects.toThrow('unauthorized');
    await expect(promoteAllAction()).rejects.toThrow('unauthorized');

    expect(mocks.setSheetSeason).not.toHaveBeenCalled();
    expect(mocks.setSheetAuthority).not.toHaveBeenCalled();
    expect(mocks.confirmedBlocks).not.toHaveBeenCalled();
    expect(mocks.promoteBlock).not.toHaveBeenCalled();
  });

  it('sets a season as the signed-in admin', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN);
    const { setSeasonAction } = await import('./actions');

    await setSeasonAction('sheet-1', 'season-1');
    expect(mocks.setSheetSeason).toHaveBeenCalledWith(mocks.dbMock, 'sheet-1', 'season-1');
  });

  it('sets authority as the signed-in admin', async () => {
    mocks.requireAdmin.mockResolvedValue(ADMIN);
    const { setAuthorityAction } = await import('./actions');

    await setAuthorityAction('sheet-1', false);
    expect(mocks.setSheetAuthority).toHaveBeenCalledWith(mocks.dbMock, 'sheet-1', false);
  });

  describe('promoteAllAction', () => {
    it('promotes a never-promoted confirmed block normally', async () => {
      mocks.requireAdmin.mockResolvedValue(ADMIN);
      mocks.confirmedBlocks.mockResolvedValue([{ id: 'block-fresh' }]);
      mocks.promotedRowCounts.mockResolvedValue(new Map());
      mocks.promoteBlock.mockResolvedValue(result('block-fresh', 2));
      const { promoteAllAction } = await import('./actions');

      const out = await promoteAllAction();

      expect(mocks.promotedRowCounts).toHaveBeenCalledWith(mocks.dbMock, ['block-fresh']);
      expect(mocks.promoteBlock).toHaveBeenCalledWith(
        mocks.dbMock, 'block-fresh', { dryRun: false, recordedBy: 'lead@shliff.test' },
      );
      expect(out.skipped).toEqual([]);
      expect(out.writtenCount).toBe(2);
      expect(out.results.map((r) => r.blockId)).toEqual(['block-fresh']);
    });

    it('skips a confirmed block that already owns rows, reports it with a Hebrew reason, and never calls promoteBlock for it', async () => {
      mocks.requireAdmin.mockResolvedValue(ADMIN);
      mocks.confirmedBlocks.mockResolvedValue([{ id: 'block-owned' }]);
      mocks.promotedRowCounts.mockResolvedValue(new Map([['block-owned', 2]]));
      const { promoteAllAction } = await import('./actions');

      const out = await promoteAllAction();

      // The proof the row values are untouched: `promoteBlock` is the only
      // thing in this action that can write to a target table, and it is
      // never invoked for this block at all.
      expect(mocks.promoteBlock).not.toHaveBeenCalled();
      expect(out.results).toEqual([]);
      expect(out.writtenCount).toBe(0);
      expect(out.skipped).toHaveLength(1);
      expect(out.skipped[0].blockId).toBe('block-owned');
      // Hebrew: every codepoint in the Hebrew block (U+0590-05FF) — proves
      // this isn't an English/internal-only message leaking to a lead.
      expect(out.skipped[0].reason).toMatch(/[֐-׿]/);
      expect(out.skipped[0].reason).toContain('cutover');
    });

    it('promotes a mixed confirmed set: skips the owning block, promotes the fresh one, in the same call', async () => {
      mocks.requireAdmin.mockResolvedValue(ADMIN);
      mocks.confirmedBlocks.mockResolvedValue([{ id: 'block-owned' }, { id: 'block-fresh' }]);
      mocks.promotedRowCounts.mockResolvedValue(new Map([['block-owned', 2]]));
      mocks.promoteBlock.mockResolvedValue(result('block-fresh', 1));
      const { promoteAllAction } = await import('./actions');

      const out = await promoteAllAction();

      expect(mocks.promoteBlock).toHaveBeenCalledTimes(1);
      expect(mocks.promoteBlock).toHaveBeenCalledWith(
        mocks.dbMock, 'block-fresh', { dryRun: false, recordedBy: 'lead@shliff.test' },
      );
      expect(out.results.map((r) => r.blockId)).toEqual(['block-fresh']);
      expect(out.skipped.map((s) => s.blockId)).toEqual(['block-owned']);
      expect(out.skipped[0].reason).toMatch(/[֐-׿]/);
    });

    it('revalidates both pages even when the confirmed-block query itself rejects', async () => {
      mocks.requireAdmin.mockResolvedValue(ADMIN);
      mocks.confirmedBlocks.mockRejectedValue(new Error('boom'));
      const { promoteAllAction } = await import('./actions');

      await expect(promoteAllAction()).rejects.toThrow('boom');

      expect(mocks.revalidatePath).toHaveBeenCalledWith('/data');
      expect(mocks.revalidatePath).toHaveBeenCalledWith('/money');
    });
  });
});
