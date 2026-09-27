import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HEBREW_FALLBACK } from '@/lib/errors/hebrew';
import type { ObligationRow } from '@/lib/money/obligations';

const {
  requireAdmin, listObligations, checkSettlement, settleObligation, nameObligation,
  recordEntry, revalidatePath,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listObligations: vi.fn(),
  checkSettlement: vi.fn(),
  settleObligation: vi.fn(),
  nameObligation: vi.fn(),
  recordEntry: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/money/obligations', () => ({
  listObligations, checkSettlement, settleObligation, nameObligation,
}));
vi.mock('@/lib/money/ledger', () => ({ recordEntry }));
vi.mock('next/cache', () => ({ revalidatePath }));

import { settleObligationAction, nameObligationAction } from './actions';

function debt(over: Partial<ObligationRow> = {}): ObligationRow {
  return {
    id: 'o1', direction: 'camp_owes', partyPersonId: null, partyName: 'רוני אדלר',
    displayParty: 'רוני אדלר', description: 'מקדמה לגנרטור', amountAgorot: 1524000,
    settledAgorot: 0, outstandingAgorot: 1524000, settled: false, unnamed: false,
    openedOn: new Date('2026-07-02T00:00:00Z'), seasonId: 's1',
    sourceBlockId: null, sourceRow: null, settlements: [], ...over,
  };
}

const CASH = {
  obligationId: 'o1', amount: 910, kind: 'cash' as const,
  accountId: 'a1', settledOn: '2026-09-10',
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  listObligations.mockResolvedValue([debt()]);
  checkSettlement.mockResolvedValue(undefined);
  settleObligation.mockResolvedValue('s1');
  recordEntry.mockResolvedValue('e1');
});

describe('settleObligationAction', () => {
  it('refuses a caller who is not an admin, and writes nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await settleObligationAction(CASH)).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(recordEntry).not.toHaveBeenCalled();
    expect(settleObligation).not.toHaveBeenCalled();
  });

  it('passes an offset with no note to the library, and never writes an entry', async () => {
    checkSettlement.mockRejectedValue(new Error('קיזוז חייב לשאת הערה שאומרת מול מה קוזז'));
    expect(await settleObligationAction({
      obligationId: 'o1', amount: 910, kind: 'offset', settledOn: '2026-09-10',
    })).toEqual({ ok: false, error: 'קיזוז חייב לשאת הערה שאומרת מול מה קוזז' });
    expect(recordEntry).not.toHaveBeenCalled();
    expect(settleObligation).not.toHaveBeenCalled();
  });

  /**
   * The binding rule: an offset moves no cash, so it touches no account,
   * writes no ledger entry, and appears nowhere in תנועות. If this ever
   * recorded an entry, every offset-settled debt would read as fresh cash
   * leaving a קופה that never held it.
   */
  it('writes no ledger entry for an offset, only the settlement', async () => {
    expect(await settleObligationAction({
      obligationId: 'o1', amount: 910, kind: 'offset',
      note: 'מול דמי קאמפ', settledOn: '2026-09-10',
    })).toEqual({ ok: true });
    expect(recordEntry).not.toHaveBeenCalled();
    expect(settleObligation).toHaveBeenCalledTimes(1);
    const [, settlement] = settleObligation.mock.calls[0];
    expect(settlement.kind).toBe('offset');
    expect(settlement.ledgerEntryId).toBeUndefined();
    expect(settlement.accountId).toBeUndefined();
  });

  it('refuses an offset that names an account, because it cannot have one', async () => {
    expect(await settleObligationAction({
      obligationId: 'o1', amount: 910, kind: 'offset', note: 'מול דמי קאמפ',
      accountId: 'a1', settledOn: '2026-09-10',
    })).toEqual({ ok: false, error: 'קיזוז אינו מזיז מזומן, ולכן אינו נכנס לחשבון' });
    expect(recordEntry).not.toHaveBeenCalled();
    expect(settleObligation).not.toHaveBeenCalled();
  });

  it('refuses a cash settlement with no account, and calls neither library function', async () => {
    expect(await settleObligationAction({
      obligationId: 'o1', amount: 910, kind: 'cash', settledOn: '2026-09-10',
    })).toEqual({ ok: false, error: 'סגירה במזומן חייבת לציין מאיזה חשבון יצא הכסף' });
    expect(recordEntry).not.toHaveBeenCalled();
    expect(settleObligation).not.toHaveBeenCalled();
  });

  it('records money leaving a קופה when the camp pays a debt it owes', async () => {
    expect(await settleObligationAction(CASH)).toEqual({ ok: true });
    const [, entry] = recordEntry.mock.calls[0];
    expect(entry.direction).toBe('out');
    expect(entry.accountId).toBe('a1');
    expect(entry.amount).toBe(910);
    expect(entry.description).toBe('סגירת חוב — רוני אדלר');
    // Carried over from the obligation, never derived from today's date: a
    // season is a hand-set label, and `חוב לירון סלע על ברן 25` is dated
    // June 2026.
    expect(entry.seasonId).toBe('s1');
    expect(entry.recordedBy).toBe('lead@shliff.camp');
    const [, settlement] = settleObligation.mock.calls[0];
    expect(settlement.ledgerEntryId).toBe('e1');
  });

  it('records money arriving when somebody pays the camp back', async () => {
    listObligations.mockResolvedValue([debt({ direction: 'owed_to_camp', displayParty: 'מאיה פרץ' })]);
    await settleObligationAction(CASH);
    const [, entry] = recordEntry.mock.calls[0];
    expect(entry.direction).toBe('in');
    expect(entry.description).toBe('סגירת חוב — מאיה פרץ');
  });

  /**
   * checkSettlement runs before recordEntry, so every refusal a lead can
   * trigger fires before the first of the two writes rather than between
   * them — which would leave a ledger entry with no settlement attached.
   */
  it('checks every refusal before it writes anything', async () => {
    checkSettlement.mockRejectedValue(new Error('אי אפשר לקזז יותר ממה שחייבים'));
    expect(await settleObligationAction(CASH))
      .toEqual({ ok: false, error: 'אי אפשר לקזז יותר ממה שחייבים' });
    expect(recordEntry).not.toHaveBeenCalled();
  });

  it('never lets an English failure reach a Hebrew screen', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    settleObligation.mockRejectedValue(new Error('insert or update violates foreign key'));
    expect(await settleObligationAction(CASH)).toEqual({ ok: false, error: HEBREW_FALLBACK });
    logged.mockRestore();
  });

  it('refreshes all three screens the settlement changes', async () => {
    await settleObligationAction(CASH);
    const paths = revalidatePath.mock.calls.map(([path]) => path);
    expect(paths).toContain('/money/debts');
    expect(paths).toContain('/money/ledger');
    expect(paths).toContain('/money');
  });
});

