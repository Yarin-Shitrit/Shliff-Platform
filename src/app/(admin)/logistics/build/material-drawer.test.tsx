/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));

const { addMaterialAction } = vi.hoisted(() => ({
  addMaterialAction: vi.fn(async (): Promise<ActionResult<string>> => ({ ok: true, value: 'm9' })),
}));
vi.mock('./actions', () => ({ addMaterialAction, removeMaterialAction: vi.fn() }));

import { MaterialDrawer, type StockOption, type OrderOption } from './material-drawer';

const STOCK: StockOption[] = [
  { id: 'inv-1', name: 'משטחי עץ', locationText: 'מאחורי המכולה', condition: 'ready' },
];
const ORDERS: OrderOption[] = [
  { id: 'acq-1', name: 'ברגים לעץ', status: 'ordered' },
];

function mount() {
  return render(
    <ToastProvider>
      <MaterialDrawer
        taskId="t1"
        taskTitle="בניית ספסלים"
        stock={STOCK}
        orders={ORDERS}
        closeHref="/logistics/build"
      />
    </ToastProvider>,
  );
}

function pick(label: string) {
  fireEvent.click(screen.getByRole('radio', { name: label }));
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'הוספת החומר' }));
  });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('adding a material to a build task', () => {
  it('is written in Hebrew throughout', () => {
    mount();
    expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('says the state is computed, so nobody looks for a status field', () => {
    // The schema has no status column and this is the sentence that explains
    // why: a stored one would still read `במחסן` after somebody took the thing.
    mount();
    expect(screen.getByRole('dialog').textContent).toMatch(/מחושב, לא נבחר/);
  });

  it('offers "not known yet" as an answer rather than leaving it out', () => {
    // A task needing something nobody has dealt with is a real state, and the
    // one this screen exists to surface.
    mount();
    expect(screen.getByRole('radio', { name: 'עוד לא ידוע' })).toBeTruthy();
  });

  it('records a material nobody has sourced yet, with neither link', async () => {
    mount();
    fireEvent.change(screen.getByLabelText(/^מה צריך/), { target: { value: 'דבק' } });
    await submit();

    expect(addMaterialAction).toHaveBeenCalledWith({
      taskId: 't1', name: 'דבק', quantityNeeded: 1,
      inventoryItemId: null, acquisitionItemId: null,
    });
  });

  it('links to the shelf when a lead says it is in the warehouse', async () => {
    mount();
    pick('מהמחסן');
    fireEvent.change(screen.getByLabelText(/איזה פריט במחסן/), { target: { value: 'inv-1' } });
    await submit();

    expect(addMaterialAction).toHaveBeenCalledWith(expect.objectContaining({
      inventoryItemId: 'inv-1', acquisitionItemId: null,
    }));
  });

  it('borrows the name from the row that was picked, when none was typed', async () => {
    // The thing is usually called what it is called in the warehouse, and a
    // lead who wants it called something else can type over it.
    mount();
    pick('מהמחסן');
    fireEvent.change(screen.getByLabelText(/איזה פריט במחסן/), { target: { value: 'inv-1' } });
    expect((screen.getByLabelText(/^מה צריך/) as HTMLInputElement).value).toBe('משטחי עץ');
  });

  it('never sends both links, because the state is derived from one', async () => {
    mount();
    pick('מהמחסן');
    fireEvent.change(screen.getByLabelText(/איזה פריט במחסן/), { target: { value: 'inv-1' } });
    pick('מרשימת הרכש');
    fireEvent.change(screen.getByLabelText(/איזה פריט ברכש/), { target: { value: 'acq-1' } });
    await submit();

    expect(addMaterialAction).toHaveBeenCalledWith(expect.objectContaining({
      inventoryItemId: null, acquisitionItemId: 'acq-1',
    }));
  });

  it('refuses a nameless material before the round trip', async () => {
    mount();
    await submit();
    expect(addMaterialAction).not.toHaveBeenCalled();
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/שם/);
  });

  it('refuses a chosen source with nothing chosen in it', async () => {
    mount();
    fireEvent.change(screen.getByLabelText(/^מה צריך/), { target: { value: 'ברגים' } });
    pick('מרשימת הרכש');
    await submit();

    expect(addMaterialAction).not.toHaveBeenCalled();
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/לבחור/);
  });

  it('returns to the list and refreshes once it is stored', async () => {
    mount();
    fireEvent.change(screen.getByLabelText(/^מה צריך/), { target: { value: 'דבק' } });
    await submit();
    expect(push).toHaveBeenCalledWith('/logistics/build');
    expect(refresh).toHaveBeenCalled();
  });
});
