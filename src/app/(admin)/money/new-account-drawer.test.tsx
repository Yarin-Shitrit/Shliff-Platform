/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

const { createAccountAction } = vi.hoisted(() => ({
  createAccountAction: vi.fn(async (): Promise<ActionResult<string>> => ({ ok: true, value: 'a9' })),
}));
vi.mock('./actions', () => ({ createAccountAction }));

import { NewAccountDrawer } from './new-account-drawer';

const CLOSE = '/money?season=s1';

function renderDrawer() {
  return render(
    <ToastProvider>
      <NewAccountDrawer closeHref={CLOSE} />
    </ToastProvider>,
  );
}

describe('NewAccountDrawer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('offers the four kinds by their Hebrew names, never a raw enum value', () => {
    renderDrawer();
    const options = (screen.getByLabelText('סוג') as HTMLSelectElement).options;
    expect([...options].map((one) => one.textContent)).toEqual(['מזומן', 'בנק', 'חשבון פרטי', 'קופת אירוע']);
  });

  /*
   * Count or opening is the lead's call, never the system's guess. The box
   * opens ticked — the whole reason the drawer exists is "what I have now"
   * — and each state says what it does.
   */
  it('opens as a count of today, and turns into an opening when the box is cleared', () => {
    renderDrawer();
    expect((screen.getByLabelText(/זו ספירה של מה שיש בחשבון/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText('נכון לתאריך')).toBeTruthy();
    expect(screen.getByText(/תנועות עד היום הזה \(כולל\) ייחשבו ככלולות בסכום/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/זו ספירה של מה שיש בחשבון/));
    expect(screen.queryByLabelText('נכון לתאריך')).toBeNull();
    expect(screen.getByText(/יתרת פתיחה: כל תנועה שתירשם על החשבון/)).toBeTruthy();
  });

  /*
   * Whose money a new account holds is the other thing the system cannot
   * know. Neither pot is chosen in advance, and the drawer does not save
   * until the lead has said — a default here would file every new account
   * under the camp, the gift's included.
   */
  it('chooses neither pot in advance, and refuses to add an account until one is chosen', () => {
    renderDrawer();
    expect((screen.getByRole('radio', { name: 'הקאמפ' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('radio', { name: 'הגיפט' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByLabelText('שם'), { target: { value: 'קופה' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספת החשבון' }));
    expect(screen.getByText('צריך לבחור של מי הכסף: של הקאמפ או של הגיפט.')).toBeTruthy();
    expect(createAccountAction).not.toHaveBeenCalled();
  });

  it('says what the chosen pot is for', () => {
    renderDrawer();
    expect(screen.getByText('לקאמפ ולגיפט יש כסף נפרד, וכל חשבון שייך לאחד מהם.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'הגיפט' }));
    expect(screen.getByText('כסף המסיבות, בשביל הגיפט.')).toBeTruthy();
  });

  it('creates a counted account with its day, then closes', async () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('שם'), { target: { value: ' בנק הפועלים ' } });
    fireEvent.change(screen.getByLabelText('סוג'), { target: { value: 'bank' } });
    fireEvent.click(screen.getByRole('radio', { name: 'הגיפט' }));
    fireEvent.change(screen.getByLabelText('כמה כסף יש בחשבון'), { target: { value: '12000' } });
    fireEvent.change(screen.getByLabelText('נכון לתאריך'), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספת החשבון' }));
    await vi.waitFor(() => expect(createAccountAction).toHaveBeenCalledWith({
      name: ' בנק הפועלים ', kind: 'bank', fund: 'gift', balance: 12000, countedOn: '2026-11-01',
    }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith(CLOSE));
    expect(refresh).toHaveBeenCalled();
    expect((await screen.findByRole('status')).textContent).toContain('החשבון בנק הפועלים נוסף.');
  });

  it('creates an opening account with no day, and an empty amount as zero', async () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('שם'), { target: { value: 'קופה חדשה' } });
    fireEvent.click(screen.getByRole('radio', { name: 'הקאמפ' }));
    fireEvent.click(screen.getByLabelText(/זו ספירה של מה שיש בחשבון/));
    fireEvent.click(screen.getByRole('button', { name: 'הוספת החשבון' }));
    await vi.waitFor(() => expect(createAccountAction).toHaveBeenCalledWith({
      name: 'קופה חדשה', kind: 'cash', fund: 'camp', balance: 0, countedOn: undefined,
    }));
  });

  it('refuses a blank name and a non-numeric amount before the round trip', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'הוספת החשבון' }));
    expect(screen.getByText('לחשבון חייב להיות שם')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('שם'), { target: { value: 'קופה' } });
    fireEvent.click(screen.getByRole('radio', { name: 'הקאמפ' }));
    fireEvent.change(screen.getByLabelText('כמה כסף יש בחשבון'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספת החשבון' }));
    expect(screen.getByText('הסכום שהוזן אינו מספר. הקלידו סכום בשקלים.')).toBeTruthy();
    expect(createAccountAction).not.toHaveBeenCalled();
  });

  it('shows the refusal the action hands back, in place', async () => {
    createAccountAction.mockResolvedValueOnce({ ok: false, error: 'כבר קיים חשבון בשם "קופה".' });
    renderDrawer();
    fireEvent.change(screen.getByLabelText('שם'), { target: { value: 'קופה' } });
    fireEvent.click(screen.getByRole('radio', { name: 'הקאמפ' }));
    fireEvent.click(screen.getByRole('button', { name: 'הוספת החשבון' }));
    // Found by its text: the toaster's own live region is an alert too, and
    // it is in the tree from the first render.
    const refusal = await screen.findByText('כבר קיים חשבון בשם "קופה".');
    expect(refusal.getAttribute('role')).toBe('alert');
    expect(replace).not.toHaveBeenCalled();
  });
});
