/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { AccountFund } from '@/db/schema/money';

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

const { setAccountFundAction } = vi.hoisted(() => ({
  setAccountFundAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => ({ setAccountFundAction }));

import { FundDrawer } from './fund-drawer';

const CLOSE = '/money?season=s1';

function renderDrawer(fund: AccountFund | null = null) {
  return render(
    <ToastProvider>
      <FundDrawer account={{ id: 'a1', name: 'עו״ש אופק', fund }} closeHref={CLOSE} />
    </ToastProvider>,
  );
}

function pot(name: string): HTMLInputElement {
  return screen.getByRole('radio', { name }) as HTMLInputElement;
}

describe('FundDrawer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /*
   * The system cannot tell the camp's money from the gift's by an account's
   * name or kind. A pre-selected answer would be a guess the lead only has to
   * not notice — so an unplaced account opens with neither pot chosen.
   */
  it('chooses neither pot for an account nobody has placed, and says what that costs', () => {
    renderDrawer(null);
    expect(pot('הקאמפ').checked).toBe(false);
    expect(pot('הגיפט').checked).toBe(false);
    expect(screen.getByText('עוד לא נקבע')).toBeTruthy();
    expect(screen.getByText(/היתרה שלו לא נספרת באף אחת משתי היתרות/)).toBeTruthy();
  });

  it('refuses to save with neither pot chosen, before any round trip', () => {
    renderDrawer(null);
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(screen.getByText('צריך לבחור של מי הכסף: של הקאמפ או של הגיפט.').getAttribute('role'))
      .toBe('alert');
    expect(setAccountFundAction).not.toHaveBeenCalled();
  });

  it('opens on the pot the account is in, and says what that pot is for', () => {
    renderDrawer('gift');
    expect(pot('הגיפט').checked).toBe(true);
    expect(pot('הקאמפ').checked).toBe(false);
    expect(screen.getByText('כרגע: של הגיפט')).toBeTruthy();
    expect(screen.getByText(/כסף המסיבות, בשביל הגיפט/)).toBeTruthy();
  });

  it('follows the choice with the sentence under it', () => {
    renderDrawer('gift');
    fireEvent.click(pot('הקאמפ'));
    expect(screen.getByText(/דמי הקאמפ וההוצאות של המחנה\. היתרה של החשבון תיספר ביתרת הקאמפ\./))
      .toBeTruthy();
  });

  it('says that placing an account moves no money', () => {
    renderDrawer(null);
    expect(screen.getByText(/השיוך לא מזיז כסף ולא משנה אף תנועה/)).toBeTruthy();
  });

  it('saves the chosen pot, says which balance it is counted in now, then closes', async () => {
    renderDrawer(null);
    fireEvent.click(pot('הקאמפ'));
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await vi.waitFor(() => expect(setAccountFundAction)
      .toHaveBeenCalledWith({ accountId: 'a1', fund: 'camp' }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith(CLOSE));
    expect(refresh).toHaveBeenCalled();
    expect((await screen.findByRole('status')).textContent)
      .toContain('עו״ש אופק נספר עכשיו ביתרת הקאמפ.');
  });

  it('shows the refusal the action hands back, in place, and stays open', async () => {
    setAccountFundAction.mockResolvedValueOnce({ ok: false, error: 'אין חשבון כזה.' });
    renderDrawer('camp');
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    const refusal = await screen.findByText('אין חשבון כזה.');
    expect(refusal.getAttribute('role')).toBe('alert');
    expect(replace).not.toHaveBeenCalled();
  });
});
