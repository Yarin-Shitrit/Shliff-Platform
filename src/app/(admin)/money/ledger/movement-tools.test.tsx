/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';

/** `fireEvent`, not `@testing-library/user-event`: R1 admits no new dependency. */

const { deleteMovementAction, refresh } = vi.hoisted(() => ({
  deleteMovementAction: vi.fn<(id: string) => Promise<ActionResult>>(),
  refresh: vi.fn(),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ deleteMovementAction }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace: vi.fn() }) }));

import { MovementTools } from './movement-tools';

const EDIT = '/money/ledger?season=s1&peek=e7&act=edit';

function renderTools(over: Record<string, unknown> = {}) {
  render(
    <MovementTools
      movementId="e7"
      description="החזר לעמי — סוללות"
      amountAgorot={25000}
      balanceOf="קופת מסיבות"
      editHref={EDIT}
      {...over}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteMovementAction.mockResolvedValue({ ok: true });
});

describe('the correct and remove controls of a movement', () => {
  it('links to the edit drawer and names both controls after the movement', () => {
    renderTools();
    expect(screen.getByRole('link', { name: 'תיקון החזר לעמי — סוללות' }).getAttribute('href'))
      .toBe(EDIT);
    expect(screen.getByRole('button', { name: 'מחיקת החזר לעמי — סוללות' })).toBeTruthy();
  });

  it('removes nothing until the removal is confirmed', () => {
    renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת החזר לעמי — סוללות' }));
    expect(deleteMovementAction).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'ביטול' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(deleteMovementAction).not.toHaveBeenCalled();
  });

  it('names the movement, the amount and the balance that will change', () => {
    renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת החזר לעמי — סוללות' }));
    const text = screen.getByRole('alertdialog').textContent ?? '';
    expect(text).toContain('החזר לעמי — סוללות');
    expect(text).toContain('250 ₪');
    expect(text).toContain('היתרה של קופת מסיבות תשתנה בהתאם');
    expect(text).toContain('אי אפשר יהיה לשחזר');
  });

  /** A movement with no account, or inside its account's count, moves no
   *  balance when it goes — and the confirmation must not claim it does. */
  it('says no balance changes when none will', () => {
    renderTools({ balanceOf: null });
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת החזר לעמי — סוללות' }));
    const text = screen.getByRole('alertdialog').textContent ?? '';
    expect(text).toContain('היתרה של החשבונות לא תשתנה');
    expect(text).not.toContain('תשתנה בהתאם');
  });

  it('removes the movement once confirmed, and refreshes the table', async () => {
    renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת החזר לעמי — סוללות' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'מחיקת התנועה' }));
    await vi.waitFor(() => { expect(deleteMovementAction).toHaveBeenCalledWith('e7'); });
    await vi.waitFor(() => { expect(refresh).toHaveBeenCalledTimes(1); });
  });

  it('shows the refusal on the row and refreshes nothing', async () => {
    deleteMovementAction.mockResolvedValue({
      ok: false, error: 'התנועה הזו סוגרת חוב. בטלו את הסגירה בדף החובות לפני שמוחקים אותה.',
    });
    renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת החזר לעמי — סוללות' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'מחיקת התנועה' }));
    expect((await screen.findByRole('alert')).textContent).toContain('סוגרת חוב');
    expect(refresh).not.toHaveBeenCalled();
  });
});
