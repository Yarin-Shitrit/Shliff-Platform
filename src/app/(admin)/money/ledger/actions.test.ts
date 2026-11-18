import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HebrewRefusal, HEBREW_FALLBACK } from '@/lib/errors/hebrew';

const {
  requireAdmin, attributeMovement, recordEntry, updateEntry, deleteEntry, revalidatePath,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  attributeMovement: vi.fn(),
  recordEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/money/attribution', () => ({ attributeMovement }));
vi.mock('@/lib/money/ledger', () => ({ recordEntry, updateEntry, deleteEntry }));
vi.mock('next/cache', () => ({ revalidatePath }));

import {
  attributeMovementAction, recordMovementAction, updateMovementAction, deleteMovementAction,
} from './actions';

const INPUT = { origin: 'ledger' as const, id: 'e1', accountId: 'a1' };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  attributeMovement.mockResolvedValue(undefined);
  recordEntry.mockResolvedValue('e1');
  updateEntry.mockResolvedValue(undefined);
  deleteEntry.mockResolvedValue(undefined);
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

const MOVEMENT = {
  occurredOn: '2026-09-10',
  direction: 'out' as const,
  amount: 3875,
  description: 'השכרת משאית',
};

describe('recordMovementAction', () => {
  it('refuses a caller who is not an admin, and writes nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await recordMovementAction(MOVEMENT)).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(recordEntry).not.toHaveBeenCalled();
  });

  /**
   * Who recorded a movement is a fact about the session, not a field a form
   * may assert. A client that could name the recorder could name somebody
   * else.
   */
  it('takes recordedBy from the session, never from the client', async () => {
    await recordMovementAction({ ...MOVEMENT, recordedBy: 'someone@else.example' } as never);
    const [, entry] = recordEntry.mock.calls[0];
    expect(entry.recordedBy).toBe('lead@shliff.camp');
  });

  it('passes an omitted account through as undefined rather than guessing a קופה', async () => {
    await recordMovementAction(MOVEMENT);
    const [, entry] = recordEntry.mock.calls[0];
    expect(entry.accountId).toBeUndefined();
    expect('accountId' in entry).toBe(true);
  });

  /**
   * A season is a label a lead sets by hand. Deriving it from `occurredOn`
   * would be the system guessing — and guessing wrong, since
   * `חוב לירון סלע על ברן 25` is dated June 2026.
   */
  it('sends the season the form chose, and never one derived from the date', async () => {
    await recordMovementAction({ ...MOVEMENT, seasonId: 's0' });
    expect(recordEntry.mock.calls[0][1].seasonId).toBe('s0');
    recordEntry.mockClear();
    await recordMovementAction(MOVEMENT);
    expect(recordEntry.mock.calls[0][1].seasonId).toBeUndefined();
  });

  it('records the movement and refreshes both screens that show it', async () => {
    expect(await recordMovementAction(MOVEMENT)).toEqual({ ok: true });
    const [, entry] = recordEntry.mock.calls[0];
    expect(entry.direction).toBe('out');
    expect(entry.amount).toBe(3875);
    expect(entry.description).toBe('השכרת משאית');
    expect(entry.occurredOn).toEqual(new Date('2026-09-10'));
    const paths = revalidatePath.mock.calls.map(([path]) => path);
    expect(paths).toContain('/money/ledger');
    expect(paths).toContain('/money');
  });

  it('hands the library refusal to the screen unchanged', async () => {
    recordEntry.mockRejectedValue(new Error('לתנועה חייב להיות תיאור'));
    expect(await recordMovementAction({ ...MOVEMENT, description: ' ' }))
      .toEqual({ ok: false, error: 'לתנועה חייב להיות תיאור' });
  });

  /**
   * The two sentences above are asserted against mocks everywhere else in
   * this file, which would keep passing if the library reworded them. This
   * pins both to the real `recordEntry`, whose validation runs before it
   * touches a database — so no db is needed to provoke either.
   */
  it('quotes the library sentences that actually exist', async () => {
    const real = await vi.importActual<typeof import('@/lib/money/ledger')>('@/lib/money/ledger');
    const base = {
      occurredOn: new Date('2026-09-10'), direction: 'out' as const,
      description: 'השכרת משאית', recordedBy: 'lead@shliff.camp',
    };
    await expect(real.recordEntry(null as never, { ...base, amount: 0 }))
      .rejects.toThrow('סכום תנועה חייב להיות חיובי — הכיוון נושא את הסימן');
    await expect(real.recordEntry(null as never, { ...base, amount: 10, description: '‏' }))
      .rejects.toThrow('לתנועה חייב להיות תיאור');
  });
});

