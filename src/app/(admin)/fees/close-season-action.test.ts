import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HEBREW_FALLBACK, HebrewRefusal } from '@/lib/errors/hebrew';

const { requireAdmin, closeSeasonBalances, revalidatePath } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  closeSeasonBalances: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/fees/close-season', () => ({ closeSeasonBalances }));
vi.mock('@/lib/fees/dues', () => ({}));
vi.mock('@/lib/fees/payments', () => ({}));
vi.mock('@/lib/money/accounts', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath }));

import { closeSeasonAction } from './actions';

const RESULT = { duesClosed: 2, duesAgorot: 240000, obligationsClosed: 1, obligationsAgorot: 30000, unnamedLeft: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  closeSeasonBalances.mockResolvedValue(RESULT);
});

describe('closeSeasonAction', () => {
  it('refuses a caller who is not an admin, and writes nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await closeSeasonAction('s1', { dues: true, obligations: true }))
      .toEqual({ ok: false, error: 'אין הרשאה' });
    expect(closeSeasonBalances).not.toHaveBeenCalled();
  });

  it('passes the choice as made, stamps the session as the recorder, and revalidates every screen a balance is on', async () => {
    const result = await closeSeasonAction('s1', { dues: true, obligations: false });
    expect(result).toEqual({ ok: true, value: RESULT });
    expect(closeSeasonBalances).toHaveBeenCalledWith({}, expect.objectContaining({
      seasonId: 's1', dues: true, obligations: false, recordedBy: 'lead@shliff.camp',
    }));
    expect(closeSeasonBalances.mock.calls[0][1].closedOn).toBeInstanceOf(Date);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it("returns the library's refusal verbatim, and never an English message", async () => {
    closeSeasonBalances.mockRejectedValueOnce(new HebrewRefusal('אין יתרות פתוחות לסגור בברן 25.'));
    expect(await closeSeasonAction('s1', { dues: true, obligations: true }))
      .toEqual({ ok: false, error: 'אין יתרות פתוחות לסגור בברן 25.' });

    closeSeasonBalances.mockRejectedValueOnce(new Error('connection refused'));
    expect(await closeSeasonAction('s1', { dues: true, obligations: true }))
      .toEqual({ ok: false, error: HEBREW_FALLBACK });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
