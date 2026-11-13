/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

const { setAccountHolderAction } = vi.hoisted(() => ({
  setAccountHolderAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ setAccountHolderAction }));

import { HolderDrawer, NOBODY_LABEL } from './holder-drawer';

const CLOSE = '/money?season=s1';
const PEOPLE = [{ id: 'p1', displayName: 'אופק' }, { id: 'p2', displayName: 'רוני' }];

function renderDrawer(holder: { id: string; name: string } | null = { id: 'p1', name: 'אופק' }) {
  return render(
    <ToastProvider>
      <HolderDrawer
        account={{ id: 'a1', name: 'עו״ש אופק', holderPersonId: holder?.id ?? null, holderName: holder?.name ?? null }}
        people={PEOPLE}
        closeHref={CLOSE}
      />
    </ToastProvider>,
  );
}

describe('HolderDrawer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('names the account, says who holds it now, and offers the people and nobody', () => {
    renderDrawer();
    expect(screen.getByRole('heading', { name: 'מי מחזיק/ה את עו״ש אופק' })).toBeTruthy();
    expect(screen.getByText('כרגע רשום על אופק')).toBeTruthy();
    const select = screen.getByLabelText('מי מחזיק/ה') as HTMLSelectElement;
    expect(select.value).toBe('p1');
    expect([...select.options].map((option) => option.textContent)).toEqual([NOBODY_LABEL, 'אופק', 'רוני']);
  });

  it('says what each choice does before the button', () => {
    renderDrawer();
    const select = screen.getByLabelText('מי מחזיק/ה');
    fireEvent.change(select, { target: { value: 'p2' } });
    expect(screen.getByText('החשבון יופיע בדף של רוני. היתרה והתנועות לא משתנות.')).toBeTruthy();
    fireEvent.change(select, { target: { value: '' } });
    expect(screen.getByText(/רק לא יהיה רשום מי מחזיק את הכסף/)).toBeTruthy();
  });

  it('hands the choice to the action, reports it, closes and refreshes', async () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('מי מחזיק/ה'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() => { expect(setAccountHolderAction).toHaveBeenCalledWith({ accountId: 'a1', holderPersonId: '' }); });
    await waitFor(() => { expect(replace).toHaveBeenCalledWith(CLOSE); });
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('עו״ש אופק כבר לא רשום על אף אחד.');
  });

  it('shows the refusal in the drawer, in the library’s words, and stays open', async () => {
    setAccountHolderAction.mockResolvedValueOnce({ ok: false, error: 'האדם שנבחר לא נמצא ברשימת האנשים.' });
    renderDrawer(null);
    expect(screen.getByText('כרגע לא רשום על אף אחד')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() => {
      // The toaster's live region is an alert too; the refusal is the one with text.
      expect(screen.getByText('האדם שנבחר לא נמצא ברשימת האנשים.').getAttribute('role')).toBe('alert');
    });
    expect(replace).not.toHaveBeenCalled();
  });
});