describe('updateMovementAction', () => {
  it('refuses a caller who may not edit, and writes nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await updateMovementAction('e1', MOVEMENT)).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(requireAdmin).toHaveBeenCalledWith('ledger', 'edit');
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it('sends the form as it is, clearing what the form left empty', async () => {
    expect(await updateMovementAction('e1', { ...MOVEMENT, accountId: 'a1' })).toEqual({ ok: true });
    const [, id, edit] = updateEntry.mock.calls[0];
    expect(id).toBe('e1');
    expect(edit).toEqual({
      occurredOn: new Date('2026-09-10'), direction: 'out', amount: 3875,
      description: 'השכרת משאית', accountId: 'a1', seasonId: undefined, budgetLineId: undefined,
    });
  });

  /** There is no column for who corrected a movement; the recorder stays. */
  it('never sends a recorder, from the session or from the client', async () => {
    await updateMovementAction('e1', { ...MOVEMENT, recordedBy: 'someone@else.example' } as never);
    expect('recordedBy' in updateEntry.mock.calls[0][2]).toBe(false);
  });

  it('refreshes both screens that show the movement', async () => {
    await updateMovementAction('e1', MOVEMENT);
    const paths = revalidatePath.mock.calls.map(([path]) => path);
    expect(paths).toContain('/money/ledger');
    expect(paths).toContain('/money');
  });

  it('hands the library refusal to the screen unchanged, and refreshes nothing', async () => {
    updateEntry.mockRejectedValue(new HebrewRefusal('התנועה הזו שייכת למסיבה. מתקנים אותה בדף המסיבה.'));
    expect(await updateMovementAction('e1', MOVEMENT))
      .toEqual({ ok: false, error: 'התנועה הזו שייכת למסיבה. מתקנים אותה בדף המסיבה.' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('never lets an English failure reach a Hebrew screen', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    updateEntry.mockRejectedValue(new Error('violates foreign key constraint'));
    expect(await updateMovementAction('e1', MOVEMENT)).toEqual({ ok: false, error: HEBREW_FALLBACK });
    logged.mockRestore();
  });
});

describe('deleteMovementAction', () => {
  it('refuses a caller who may not edit, and removes nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await deleteMovementAction('e1')).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(requireAdmin).toHaveBeenCalledWith('ledger', 'edit');
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it('removes the movement and refreshes both screens that showed it', async () => {
    expect(await deleteMovementAction('e1')).toEqual({ ok: true });
    expect(deleteEntry).toHaveBeenCalledWith({}, 'e1');
    const paths = revalidatePath.mock.calls.map(([path]) => path);
    expect(paths).toContain('/money/ledger');
    expect(paths).toContain('/money');
  });

  it('hands the library refusal to the screen unchanged, and refreshes nothing', async () => {
    deleteEntry.mockRejectedValue(new HebrewRefusal('התנועה הזו סוגרת חוב. בטלו את הסגירה בדף החובות לפני שמוחקים אותה.'));
    expect(await deleteMovementAction('e1')).toEqual({
      ok: false, error: 'התנועה הזו סוגרת חוב. בטלו את הסגירה בדף החובות לפני שמוחקים אותה.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('never lets an English failure reach a Hebrew screen', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    deleteEntry.mockRejectedValue(new Error('connection terminated'));
    expect(await deleteMovementAction('e1')).toEqual({ ok: false, error: HEBREW_FALLBACK });
    logged.mockRestore();
  });
});
