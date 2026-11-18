/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { scheduleItemAction } = vi.hoisted(() => ({
  scheduleItemAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => ({ scheduleItemAction }));

import { WorkDayMenu, workDayWhen, type WorkDayOption, type WorkDayTarget } from './work-day-menu';

const BENCHES: WorkDayTarget = { id: 'i', title: 'בניית ספסלים', startsOn: '2026-03-01', endsOn: '2026-03-03' };
const FRIDGES: WorkDayTarget = { id: 'j', title: 'לתקן מקררים', startsOn: '2026-03-14', endsOn: null };
const DAYS: WorkDayOption[] = [
  { id: 'e1', label: 'יום עבודה', heldOn: '2026-03-14' },
  { id: 'e2', label: 'בניית הבר', heldOn: '2026-04-04' },
];

function mount(workDays: WorkDayOption[] = DAYS, addHref: string | null = '/logistics/attendance?act=event') {
  return render(
    <ToastProvider>
      <WorkDayMenu items={[BENCHES, FRIDGES]} workDays={workDays} addHref={addHref}>
        <table>
          <tbody>
            <tr>
              <td><span data-plan-item="i"><a href="/x">בניית ספסלים</a></span></td>
              <td>מתי</td>
            </tr>
            <tr>
              <td><span data-plan-item="j"><a href="/y">לתקן מקררים</a></span></td>
              <td>מתי של מקררים</td>
            </tr>
            <tr>
              <td><span data-plan-item="gone">משימה שבוטלה</span></td>
            </tr>
          </tbody>
        </table>
        <h2>כותרת</h2>
      </WorkDayMenu>
    </ToastProvider>,
  );
}

async function rightClick(text: string) {
  let allowed = true;
  await act(async () => { allowed = fireEvent.contextMenu(screen.getByText(text)); });
  /* `fireEvent` returns false when the handler called `preventDefault`. */
  return { intercepted: !allowed };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('right-click on a task of the plan', () => {
  it('opens a menu of the season\'s work days, named for the task', async () => {
    mount();
    const { intercepted } = await rightClick('בניית ספסלים');
    expect(intercepted).toBe(true);
    const menu = screen.getByRole('dialog', { name: 'שיוך ליום עבודה · בניית ספסלים' });
    expect(menu.textContent).toContain(workDayWhen('2026-03-14'));
    expect(screen.getByRole('button', { name: /בניית הבר/ })).toBeTruthy();
  });

  it('finds the task from anywhere on its table row', async () => {
    mount();
    await rightClick('מתי של מקררים');
    expect(screen.getByRole('dialog', { name: 'שיוך ליום עבודה · לתקן מקררים' })).toBeTruthy();
  });

  it('puts the task on the chosen day as a one-day item, says so, and closes', async () => {
    mount();
    await rightClick('בניית ספסלים');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /בניית הבר/ })); });
    expect(scheduleItemAction).toHaveBeenCalledWith('i', { startsOn: '2026-04-04', endsOn: null });
    expect(await screen.findByText(`בניית ספסלים שויכה לבניית הבר · ${workDayWhen('2026-04-04')}`)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers to undo by writing back the days that were', async () => {
    mount();
    await rightClick('בניית ספסלים');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /בניית הבר/ })); });
    const undo = await screen.findByRole('button', { name: /ביטול/ });
    scheduleItemAction.mockClear();
    await act(async () => { fireEvent.click(undo); });
    expect(scheduleItemAction).toHaveBeenCalledWith('i', { startsOn: '2026-03-01', endsOn: '2026-03-03' });
  });

  it('marks the day the task is already on and does not offer it again', async () => {
    mount();
    await rightClick('לתקן מקררים');
    const current = screen.getByRole('button', { name: /יום עבודה.*14\/03\/2026/ }) as HTMLButtonElement;
    expect(current.disabled).toBe(true);
    expect((screen.getByRole('button', { name: /בניית הבר/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a refusal in Hebrew and keeps the menu open', async () => {
    scheduleItemAction.mockResolvedValueOnce({ ok: false, error: 'לא מצאנו את המשימה הזו' });
    mount();
    await rightClick('בניית ספסלים');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /בניית הבר/ })); });
    expect(await screen.findByText('לא מצאנו את המשימה הזו')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('with no work days yet, says where one is added', async () => {
    mount([]);
    await rightClick('בניית ספסלים');
    expect(screen.getByText(/עדיין אין ימי עבודה בלוח הנוכחות/)).toBeTruthy();
    const add = screen.getByRole('link', { name: /יום עבודה חדש בלוח הנוכחות/ });
    expect(add.getAttribute('href')).toBe('/logistics/attendance?act=event');
  });

  it('does not link to נוכחות for an account that cannot add a day there', async () => {
    mount([], null);
    await rightClick('בניית ספסלים');
    expect(screen.getByText(/מי שמנהל את לוח הנוכחות/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /יום עבודה חדש/ })).toBeNull();
  });

  it('leaves the browser\'s own menu alone off a task, and on one it was not given', async () => {
    mount();
    expect((await rightClick('כותרת')).intercepted).toBe(false);
    expect((await rightClick('משימה שבוטלה')).intercepted).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape', async () => {
    mount();
    await rightClick('בניית ספסלים');
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
