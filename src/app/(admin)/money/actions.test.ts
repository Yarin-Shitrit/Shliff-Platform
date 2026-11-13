import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HEBREW_FALLBACK, HebrewRefusal } from '@/lib/errors/hebrew';

const { requireAdmin, countAccount, createAccount, setAccountHolder, revalidatePath } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  countAccount: vi.fn(),
  createAccount: vi.fn(),
  setAccountHolder: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/money/accounts', () => ({ countAccount, createAccount, setAccountHolder }));
vi.mock('next/cache', () => ({ revalidatePath }));

import { countAccountAction, createAccountAction, setAccountHolderAction } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  countAccount.mockResolvedValue({ insideCount: 2, afterCount: 1 });
  createAccount.mockResolvedValue({ id: 'a9' });
});

describe('countAccountAction', () => {
  it('refuses a caller who is not an admin, and writes nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await countAccountAction({ accountId: 'a1', balance: 1, countedOn: '2026-09-27' }))
      .toEqual({ ok: false, error: 'אין הרשאה' });
    expect(countAccount).not.toHaveBeenCalled();
  });

  it('reads the day as the date input submitted it, and hands back what the count absorbs', async () => {
    const result = await countAccountAction({ accountId: 'a1', balance: 19042, countedOn: '2026-09-27' });
    expect(result).toEqual({ ok: true, value: { insideCount: 2, afterCount: 1 } });
    expect(countAccount).toHaveBeenCalledWith({}, {
      accountId: 'a1', balance: 19042, countedOn: new Date('2026-09-27T00:00:00Z'),
    });
    // Balances show on the overview, the ledger, the home page and a
    // holder's person page, so the whole layout is revalidated.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('refuses a day that is not a day, in Hebrew, before the library is called', async () => {
    for (const countedOn of ['', '2026-02-30', '27/09/2026']) {
      expect(await countAccountAction({ accountId: 'a1', balance: 1, countedOn }))
        .toEqual({ ok: false, error: 'צריך לבחור את היום שבו נספר הכסף.' });
    }
    expect(countAccount).not.toHaveBeenCalled();
  });

  it("returns the library's refusal verbatim, and never an English message", async () => {
    countAccount.mockRejectedValueOnce(new HebrewRefusal('תאריך הספירה לא יכול להיות בעתיד.'));
    expect(await countAccountAction({ accountId: 'a1', balance: 1, countedOn: '2099-01-01' }))
      .toEqual({ ok: false, error: 'תאריך הספירה לא יכול להיות בעתיד.' });

    countAccount.mockRejectedValueOnce(new Error('connection refused'));
    expect(await countAccountAction({ accountId: 'a1', balance: 1, countedOn: '2026-09-27' }))
      .toEqual({ ok: false, error: HEBREW_FALLBACK });
  });
});

describe('createAccountAction', () => {
  it('creates a counted account, trimming the name', async () => {
    const result = await createAccountAction({
      name: ' בנק הפועלים ', kind: 'bank', balance: 12000, countedOn: '2026-11-01',
    });
    expect(result).toEqual({ ok: true, value: 'a9' });
    expect(createAccount).toHaveBeenCalledWith({}, {
      name: 'בנק הפועלים', kind: 'bank', openingBalance: 12000,
      openingOn: new Date('2026-11-01T00:00:00Z'),
    });
  });

  it('creates an opening account with no day', async () => {
    await createAccountAction({ name: 'קופה', kind: 'cash', balance: 0 });
    expect(createAccount).toHaveBeenCalledWith({}, {
      name: 'קופה', kind: 'cash', openingBalance: 0, openingOn: undefined,
    });
  });

  it('refuses a kind the schema does not know, before anything is written', async () => {
    expect(await createAccountAction({
      name: 'קופה', kind: 'crypto' as never, balance: 0,
    })).toEqual({ ok: false, error: 'סוג החשבון לא מוכר.' });
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('names the duplicate when the driver refuses the name', async () => {
    const driver = Object.assign(new Error('duplicate key value violates unique constraint'), {
      constraint: 'accounts_name_unique',
    });
    createAccount.mockRejectedValueOnce(new Error('insert failed', { cause: driver }));
    expect(await createAccountAction({ name: 'קופת מזומן', kind: 'cash', balance: 0 }))
      .toEqual({ ok: false, error: 'כבר קיים חשבון בשם "קופת מזומן".' });
  });
});

describe('setAccountHolderAction', () => {
  it('refuses a caller who is not an admin, and writes nothing', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    expect(await setAccountHolderAction({ accountId: 'a1', holderPersonId: 'p1' }))
      .toEqual({ ok: false, error: 'אין הרשאה' });
    expect(setAccountHolder).not.toHaveBeenCalled();
  });

  it('hands the library the person, or null for nobody, and refreshes every balance', async () => {
    expect(await setAccountHolderAction({ accountId: 'a1', holderPersonId: 'p1' })).toEqual({ ok: true });
    expect(setAccountHolder).toHaveBeenCalledWith({}, 'a1', 'p1');
    expect(await setAccountHolderAction({ accountId: 'a1', holderPersonId: '' })).toEqual({ ok: true });
    expect(setAccountHolder).toHaveBeenLastCalledWith({}, 'a1', null);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it("returns the library's refusal verbatim, and never an English message", async () => {
    setAccountHolder.mockRejectedValue(new HebrewRefusal('אין חשבון כזה.'));
    expect(await setAccountHolderAction({ accountId: 'a1', holderPersonId: '' }))
      .toEqual({ ok: false, error: 'אין חשבון כזה.' });
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setAccountHolder.mockRejectedValue(new Error('connection refused'));
    expect(await setAccountHolderAction({ accountId: 'a1', holderPersonId: '' }))
      .toEqual({ ok: false, error: HEBREW_FALLBACK });
    logged.mockRestore();
  });
});
