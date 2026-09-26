/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { WarehouseRow } from '@/lib/logistics/warehouse';

const { push, replace, refresh } = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh }) }));

/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
const { createItemAction, updateItemAction } = vi.hoisted(() => ({
  createItemAction: vi.fn(async (): Promise<ActionResult<string>> => ({ ok: true, value: 'new-id' })),
  updateItemAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => ({ createItemAction, updateItemAction }));

import { ItemDrawer } from './item-drawer';

const ITEM: WarehouseRow = {
  id: 'item-1', name: 'סיר תעשייתי', category: 'kitchen', quantity: 2,
  locationText: 'ארגז כחול #1', condition: 'ready', notes: null,
  updatedBy: 'lead@shliff.camp', updatedAt: new Date('2026-09-14T10:00:00Z'),
};

function mount(item: WarehouseRow | null) {
  return render(
    <ToastProvider>
      <ItemDrawer item={item} closeHref="/logistics/warehouse" />
    </ToastProvider>,
  );
}

function type(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function submit(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
}

/**
 * Scoped to the drawer on purpose: `ToastProvider` renders its assertive live
 * region as `role="alert"` whether or not it is holding a message, so an
 * unscoped query finds two and fails for a reason that has nothing to do with
 * the refusal being tested.
 */
function refusal(): string {
  return within(screen.getByRole('dialog')).getByRole('alert').textContent ?? '';
}

beforeEach(() => { vi.clearAllMocks(); });

describe('the drawer that adds an item by hand', () => {
  it('says nothing in English, because it is read on a Hebrew screen', () => {
    mount(null);
    const dialog = screen.getByRole('dialog');
    // R9. The regex is deliberately over-broad: it catches a placeholder and a
    // hint as well as a label, which is where English usually survives review.
    expect(dialog.textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('opens empty rather than pre-filling a guess', () => {
    // The system never guesses. A default category or a default location would
    // be a value nobody chose, indistinguishable afterwards from one somebody
    // did — which is the whole ambiguity this platform exists to remove.
    mount(null);
    expect((screen.getByLabelText(/שם הפריט/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/מיקום במחסן/) as HTMLInputElement).value).toBe('');
  });

  it('refuses a blank name here, before the round trip', async () => {
    mount(null);
    type(/מיקום במחסן/, 'מכולה');
    await submit('הוספת הפריט');

    expect(createItemAction).not.toHaveBeenCalled();
    expect(refusal()).toMatch(/שם/);
  });

  it('refuses a blank location, and says why on the screen', async () => {
    mount(null);
    type(/שם הפריט/, 'מקדחה');
    await submit('הוספת הפריט');

    expect(createItemAction).not.toHaveBeenCalled();
    expect(refusal()).toMatch(/מיקום/);
  });

  it('sends what was typed, with the quantity as a number', async () => {
    mount(null);
    type(/שם הפריט/, '  אוהל צל  ');
    type(/מיקום במחסן/, 'מכולה');
    type(/כמות/, '3');
    await submit('הוספת הפריט');

    expect(createItemAction).toHaveBeenCalledWith(expect.objectContaining({
      name: '  אוהל צל  ', locationText: 'מכולה', quantity: 3,
    }));
  });

  it('treats an empty quantity box as zero rather than as NaN', async () => {
    // `Number('')` is 0 and `Number(' ')` is 0, but `Number('x')` is NaN, and
    // a NaN reaching the action is refused with a message about whole numbers
    // that names nothing the lead can see. The box starts at 0 for that reason.
    mount(null);
    type(/שם הפריט/, 'בלוני גז');
    type(/מיקום במחסן/, 'מכולה');
    type(/כמות/, '');
    await submit('הוספת הפריט');

    expect(createItemAction).toHaveBeenCalledWith(expect.objectContaining({ quantity: 0 }));
  });

  it('shows the refusal the action returned rather than closing on a failure', async () => {
    createItemAction.mockResolvedValueOnce({ ok: false, error: 'לא נשמר' });
    mount(null);
    type(/שם הפריט/, 'מקדחה');
    type(/מיקום במחסן/, 'מכולה');
    await submit('הוספת הפריט');

    expect(push).not.toHaveBeenCalled();
    expect(refusal()).toContain('לא נשמר');
  });

  it('leaves the list and refreshes it once the item is stored', async () => {
    mount(null);
    type(/שם הפריט/, 'מקדחה');
    type(/מיקום במחסן/, 'מכולה');
    await submit('הוספת הפריט');

    expect(push).toHaveBeenCalledWith('/logistics/warehouse');
    expect(refresh).toHaveBeenCalled();
  });
});

describe('the drawer over an item that already exists', () => {
  it('fills every box from the row, so a save changes only what was edited', () => {
    mount(ITEM);
    expect((screen.getByLabelText(/שם הפריט/) as HTMLInputElement).value).toBe('סיר תעשייתי');
    expect((screen.getByLabelText(/מיקום במחסן/) as HTMLInputElement).value).toBe('ארגז כחול #1');
    expect((screen.getByLabelText(/כמות/) as HTMLInputElement).value).toBe('2');
  });

  it('says where the number came from, because there is no workbook', () => {
    // R11: every number carries its source or says it was entered by hand.
    mount(ITEM);
    expect(screen.getAllByText('נרשם ידנית').length).toBeGreaterThan(0);
  });

  it('says who last touched it, because a condition is a judgement', () => {
    mount(ITEM);
    expect(screen.getByRole('dialog').textContent).toContain('lead@shliff.camp');
  });

  it('sends the id with the edit', async () => {
    mount(ITEM);
    type(/כמות/, '1');
    await submit('שמירה');

    expect(updateItemAction).toHaveBeenCalledWith('item-1', expect.objectContaining({
      name: 'סיר תעשייתי', quantity: 1,
    }));
  });

  it('never offers to create while it is editing', () => {
    mount(ITEM);
    expect(screen.queryByRole('button', { name: 'הוספת הפריט' })).toBeNull();
  });
});

describe('the drawer on a phone held in the container', () => {
  it('counts with − and +, named in words, and never below zero', () => {
    mount(null);
    const box = screen.getByLabelText(/כמות/) as HTMLInputElement;
    const more = screen.getByRole('button', { name: 'עוד אחד' });
    const less = screen.getByRole('button', { name: 'פחות אחד' });

    expect((less as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(more);
    fireEvent.click(more);
    expect(box.value).toBe('2');
    fireEvent.click(less);
    expect(box.value).toBe('1');
    fireEvent.click(less);
    expect(box.value).toBe('0');
    expect((less as HTMLButtonElement).disabled).toBe(true);
  });

  it('steps from whatever was typed, so + after "4" is 5 and not "41"', () => {
    mount(null);
    type(/כמות/, '4');
    fireEvent.click(screen.getByRole('button', { name: 'עוד אחד' }));
    expect((screen.getByLabelText(/כמות/) as HTMLInputElement).value).toBe('5');
  });

  it('fills the location from a chip, exactly as stored, and a second tap clears it', () => {
    render(
      <ToastProvider>
        <ItemDrawer item={null} closeHref="/logistics/warehouse" locations={['ארגז כחול #1', 'מדף עליון']} />
      </ToastProvider>,
    );
    const chip = screen.getByRole('button', { name: 'ארגז כחול #1' });
    fireEvent.click(chip);
    expect((screen.getByLabelText(/מיקום במחסן/) as HTMLInputElement).value).toBe('ארגז כחול #1');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect((screen.getByLabelText(/מיקום במחסן/) as HTMLInputElement).value).toBe('');
  });

  it('draws no chip row on a warehouse with nothing stored yet', () => {
    mount(null);
    expect(screen.queryByRole('group', { name: 'מיקומים שכבר בשימוש' })).toBeNull();
  });

  it('stays open for the next item when asked, keeping the box and the category', async () => {
    render(
      <ToastProvider>
        <ItemDrawer item={null} closeHref="/logistics/warehouse" locations={['ארגז כחול #1']} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /להישאר כאן/ }));
    type(/שם הפריט/, 'גזייה');
    fireEvent.click(screen.getByRole('button', { name: 'ארגז כחול #1' }));
    fireEvent.change(screen.getByLabelText('קטגוריה'), { target: { value: 'kitchen' } });
    type(/כמות/, '2');
    type(/הערות/, 'בלי מצת');
    await submit('הוספת הפריט');

    expect(createItemAction).toHaveBeenCalledWith(expect.objectContaining({
      name: 'גזייה', locationText: 'ארגז כחול #1', category: 'kitchen', quantity: 2,
    }));
    // The drawer is still here, the list underneath was refreshed, nothing navigated.
    expect(push).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    // What describes the item is cleared; where it went and what it is stays.
    expect((screen.getByLabelText(/שם הפריט/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/כמות/) as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText(/הערות/) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText(/מיקום במחסן/) as HTMLInputElement).value).toBe('ארגז כחול #1');
    expect((screen.getByLabelText('קטגוריה') as HTMLSelectElement).value).toBe('kitchen');
    // The way out is now "done", not "cancel": there is nothing left to cancel.
    expect(screen.getByRole('button', { name: 'סיום' })).toBeTruthy();
  });

  it('closes after the add as before while the box is not ticked', async () => {
    mount(null);
    type(/שם הפריט/, 'גזייה');
    type(/מיקום במחסן/, 'מכולה');
    await submit('הוספת הפריט');
    expect(push).toHaveBeenCalledWith('/logistics/warehouse');
  });

  it('keeps a failed add on screen even in stay-open mode, with the form untouched', async () => {
    createItemAction.mockResolvedValueOnce({ ok: false, error: 'לא נשמר' });
    mount(null);
    fireEvent.click(screen.getByRole('checkbox', { name: /להישאר כאן/ }));
    type(/שם הפריט/, 'גזייה');
    type(/מיקום במחסן/, 'מכולה');
    await submit('הוספת הפריט');
    expect(refusal()).toContain('לא נשמר');
    expect((screen.getByLabelText(/שם הפריט/) as HTMLInputElement).value).toBe('גזייה');
  });

  it('never offers to stay open while editing — there is no next item', () => {
    mount(ITEM);
    expect(screen.queryByRole('checkbox', { name: /להישאר כאן/ })).toBeNull();
  });
});
