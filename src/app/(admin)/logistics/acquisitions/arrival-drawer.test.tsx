/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { AcquisitionRow } from '@/lib/logistics/acquisitions';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));

const { recordArrivalAction } = vi.hoisted(() => ({
  recordArrivalAction: vi.fn(async (): Promise<ActionResult<string>> => ({ ok: true, value: 'item-9' })),
}));
vi.mock('./actions', () => ({ recordArrivalAction }));

import { ArrivalDrawer, type WarehouseOption } from './arrival-drawer';

const ROW: AcquisitionRow = {
  seasonId: 's26', id: 'acq-1', name: 'מקדחה רוטטת', category: 'build', quantityNeeded: 1,
  source: 'buy_new', estimatedAgorot: 40000, actualAgorot: 38000,
  assignee: null, lender: null, budgetLineId: null, arrivedItemId: null,
  status: 'ordered', updatedAt: new Date('2026-09-14T10:00:00Z'), updatedBy: null,
};

const ITEMS: WarehouseOption[] = [
  { id: 'inv-1', name: 'ברגים לעץ', locationText: 'ארגז קטן', quantity: 100 },
  { id: 'inv-2', name: 'מקדחה רוטטת', locationText: 'ארגז גדול #2', quantity: 1 },
];

const LINES = [{ id: 'line-1', label: 'ציוד והקמה', totalAgorot: 500000 }];

function mount(row: AcquisitionRow = ROW, items: WarehouseOption[] = []) {
  return render(
    <ToastProvider>
      <ArrivalDrawer row={row} items={items} budgetLines={LINES} closeHref="/logistics/acquisitions" />
    </ToastProvider>,
  );
}

function type(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'רישום למחסן' }));
  });
}

function refusal(): string {
  return within(screen.getByRole('dialog')).getByRole('alert').textContent ?? '';
}

beforeEach(() => { vi.clearAllMocks(); });

describe('the arrival decision', () => {
  it('says out loud that the system does not know, rather than filling it in', () => {
    // The whole reason this drawer exists: arrival is known, storage is not.
    mount();
    expect(screen.getByRole('dialog').textContent).toMatch(/לא ממציאה|לא יודעת/);
  });

  it('is written in Hebrew throughout', () => {
    mount();
    expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('defaults to a new item when the warehouse holds nothing by that name', () => {
    mount(ROW, [ITEMS[0]]);
    expect(screen.getByLabelText(/מיקום במחסן/)).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: /הפריט במחסן/ }).textContent).toMatch(/פריט חדש/);
  });

  it('defaults to merging when the warehouse already holds that name', () => {
    // A reading of the data, not a guess about intent — and the hint says
    // which of the two it found, so the lead can see the reason and overrule.
    mount(ROW, ITEMS);
    expect(screen.getByLabelText(/לאיזה פריט זה מצטרף/)).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toMatch(/כבר יש/);
  });

  it('refuses a new item with no location, before the round trip', async () => {
    mount();
    await submit();
    expect(recordArrivalAction).not.toHaveBeenCalled();
    expect(refusal()).toMatch(/מיקום/);
  });

  it('refuses an arrival of nothing', async () => {
    mount();
    type(/מיקום במחסן/, 'ארגז גדול #2');
    type(/כמות שנכנסת/, '0');
    await submit();
    expect(recordArrivalAction).not.toHaveBeenCalled();
    expect(refusal()).toMatch(/אחד או יותר/);
  });

  it('sends the two answers it asked for', async () => {
    mount();
    type(/מיקום במחסן/, 'ארגז גדול #2');
    await submit();

    expect(recordArrivalAction).toHaveBeenCalledWith(expect.objectContaining({
      acquisitionId: 'acq-1',
      target: { kind: 'new', locationText: 'ארגז גדול #2', condition: 'ready' },
      quantity: 1,
    }));
  });

  it('sends the existing row when a lead says it is more of something owned', async () => {
    mount(ROW, ITEMS);
    type(/כמות שנכנסת/, '2');
    await submit();

    expect(recordArrivalAction).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'existing', itemId: 'inv-2' },
      quantity: 2,
    }));
  });

  it('never offers to receive something as already out of service', () => {
    // Nothing arrives at the camp retired, and offering it here would turn a
    // receiving question into an invitation to file something away unseen.
    mount();
    const states = screen.getByRole('radiogroup', { name: /מצב הפריט בקבלה/ });
    expect(within(states).queryByText('יצא משימוש')).toBeNull();
    expect(within(states).getByText('דורש תיקון')).toBeTruthy();
  });

  it('shows what will be counted outside the budget if no line is chosen', () => {
    mount();
    expect(screen.getByRole('dialog').textContent).toMatch(/380/);
  });

  it('reports a refusal from the action instead of closing', async () => {
    recordArrivalAction.mockResolvedValueOnce({
      ok: false, error: 'הפריט הזה כבר נרשם למחסן. אפשר לפתוח אותו מהמחסן ולעדכן שם את הכמות.',
    });
    mount();
    type(/מיקום במחסן/, 'ארגז');
    await submit();

    expect(push).not.toHaveBeenCalled();
    expect(refusal()).toMatch(/כבר נרשם למחסן/);
  });

  it('returns to the list and refreshes both screens once it is registered', async () => {
    mount();
    type(/מיקום במחסן/, 'ארגז');
    await submit();
    expect(push).toHaveBeenCalledWith('/logistics/acquisitions');
    expect(refresh).toHaveBeenCalled();
  });
});
