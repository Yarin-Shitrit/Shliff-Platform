/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { CountResult } from '@/lib/money/accounts';

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

const { countAccountAction } = vi.hoisted(() => ({
  countAccountAction: vi.fn(async (): Promise<ActionResult<CountResult>> => (
    { ok: true, value: { insideCount: 2, afterCount: 1 } }
  )),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ countAccountAction }));

import { CountDrawer, absorbedSentence } from './count-drawer';
import type { CountableAccount } from './count-drawer';

const CLOSE = '/money?season=s1';

function account(over: Partial<CountableAccount> = {}): CountableAccount {
  return {
    id: 'a1', name: 'קופת מזומן', balanceAgorot: 158400,
    countedAgorot: 0, countedOn: null, ...over,
  };
}

function renderDrawer(over: Partial<CountableAccount> = {}) {
  return render(
    <ToastProvider>
      <CountDrawer account={account(over)} closeHref={CLOSE} />
    </ToastProvider>,
  );
}

describe('CountDrawer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('names the account and says what the system shows today', () => {
    renderDrawer();
    expect(screen.getByRole('heading', { name: 'ספירת קופת מזומן' })).toBeTruthy();
    expect(screen.getByText(/היום לפי המערכת/).textContent).toContain('1,584 ₪');
    expect((screen.getByLabelText('נכון לתאריך') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /*
   * The consequence is stated before the button: what the day does to the
   * movements on either side of it, and what the account carries now.
   */
  /*
   * The drawer opens on today, and so does every payment form. A payment
   * typed tonight with today's date is inside a count made at noon, so the
   * warning is there while today is chosen and gone for any other day.
   */
  it('warns, while today is the count day, that today’s later movements will not move the balance', () => {
    renderDrawer();
    expect(screen.getByText(/בחשבון בסוף היום שתבחרו/)).toBeTruthy();
    expect(screen.getByText(/בחרתם את היום/).textContent).toContain('ספרו שוב בסוף היום');
    fireEvent.change(screen.getByLabelText('נכון לתאריך'), { target: { value: '2025-10-30' } });
    expect(screen.queryByText(/בחרתם את היום/)).toBeNull();
  });

  it('says what the count day does, and that a never-counted account is an opening', () => {
    renderDrawer();
    expect(screen.getByText(/תנועות עד היום הזה \(כולל\) כבר כלולות בסכום/)).toBeTruthy();
    expect(screen.getByText(/החשבון עדיין לא נספר/).textContent).toContain('יתרת פתיחה של 0 ₪');
  });

  it('warns that an earlier count will be replaced, with its figure and its day', () => {
    renderDrawer({ countedAgorot: 1904200, countedOn: new Date('2026-09-27T00:00:00Z') });
    const warning = screen.getByText(/הספירה הקודמת/);
    expect(warning.textContent).toContain('19,042 ₪');
    expect(warning.textContent).toContain('27/09/26');
    expect(warning.textContent).toContain('תוחלף');
    expect(screen.queryByText(/החשבון עדיין לא נספר/)).toBeNull();
  });

  it('saves the count in shekels with the day, then closes and reports what the figure rests on', async () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('כמה כסף יש בחשבון'), { target: { value: '19042' } });
    fireEvent.change(screen.getByLabelText('נכון לתאריך'), { target: { value: '2026-09-27' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הספירה' }));
    await vi.waitFor(() => expect(countAccountAction).toHaveBeenCalledWith({
      accountId: 'a1', balance: 19042, countedOn: '2026-09-27',
    }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith(CLOSE));
    expect(refresh).toHaveBeenCalled();
    expect((await screen.findByRole('status')).textContent)
      .toContain('הספירה של קופת מזומן נשמרה. 2 תנועות עד אותו יום כלולות בספירה, ותנועה אחת מאוחרת יותר כבר משנה אותה.');
  });

  it('refuses an empty or non-numeric amount and a missing day before the round trip', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הספירה' }));
    expect(screen.getByText('הסכום שהוזן אינו מספר. הקלידו סכום בשקלים.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('כמה כסף יש בחשבון'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הספירה' }));
    expect(screen.getByText('הסכום שהוזן אינו מספר. הקלידו סכום בשקלים.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('כמה כסף יש בחשבון'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('נכון לתאריך'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הספירה' }));
    expect(screen.getByText('צריך לבחור את היום שבו נספר הכסף.')).toBeTruthy();
    expect(countAccountAction).not.toHaveBeenCalled();
  });

  // A personal account can be below zero: the holder laid out more than
  // they were given. The drawer refuses no sign; the library's own rules apply.
  it('accepts a negative count', async () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('כמה כסף יש בחשבון'), { target: { value: '-350.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הספירה' }));
    await vi.waitFor(() => expect(countAccountAction).toHaveBeenCalledWith(
      expect.objectContaining({ balance: -350.5 }),
    ));
  });

  it('shows the refusal the action hands back, in place', async () => {
    countAccountAction.mockResolvedValueOnce({ ok: false, error: 'תאריך הספירה לא יכול להיות בעתיד.' });
    renderDrawer();
    fireEvent.change(screen.getByLabelText('כמה כסף יש בחשבון'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הספירה' }));
    // Found by its text: the toaster's own live region is an alert too, and
    // it is in the tree from the first render.
    const refusal = await screen.findByText('תאריך הספירה לא יכול להיות בעתיד.');
    expect(refusal.getAttribute('role')).toBe('alert');
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('absorbedSentence', () => {
  it('agrees with the numbers', () => {
    expect(absorbedSentence(0, 0))
      .toBe('אף תנועה רשומה לא קדמה לספירה, ורק תנועה שתאריכה אחרי אותו יום תשנה את היתרה.');
    expect(absorbedSentence(1, 1))
      .toBe('תנועה אחת עד אותו יום כלולה בספירה, ותנועה אחת מאוחרת יותר כבר משנה אותה.');
    expect(absorbedSentence(3, 2))
      .toBe('3 תנועות עד אותו יום כלולות בספירה, ו־2 תנועות מאוחרות יותר כבר משנות אותה.');
  });
});
