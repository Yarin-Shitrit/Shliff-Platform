/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { ShiftType } from '@/lib/logistics/shifts';

const { push, replace, refresh } = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh }) }));

const { createShiftTypeAction, updateShiftTypeAction, setShiftTypeRetiredAction } = vi.hoisted(() => ({
  createShiftTypeAction: vi.fn(async (): Promise<ActionResult<string>> => ({ ok: true, value: 'new' })),
  updateShiftTypeAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  setShiftTypeRetiredAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => ({ createShiftTypeAction, updateShiftTypeAction, setShiftTypeRetiredAction }));

import { TypeDrawer } from './type-drawer';

const BAR: ShiftType = {
  id: 'bar', name: 'בר', startsClock: '20:00', endsClock: '00:00', peopleNeeded: 2,
  notes: null, retiredAt: null, updatedAt: new Date('2026-05-01T09:00:00Z'), updatedBy: 'lead@shliff.camp',
};

function mount(type: ShiftType | null) {
  return render(
    <ToastProvider>
      <TypeDrawer type={type} closeHref="/logistics/shifts?season=s1" />
    </ToastProvider>,
  );
}

function type(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function press(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('the drawer that adds a kind of shift', () => {
  it('says nothing in English', () => {
    mount(null);
    expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('refuses a blank name beside the field, without a round trip', async () => {
    mount(null);
    await press('הוספת הסוג');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/שם/);
    expect(createShiftTypeAction).not.toHaveBeenCalled();
  });

  it('sends the name, the clocks and the count, then closes', async () => {
    mount(null);
    type(/שם המשמרת/, 'שער');
    type(/שעת התחלה/, '16:00');
    type(/שעת סיום/, '20:00');
    type(/כמה אנשים/, '1');
    await press('הוספת הסוג');
    expect(createShiftTypeAction).toHaveBeenCalledWith({
      name: 'שער', startsClock: '16:00', endsClock: '20:00', peopleNeeded: 1, notes: null,
    });
    expect(push).toHaveBeenCalledWith('/logistics/shifts?season=s1');
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the server\'s refusal and stays open', async () => {
    createShiftTypeAction.mockResolvedValueOnce({ ok: false, error: 'כבר יש סוג משמרת בשם הזה' });
    mount(null);
    type(/שם המשמרת/, 'בר');
    await press('הוספת הסוג');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('כבר יש סוג משמרת בשם הזה');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('the drawer over an existing kind', () => {
  it('starts from the record and saves by id', async () => {
    mount(BAR);
    expect(screen.getByLabelText(/שם המשמרת/)).toHaveProperty('value', 'בר');
    type(/כמה אנשים/, '3');
    await press('שמירה');
    expect(updateShiftTypeAction).toHaveBeenCalledWith('bar', expect.objectContaining({ peopleNeeded: 3 }));
  });

  it('retires only after a confirmation that names the consequence', async () => {
    mount(BAR);
    await press('הוצאה משימוש');
    expect(setShiftTypeRetiredAction).not.toHaveBeenCalled();
    const confirm = screen.getByRole('alertdialog');
    expect(confirm.textContent).toContain('המשמרות שכבר בלוח נשארות');
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'הוצאה משימוש' })); });
    expect(setShiftTypeRetiredAction).toHaveBeenCalledWith('bar', true);
  });

  it('offers to restore a retired kind', async () => {
    mount({ ...BAR, retiredAt: new Date('2026-05-02T09:00:00Z') });
    await press('החזרה לשימוש');
    expect(setShiftTypeRetiredAction).toHaveBeenCalledWith('bar', false);
  });
});
