/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh }) }));

const { detachObligationPartyAction } = vi.hoisted(() => ({
  detachObligationPartyAction: vi.fn(async (): Promise<ActionResult<string>> => ({ ok: true, value: 'רוני אדלר' })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ detachObligationPartyAction }));

import { DetachParty, DETACH_LABEL } from './detach-party';

function renderControl() {
  return render(
    <ToastProvider>
      <DetachParty obligationId="o1" displayParty="רוני אדלר" description="מקדמה לגנרטור" />
    </ToastProvider>,
  );
}

describe('DetachParty', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('says what it is for and does nothing until the verb is confirmed', () => {
    renderControl();
    expect(screen.getByText(/כדי למחוק את הרשומה הזו מרשימת האנשים/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: DETACH_LABEL }));
    const dialog = screen.getByRole('alertdialog', { name: 'ניתוק החוב מהאדם' });
    expect(dialog.textContent).toContain('יישאר רשום על השם רוני אדלר כטקסט חופשי');
    expect(detachObligationPartyAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(detachObligationPartyAction).not.toHaveBeenCalled();
  });

  it('cuts the link on confirm, says so, and refreshes the page', async () => {
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: DETACH_LABEL }));
    fireEvent.click(screen.getAllByRole('button', { name: DETACH_LABEL }).at(-1)!);
    await waitFor(() => { expect(detachObligationPartyAction).toHaveBeenCalledWith('o1'); });
    await waitFor(() => { expect(refresh).toHaveBeenCalled(); });
    expect(screen.getByRole('status').textContent).toContain('כבר לא מקושר לרשומה של רוני אדלר');
  });

  it('shows the refusal beside the control, in the library’s words', async () => {
    detachObligationPartyAction.mockResolvedValueOnce({ ok: false, error: 'החוב הזה לא מקושר לאדם — אין מה לנתק.' });
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: DETACH_LABEL }));
    fireEvent.click(screen.getAllByRole('button', { name: DETACH_LABEL }).at(-1)!);
    await waitFor(() => {
      // The toaster's live region is an alert too; the refusal is the one with text.
      expect(screen.getByText('החוב הזה לא מקושר לאדם — אין מה לנתק.').getAttribute('role')).toBe('alert');
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
