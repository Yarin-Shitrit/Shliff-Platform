import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HebrewRefusal, HEBREW_FALLBACK } from '@/lib/errors/hebrew';

const { requireAdmin, attributeMovement, revalidatePath } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  attributeMovement: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/money/attribution', () => ({ attributeMovement }));
vi.mock('next/cache', () => ({ revalidatePath }));

import { attributeMovementAction } from './actions';

const INPUT = { origin: 'ledger' as const, id: 'e1', accountId: 'a1' };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  attributeMovement.mockResolvedValue(undefined);
});

describe('attributeMovementAction', () => {
  it('refuses a caller who is not an admin, and never reaches the library', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await attributeMovementAction(INPUT)).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(attributeMovement).not.toHaveBeenCalled();
  });

  it('places the movement and refreshes both screens that show it', async () => {
    expect(await attributeMovementAction(INPUT)).toEqual({ ok: true });
    expect(attributeMovement).toHaveBeenCalledWith({}, INPUT);
    const paths = revalidatePath.mock.calls.map(([path]) => path);
    expect(paths).toContain('/money/ledger');
    // `/money`'s own unattributed banners read the same rows, so leaving them
    // stale would have one screen say the money is placed and the other say
    // it is not.
    expect(paths).toContain('/money');
  });

  it('hands the library refusal to the screen unchanged', async () => {
    attributeMovement.mockRejectedValue(new HebrewRefusal('התנועה הזו כבר משויכת לחשבון'));
    expect(await attributeMovementAction(INPUT))
      .toEqual({ ok: false, error: 'התנועה הזו כבר משויכת לחשבון' });
  });

  it('never lets an English failure reach a Hebrew screen', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    attributeMovement.mockRejectedValue(new Error('duplicate key value violates unique'));
    expect(await attributeMovementAction(INPUT))
      .toEqual({ ok: false, error: HEBREW_FALLBACK });
    logged.mockRestore();
  });

  it('does not refresh anything when the write was refused', async () => {
    attributeMovement.mockRejectedValue(new HebrewRefusal('אין חשבון כזה'));
    await attributeMovementAction(INPUT);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