describe('nameObligationAction', () => {
  beforeEach(() => { nameObligation.mockResolvedValue(undefined); });

  it('refuses a caller who is not an admin, and writes nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await nameObligationAction({ obligationId: 'o1', personId: 'p1' }))
      .toEqual({ ok: false, error: 'אין הרשאה' });
    expect(nameObligation).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('hands the library the person, and refreshes the debts, the inbox and that person’s page', async () => {
    expect(await nameObligationAction({ obligationId: 'o1', personId: 'p1' })).toEqual({ ok: true });
    expect(nameObligation).toHaveBeenCalledWith({}, {
      obligationId: 'o1', partyPersonId: 'p1', partyName: undefined,
    });
    const paths = revalidatePath.mock.calls.map(([path]) => path);
    expect(paths).toContain('/money/debts');
    expect(paths).toContain('/money');
    expect(paths).toContain('/inbox');
    expect(paths).toContain('/members/p1');
  });

  it('hands the library a bare name, and refreshes no person page', async () => {
    expect(await nameObligationAction({ obligationId: 'o1', partyName: 'חנות הקרח' })).toEqual({ ok: true });
    expect(nameObligation).toHaveBeenCalledWith({}, {
      obligationId: 'o1', partyPersonId: undefined, partyName: 'חנות הקרח',
    });
    const paths = revalidatePath.mock.calls.map(([path]) => path);
    expect(paths.some((path) => String(path).startsWith('/members/'))).toBe(false);
  });

  it('carries the library’s own refusal to the screen unchanged', async () => {
    const { HebrewRefusal } = await import('@/lib/errors/hebrew');
    nameObligation.mockRejectedValue(new HebrewRefusal('לחוב הזה כבר רשום אדם'));
    expect(await nameObligationAction({ obligationId: 'o1', personId: 'p1' }))
      .toEqual({ ok: false, error: 'לחוב הזה כבר רשום אדם' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('never lets English through when the database fails', async () => {
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});
    nameObligation.mockRejectedValue(new Error('insert or update violates foreign key'));
    expect(await nameObligationAction({ obligationId: 'o1', personId: 'p1' }))
      .toEqual({ ok: false, error: HEBREW_FALLBACK });
    logged.mockRestore();
  });
});
