/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { PlanItem, Topic } from '@/lib/logistics/plan';

const { push, replace, refresh } = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh }) }));

const actions = vi.hoisted(() => ({
  createItemAction: vi.fn(async (): Promise<ActionResult<string>> => ({ ok: true, value: 'new' })),
  updateItemAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  setItemStatusAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  addDependencyAction: vi.fn(async (): Promise<ActionResult<string>> => ({ ok: true, value: 'dep' })),
  removeDependencyAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => actions);

import { ItemDrawer, type ItemDrawerProps } from './item-drawer';

const KITCHEN: Topic = {
  id: 'k', seasonId: 's1', name: 'מטבח', position: 0, notes: null, archivedAt: null,
  updatedAt: new Date('2026-05-01T09:00:00Z'), updatedBy: null,
};

function item(over: Partial<PlanItem>): PlanItem {
  return {
    id: 'i', seasonId: 's1', topicId: null, parentId: null, title: 'משימה', notes: null,
    startsOn: null, endsOn: null, status: 'open', position: 0, assignee: null,
    waitsFor: [], blocks: [], updatedAt: new Date('2026-05-01T09:00:00Z'), updatedBy: 'lead@shliff.camp',
    ...over,
  };
}

const BASE: ItemDrawerProps = {
  item: null,
  seasonId: 's1',
  closeHref: '/logistics/plan?season=s1',
  params: { season: 's1' },
  topics: [KITCHEN],
  parents: [{ id: 'p', title: 'להכין מכולת מטבח', topicId: 'k' }],
  others: [{ id: 'p', title: 'להכין מכולת מטבח' }, { id: 'q', title: 'לקנות קרשים' }],
  roster: [{ personId: 'ofek', displayName: 'אופק' }],
};

function mount(over: Partial<ItemDrawerProps> = {}) {
  return render(
    <ToastProvider>
      <ItemDrawer {...BASE} {...over} />
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

describe('the drawer that adds an item', () => {
  it('says nothing in English', () => {
    mount();
    expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('refuses a blank title beside the field, without a round trip', async () => {
    mount();
    await press('הוספה ללוח');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/שם/);
    expect(actions.createItemAction).not.toHaveBeenCalled();
  });

  it('refuses an end before the start, and an end with no start, before the round trip', async () => {
    mount();
    type(/מה צריך לעשות/, 'לתקן מקררים');
    type(/מסיימים ביום/, '2026-05-12');
    await press('הוספה ללוח');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/יום התחלה/);
    type(/מתחילים ביום/, '2026-05-14');
    await press('הוספה ללוח');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/לפני יום ההתחלה/);
    expect(actions.createItemAction).not.toHaveBeenCalled();
  });

  it('sends a general item under its topic with its days and its person, then closes', async () => {
    mount();
    type(/מה צריך לעשות/, 'להכין מכולת אומנות');
    type(/^נושא/, 'k');
    type(/מתחילים ביום/, '2026-05-10');
    type(/מסיימים ביום/, '2026-05-12');
    type(/אחראי/, 'ofek');
    await press('הוספה ללוח');
    expect(actions.createItemAction).toHaveBeenCalledWith('s1', {
      title: 'להכין מכולת אומנות', notes: null, topicId: 'k', parentId: null,
      startsOn: '2026-05-10', endsOn: '2026-05-12', assigneePersonId: 'ofek',
    });
    expect(push).toHaveBeenCalledWith('/logistics/plan?season=s1');
  });

  it('pre-fills a part from the parent in the URL, and fixes the topic to the parent’s', async () => {
    mount({ presetParentId: 'p' });
    expect(screen.getByRole('heading', { name: 'תת־משימה של להכין מכולת מטבח' })).toBeTruthy();
    const topicSelect = screen.getByLabelText(/^נושא/) as HTMLSelectElement;
    expect(topicSelect.disabled).toBe(true);
    expect(topicSelect.value).toBe('k');
    type(/מה צריך לעשות/, 'לתקן מקררים');
    await press('הוספה ללוח');
    expect(actions.createItemAction).toHaveBeenCalledWith('s1', expect.objectContaining({ parentId: 'p', topicId: 'k' }));
  });

  it('shows the action’s Hebrew refusal and stays open', async () => {
    actions.createItemAction.mockResolvedValueOnce({ ok: false, error: 'לא מצאנו את הנושא הזה' });
    mount();
    type(/מה צריך לעשות/, 'א');
    await press('הוספה ללוח');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('לא מצאנו את הנושא הזה');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('the drawer over an item', () => {
  const BUILD = item({
    id: 'b', title: 'יום בניית ספסלים', startsOn: '2026-05-09',
    waitsFor: [{
      dependencyId: 'd1', itemId: 'q', title: 'לקנות קרשים', status: 'open',
      startsOn: '2026-05-09', endsOn: null, conflict: true,
    }],
    blocks: [{
      dependencyId: 'd2', itemId: 'z', title: 'יום צביעת ספסלים', status: 'open',
      startsOn: '2026-05-10', endsOn: null, conflict: false,
    }],
  });

  it('lists what it waits for, says where the dates contradict it, and lets one be withdrawn', async () => {
    mount({ item: BUILD });
    const section = screen.getByRole('region', { name: 'סדר' });
    expect(within(section).getByRole('link', { name: 'לקנות קרשים' })).toBeTruthy();
    expect(within(section).getByText('לא מסתיימת קודם')).toBeTruthy();
    expect(within(section).getByRole('link', { name: 'יום צביעת ספסלים' })).toBeTruthy();
    await press('הסרת הקשר ללקנות קרשים');
    expect(actions.removeDependencyAction).toHaveBeenCalledWith('d1');
  });

  it('adds a dependency only once something is chosen, with this item as the one that waits', async () => {
    mount({ item: BUILD, others: [{ id: 'p', title: 'להכין מכולת מטבח' }, { id: 'q', title: 'לקנות קרשים' }] });
    await press('הוספה');
    expect(actions.addDependencyAction).not.toHaveBeenCalled();
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/להסתיים קודם/);
    // `q` is already waited for, so only `p` is offered.
    const select = screen.getByLabelText(/הוספת משימה שחייבת להסתיים קודם/) as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(['', 'p']);
    type(/הוספת משימה שחייבת להסתיים קודם/, 'p');
    await press('הוספה');
    expect(actions.addDependencyAction).toHaveBeenCalledWith('p', 'b');
    expect(refresh).toHaveBeenCalled();
  });

  it('marks done from the footer and offers to reopen', async () => {
    mount({ item: BUILD });
    await press('סימון כהושלמה');
    expect(actions.setItemStatusAction).toHaveBeenCalledWith('b', 'done');
  });

  it('cancels only after a confirmation that names the consequence', async () => {
    mount({ item: BUILD });
    await press('ביטול המשימה');
    expect(actions.setItemStatusAction).not.toHaveBeenCalled();
    const confirm = screen.getByRole('alertdialog');
    expect(confirm.textContent).toMatch(/יורדת מציר הזמן/);
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'ביטול המשימה' })); });
    expect(actions.setItemStatusAction).toHaveBeenCalledWith('b', 'cancelled');
  });

  it('offers a sub-item to a general item and not to a part', () => {
    mount({ item: BUILD });
    expect(screen.getByRole('link', { name: 'תת־משימה' }).getAttribute('href'))
      .toBe('/logistics/plan?season=s1&act=item&parent=b');
    mount({ item: item({ id: 'c', parentId: 'b' }) });
    expect(screen.getAllByRole('link', { name: 'תת־משימה' })).toHaveLength(1);
  });

  it('saves an edit in place', async () => {
    mount({ item: BUILD });
    type(/מסיימים ביום/, '2026-05-10');
    await press('שמירה');
    expect(actions.updateItemAction).toHaveBeenCalledWith('b', expect.objectContaining({
      title: 'יום בניית ספסלים', startsOn: '2026-05-09', endsOn: '2026-05-10',
    }));
  });
});
