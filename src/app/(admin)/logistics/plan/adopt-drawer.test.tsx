/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { AdoptableItem } from '@/lib/logistics/plan';

const { push, replace, refresh } = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh }) }));

const actions = vi.hoisted(() => ({
  adoptPurchaseItemsAction: vi.fn(async (): Promise<ActionResult<number>> => ({ ok: true, value: 2 })),
}));
vi.mock('./actions', () => actions);

import { AdoptDrawer, type AdoptDrawerProps } from './adopt-drawer';

const CANDIDATES: AdoptableItem[] = [
  { id: 'a', title: 'לקנות מכולה', suggested: true, assignee: { personId: 'p', displayName: 'אופק' }, parentId: null },
  { id: 'b', title: 'קניית קרשים', suggested: true, assignee: null, parentId: 'x' },
  { id: 'c', title: 'להכין סלון', suggested: false, assignee: null, parentId: null },
];

const BASE: AdoptDrawerProps = {
  seasonId: 's1',
  seasonName: 'ברן 26',
  candidates: CANDIDATES,
  closeHref: '/logistics/plan?season=s1',
  listHref: '/logistics/acquisitions?season=s1',
};

function mount(over: Partial<AdoptDrawerProps> = {}) {
  return render(
    <ToastProvider>
      <AdoptDrawer {...BASE} {...over} />
    </ToastProvider>,
  );
}

async function press(name: string | RegExp) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('the drawer that moves buying items to the acquisitions list', () => {
  it('says nothing in English', () => {
    mount();
    expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('ticks the items that open with ״לקנות״ and leaves the rest for the lead', () => {
    mount();
    expect((screen.getByLabelText('לקנות מכולה · אופק') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('קניית קרשים') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('להכין סלון') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole('button', { name: 'העברה לרכש (2)' })).toBeTruthy();
  });

  it('moves exactly what is ticked, and says the items stayed on the board', async () => {
    mount();
    fireEvent.click(screen.getByLabelText('קניית קרשים'));
    fireEvent.click(screen.getByLabelText('להכין סלון'));
    await press('העברה לרכש (2)');
    expect(actions.adoptPurchaseItemsAction).toHaveBeenCalledWith('s1', ['a', 'c']);
    expect(push).toHaveBeenCalledWith('/logistics/plan?season=s1');
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText(/נוספו לרשימת הרכש ונשארו בלוח/)).toBeTruthy();
  });

  it('refuses an empty choice beside the button, without a round trip', async () => {
    mount();
    fireEvent.click(screen.getByLabelText('לקנות מכולה · אופק'));
    fireEvent.click(screen.getByLabelText('קניית קרשים'));
    await press('העברה לרכש');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/לסמן/);
    expect(actions.adoptPurchaseItemsAction).not.toHaveBeenCalled();
  });

  it('shows the action’s refusal in Hebrew and keeps the drawer open', async () => {
    actions.adoptPurchaseItemsAction.mockResolvedValueOnce({ ok: false, error: 'שום דבר לא הועבר' });
    mount();
    await press('העברה לרכש (2)');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('שום דבר לא הועבר');
    expect(push).not.toHaveBeenCalled();
  });

  it('says under each item how it will go in, and when it joins a row already in the list', () => {
    mount({
      candidates: [
        { ...CANDIDATES[0], outcome: { source: 'buy_new', name: 'מכולה', existing: { id: 'r', name: 'מכולה' }, boardTitle: 'לקנות מכולה', refusal: null } },
        { ...CANDIDATES[1], outcome: { source: 'buy_new', name: 'קרשים', existing: null, boardTitle: 'לקנות קרשים', refusal: null } },
        { ...CANDIDATES[2], outcome: { source: 'buy_new', name: 'להכין סלון', existing: null, boardTitle: 'לקנות להכין סלון', refusal: null } },
      ],
    });
    const dialog = screen.getByRole('dialog').textContent ?? '';
    expect(dialog).toContain('״מכולה״ כבר ברשימת הרכש — המשימה תקושר לפריט הקיים, ולא ייווצר פריט נוסף.');
    expect(dialog).toContain('תיכנס כ״קרשים״ · לקנות חדש · בלוח תיקרא ״לקנות קרשים״');
    expect(dialog).toContain('בלוח תיקרא ״לקנות להכין סלון״');
    expect(dialog).not.toMatch(/[A-Za-z]/);
  });

  it('never ticks an item the move would refuse, and does not let it be ticked', async () => {
    mount({
      candidates: [
        { ...CANDIDATES[0], outcome: { source: 'buy_new', name: 'מכולה', existing: null, boardTitle: 'לקנות מכולה', refusal: 'ambiguous' } },
        { ...CANDIDATES[1], outcome: { source: 'borrow_member', name: 'קרשים', existing: null, boardTitle: 'להשאיל קרשים', refusal: 'needs_lender' } },
        CANDIDATES[2],
      ],
    });
    const container = screen.getByLabelText('לקנות מכולה · אופק') as HTMLInputElement;
    const boards = screen.getByLabelText('קניית קרשים') as HTMLInputElement;
    expect([container.checked, container.disabled]).toEqual([false, true]);
    expect([boards.checked, boards.disabled]).toEqual([false, true]);
    expect(screen.getByRole('dialog').textContent).toContain('יותר מפריט אחד בשם ״מכולה״');
    expect(screen.getByRole('dialog').textContent).toContain('השאלה צריכה שם של המשאיל/ה');
    await press('העברה לרכש');
    expect(actions.adoptPurchaseItemsAction).not.toHaveBeenCalled();
  });

  it('says so when there is nothing to move, and disables the verb', () => {
    mount({ candidates: [] });
    expect(screen.getByText(/אין בלוח משימות פתוחות/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'העברה לרכש' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
