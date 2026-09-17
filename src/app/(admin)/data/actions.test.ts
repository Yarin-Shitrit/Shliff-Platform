import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  setSheetSeason: vi.fn(),
  setSheetAuthority: vi.fn(),
  promoteAll: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/import/sheets', () => ({
  setSheetSeason: mocks.setSheetSeason,
  setSheetAuthority: mocks.setSheetAuthority,
}));
vi.mock('@/lib/import/promote/promote', () => ({ promoteAll: mocks.promoteAll }));

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
    expect(mocks.promoteAll).not.toHaveBeenCalled();
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

  it('promotes as the signed-in admin', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.test' });
    mocks.promoteAll.mockResolvedValue({
      results: [], writtenCount: 0, refusedCount: 0, deletedCount: 0, retainedCount: 0,
    });
    const { promoteAllAction } = await import('./actions');

    const result = await promoteAllAction();
    expect(mocks.promoteAll).toHaveBeenCalledWith({}, {
      dryRun: false, recordedBy: 'lead@shliff.test',
    });
    expect(result.retainedCount).toBe(0);
  });
});
