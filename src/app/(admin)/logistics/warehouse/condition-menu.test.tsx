/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { WarehouseRow } from '@/lib/logistics/warehouse';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { setConditionAction } = vi.hoisted(() => ({
  setConditionAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => ({ setConditionAction }));

import { ConditionMenu } from './condition-menu';

const ITEM: WarehouseRow = {
  id: 'item-1', name: 'משאבת מים', category: 'sanitation', quantity: 2,
  locationText: 'משטח 2', condition: 'ready', notes: null,
  updatedBy: 'lead@shliff.camp', updatedAt: new Date('2026-09-14T10:00:00Z'),
};

function mount(item: WarehouseRow = ITEM) {
  return render(
    <ToastProvider>
      <ConditionMenu item={item} />
    </ToastProvider>,
  );
}

async function open() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /עדכון מצב/ })); });
}

async function choose(label: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })); });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('the quick condition control on a row', () => {
  it('names itself, so the row does not offer an unlabelled button', () => {
    mount();
    expect(screen.getByRole('button', { name: /עדכון מצב/ })).toBeTruthy();
  });

  it('offers all four states in words', async () => {
    // R3: the word carries the meaning. A menu of colours would leave a
    // colour-blind lead choosing between four identical rows.
    mount();
    await open();
    for (const label of ['תקין ומוכן', 'דורש בדיקה', 'דורש תיקון', 'יצא משימוש']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('writes the state that was chosen', async () => {
    mount();
    await open();
    await choose('דורש תיקון');
    expect(setConditionAction).toHaveBeenCalledWith('item-1', 'needs_repair');
  });

  it('refreshes the list, because the row may sort or filter away', async () => {
    // The default sort is worst-first and the `attention` view is a filter on
    // condition, so the row a lead just changed can legitimately leave the
    // view. Leaving it drawn where it was would be a lie about what is stored.
    mount();
    await open();
    await choose('דורש תיקון');
    expect(refresh).toHaveBeenCalled();
  });

  it('offers to undo by writing the previous state back', async () => {
    // E2: undo is the domain inverse, not a UI stack. Setting the old
    // condition back is exactly what happened before, including the fact that
    // somebody changed it — the change log is not rewritten.
    mount();
    await open();
    await choose('דורש תיקון');

    const undo = await screen.findByRole('button', { name: /ביטול/ });
    setConditionAction.mockClear();
    await act(async () => { fireEvent.click(undo); });
    expect(setConditionAction).toHaveBeenCalledWith('item-1', 'ready');
  });

  it('reports a refusal rather than pretending the change landed', async () => {
    setConditionAction.mockResolvedValueOnce({ ok: false, error: 'לא מצאנו את הפריט הזה במחסן' });
    mount();
    await open();
    await choose('דורש תיקון');

    expect(await screen.findByText('לא מצאנו את הפריט הזה במחסן')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not offer the state the item is already in', async () => {
    // Choosing it would write a no-op, stamp a new `updatedBy`, and report a
    // change that did not happen.
    mount();
    await open();
    const current = screen.getByRole('button', { name: /תקין ומוכן/ }) as HTMLButtonElement;
    expect(current.disabled).toBe(true);
  });
});
