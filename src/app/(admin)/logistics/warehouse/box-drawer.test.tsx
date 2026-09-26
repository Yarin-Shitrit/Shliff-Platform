/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { BoxRow } from '@/lib/logistics/boxes';

const { push, replace, refresh } = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh }) }));

/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
const { createBoxAction, updateBoxAction } = vi.hoisted(() => ({
  createBoxAction: vi.fn(async (): Promise<ActionResult<string>> => ({ ok: true, value: 'new-box' })),
  updateBoxAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => ({ createBoxAction, updateBoxAction }));

import { BoxDrawer, type BoxItem } from './box-drawer';

const BOX: BoxRow = {
  id: 'b1', name: 'ארגז כחול #1', locationText: 'מדף עליון', notes: null,
  updatedBy: 'lead@shliff.camp', updatedAt: new Date('2026-09-14T10:00:00Z'),
  itemCount: 2, quantity: 4,
};

const ITEMS: BoxItem[] = [
  { id: 'i1', name: 'מצקת', quantity: 3, condition: 'ready' },
  { id: 'i2', name: 'מסור', quantity: 1, condition: 'retired' },
];

function mount(box: BoxRow | null, items: BoxItem[] = []) {
  return render(
    <ToastProvider>
      <BoxDrawer box={box} items={items} closeHref="/logistics/warehouse?cat=kitchen" params={{ cat: 'kitchen' }} />
    </ToastProvider>,
  );
}

function type(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function submit(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
}

function refusal(): string {
  return within(screen.getByRole('dialog')).getByRole('alert').textContent ?? '';
}

beforeEach(() => { vi.clearAllMocks(); });

describe('the drawer that adds a box', () => {
  it('says nothing in English, because it is read on a Hebrew screen', () => {
    mount(null);
    expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('opens empty rather than pre-filling a guess', () => {
    mount(null);
    expect((screen.getByLabelText(/שם הארגז/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/מיקום הארגז/) as HTMLInputElement).value).toBe('');
  });

  it('refuses a blank name here, before the round trip', async () => {
    mount(null);
    type(/מיקום הארגז/, 'מדף');
    await submit('הוספת הארגז');
    expect(createBoxAction).not.toHaveBeenCalled();
    expect(refusal()).toMatch(/שם/);
  });

  it('refuses a blank place, and says what a place is for', async () => {
    mount(null);
    type(/שם הארגז/, 'ארגז כחול');
    await submit('הוספת הארגז');
    expect(createBoxAction).not.toHaveBeenCalled();
    expect(refusal()).toMatch(/מונח/);
  });

  it('sends what was typed and opens the drawer over the new box, filters kept', async () => {
    mount(null);
    type(/שם הארגז/, 'ארגז כחול');
    type(/מיקום הארגז/, 'מדף עליון');
    type(/הערות/, 'המכסה שבור');
    await submit('הוספת הארגז');

    expect(createBoxAction).toHaveBeenCalledWith({ name: 'ארגז כחול', locationText: 'מדף עליון', notes: 'המכסה שבור' });
    // Into the box, not back to the list: the next thing is to fill it.
    expect(push).toHaveBeenCalledWith('/logistics/warehouse?cat=kitchen&box=new-box');
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the refusal the action returned rather than closing on a failure', async () => {
    createBoxAction.mockResolvedValueOnce({ ok: false, error: 'לא נשמר' });
    mount(null);
    type(/שם הארגז/, 'ארגז');
    type(/מיקום הארגז/, 'מדף');
    await submit('הוספת הארגז');
    expect(push).not.toHaveBeenCalled();
    expect(refusal()).toContain('לא נשמר');
  });

  it('lists nothing while creating: there is no box yet to hold anything', () => {
    mount(null);
    expect(screen.queryByRole('link', { name: /הוספת פריט לארגז/ })).toBeNull();
  });
});

describe('the drawer over a box that exists', () => {
  it('fills every box from the row, and says who last touched it', () => {
    mount(BOX, ITEMS);
    expect((screen.getByLabelText(/שם הארגז/) as HTMLInputElement).value).toBe('ארגז כחול #1');
    expect((screen.getByLabelText(/מיקום הארגז/) as HTMLInputElement).value).toBe('מדף עליון');
    expect(screen.getByRole('dialog').textContent).toContain('lead@shliff.camp');
  });

  it('lists what is in it, each a link to the item, with its count and its state in words', () => {
    mount(BOX, ITEMS);
    const first = screen.getByRole('link', { name: 'מצקת' });
    expect(first.getAttribute('href')).toContain('peek=i1');
    expect(first.getAttribute('href')).toContain('cat=kitchen');
    expect(screen.getByRole('link', { name: 'מסור' })).toBeTruthy();
    // R3: the state is a word, and retired is not hidden — it takes up space.
    expect(screen.getByText('יצא משימוש')).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toContain('2 פריטים');
  });

  it('offers to add an item with this box already chosen', () => {
    mount(BOX, ITEMS);
    const add = screen.getByRole('link', { name: /הוספת פריט לארגז/ });
    expect(add.getAttribute('href')).toContain('act=item');
    expect(add.getAttribute('href')).toContain('box=b1');
  });

  it('says an empty box is empty, as an invitation and not an apology', () => {
    mount({ ...BOX, itemCount: 0, quantity: 0 }, []);
    expect(screen.getByRole('dialog').textContent).toContain('הארגז ריק');
    expect(screen.getByRole('link', { name: /הוספת פריט לארגז/ })).toBeTruthy();
  });

  it('sends the id with the edit and closes to the list it came from', async () => {
    mount(BOX, ITEMS);
    type(/מיקום הארגז/, 'מכולה');
    await submit('שמירה');
    expect(updateBoxAction).toHaveBeenCalledWith('b1', expect.objectContaining({ name: 'ארגז כחול #1', locationText: 'מכולה' }));
    expect(push).toHaveBeenCalledWith('/logistics/warehouse?cat=kitchen');
  });

  it('never offers to create while it is editing', () => {
    mount(BOX, ITEMS);
    expect(screen.queryByRole('button', { name: 'הוספת הארגז' })).toBeNull();
  });

  it('says nothing in English with contents listed', () => {
    // The editor's address is the one Latin string a drawer may carry, as on
    // the item drawer; with it out of the way the rest must be Hebrew.
    mount({ ...BOX, updatedBy: null }, ITEMS);
    expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/[A-Za-z]/);
  });
});
