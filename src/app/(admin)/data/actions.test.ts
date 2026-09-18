import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `./actions` is a `'use server'` module that imports `@/db` at module scope
 * (which throws at import time without `DATABASE_URL`), so `@/db` is
 * replaced before the module is imported — same convention as every other
 * `actions.test.ts` in this repo.
 *
 * `promoteAllAction` is a thin wrapper now: `requireAdmin`, delegate the
 * whole gated run to `promoteAllGated`, revalidate in `finally`. The gate
 * itself — the confirmed-block query, the skip decision, the per-block loop
 * — is `promoteAllGated`'s, tested with a real `TestDb` in
 * `src/lib/import/promote/promote.test.ts` (a mocked `db` here cannot catch
 * a wrong query: `where`/`orderBy`/`innerJoin` calls that ignore their
 * arguments make every query "pass"). This file only proves the wrapper
 * wraps: admin gate first, correct delegation, revalidation in `finally`.
 */
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  setSheetSeason: vi.fn(),
  setSheetAuthority: vi.fn(),
  promoteAllGated: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/import/sheets', () => ({
  setSheetSeason: mocks.setSheetSeason,
  setSheetAuthority: mocks.setSheetAuthority,
}));
vi.mock('@/lib/import/promote/promote', () => ({ promoteAllGated: mocks.promoteAllGated }));

beforeEach(() => vi.clearAllMocks());

describe('data server actions', () => {
  it('refuses a non-admin without touching the database', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false });
    const { setSeasonAction, setAuthorityAction, promoteAllAction } = await import('./actions');

    await expect(setSeasonAction('s', 'x')).rejects.toThrow('unauthorized');
    await expect(setAuthorityAction('s', true)).rejects.toThrow('unauthorized');
    await expect(promoteAllAction()).rejects.toThrow('unauthorized');

    expect(mocks.setSheetSeason).not.toHaveBeenCalled();
    expect(mocks.setSheetAuthority).not.toHaveBeenCalled();
    expect(mocks.promoteAllGated).not.toHaveBeenCalled();
  });

  it('sets a season as the signed-in admin', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.test' });
    const { setSeasonAction } = await import('./actions');

    await setSeasonAction('sheet-1', 'season-1');
    expect(mocks.setSheetSeason).toHaveBeenCalledWith({}, 'sheet-1', 'season-1');
  });

  it('sets authority as the signed-in admin', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.test' });
    const { setAuthorityAction } = await import('./actions');

    await setAuthorityAction('sheet-1', false);
    expect(mocks.setSheetAuthority).toHaveBeenCalledWith({}, 'sheet-1', false);
  });

  it('delegates to promoteAllGated as the signed-in admin and returns its result unchanged', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.test' });
    const gated = {
      results: [], writtenCount: 0, refusedCount: 0, deletedCount: 0, retainedCount: 0,
      failures: [], failedCount: 0, skipped: [], skippedCount: 0,
    };
    mocks.promoteAllGated.mockResolvedValue(gated);
    const { promoteAllAction } = await import('./actions');

    const result = await promoteAllAction();

    expect(mocks.promoteAllGated).toHaveBeenCalledWith({}, {
      dryRun: false, recordedBy: 'lead@shliff.test',
    });
    expect(result).toBe(gated);
  });

  it('revalidates both pages even when promoteAllGated itself rejects', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.test' });
    mocks.promoteAllGated.mockRejectedValue(new Error('boom'));
    const { promoteAllAction } = await import('./actions');

    await expect(promoteAllAction()).rejects.toThrow('boom');

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/data');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/money');
  });
});
