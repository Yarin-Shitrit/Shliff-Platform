/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { AttendanceEvent } from '@/lib/logistics/attendance';

const { push, replace, refresh } = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh }) }));

const {
  createEventAction, updateEventAction, setEventCancelledAction, setMarkAction,
} = vi.hoisted(() => ({
  createEventAction: vi.fn(async (): Promise<ActionResult<string>> => ({ ok: true, value: 'new' })),
  updateEventAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  setEventCancelledAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  setMarkAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => ({ createEventAction, updateEventAction, setEventCancelledAction, setMarkAction }));

import { EventDrawer } from './event-drawer';

const WORK_DAY: AttendanceEvent = {
  id: 'e1', seasonId: 's1', kind: 'work_day', heldOn: '2027-03-14', title: null, notes: null,
  cancelledAt: null, createdAt: new Date('2027-03-01T09:00:00Z'), updatedAt: new Date('2027-03-01T09:00:00Z'),
  updatedBy: 'lead@shliff.camp', presentCount: 1,
};

const ROSTER = [
  { personId: 'p-avi', displayName: 'אבי' },
  { personId: 'p-dana', displayName: 'דנה' },
];

const PARAMS = { season: 's1' };
const CLOSE = '/logistics/attendance?season=s1';

function mount(event: AttendanceEvent | null, present: string[] = []) {
  return render(
    <ToastProvider>
      <EventDrawer
        event={event}
        seasonId="s1"
        seasonName="ברן 27"
        closeHref={CLOSE}
        params={PARAMS}
        roster={ROSTER}
        present={present}
        presetDay="2027-03-20"
      />
    </ToastProvider>,
  );
}

async function press(name: string | RegExp) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('the drawer that adds a day', () => {
  it('says nothing in English', () => {
    mount(null);
    expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('starts on the day it was given and refuses a missing kind beside the field, without a round trip', async () => {
    mount(null);
    expect((screen.getByLabelText(/באיזה יום/) as HTMLInputElement).value).toBe('2027-03-20');
    await press('הוספת היום');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/מה היה/);
    expect(createEventAction).not.toHaveBeenCalled();
  });

  it('refuses a blank day', async () => {
    mount(null);
    fireEvent.change(screen.getByLabelText(/באיזה יום/), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/מה היה/), { target: { value: 'work_day' } });
    await press('הוספת היום');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/יום/);
    expect(createEventAction).not.toHaveBeenCalled();
  });

  it('sends the day for the season and opens the drawer over the new day', async () => {
    mount(null);
    fireEvent.change(screen.getByLabelText(/מה היה/), { target: { value: 'shopping' } });
    fireEvent.change(screen.getByLabelText(/כותרת/), { target: { value: 'קניות באיקאה' } });
    await press('הוספת היום');
    expect(createEventAction).toHaveBeenCalledWith('s1', {
      kind: 'shopping', heldOn: '2027-03-20', title: 'קניות באיקאה', notes: null,
    });
    expect(push).toHaveBeenCalledWith('/logistics/attendance?season=s1&event=new');
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the action’s Hebrew refusal and stays open', async () => {
    createEventAction.mockResolvedValueOnce({ ok: false, error: 'לא מצאנו את השנה הזו' });
    mount(null);
    fireEvent.change(screen.getByLabelText(/מה היה/), { target: { value: 'work_day' } });
    await press('הוספת היום');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('לא מצאנו את השנה הזו');
    expect(push).not.toHaveBeenCalled();
  });

  it('offers no checklist and no cancel while there is nothing yet', () => {
    mount(null);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'ביטול היום' })).toBeNull();
  });
});

describe('the drawer over a day', () => {
  it('is titled by the kind when the day has no title, and dated', () => {
    mount(WORK_DAY);
    expect(screen.getByRole('heading', { name: 'יום עבודה' })).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toMatch(/יום ראשון/);
    expect(screen.getByRole('dialog').textContent).toMatch(/14\/03\/2027/);
  });

  it('saves an edit in place', async () => {
    mount(WORK_DAY);
    fireEvent.change(screen.getByLabelText(/כותרת/), { target: { value: 'בניית הבר' } });
    fireEvent.change(screen.getByLabelText(/מה היה/), { target: { value: 'build_day' } });
    await press('שמירה');
    expect(updateEventAction).toHaveBeenCalledWith('e1', {
      kind: 'build_day', heldOn: '2027-03-14', title: 'בניית הבר', notes: null,
    });
    expect(push).toHaveBeenCalledWith(CLOSE);
  });

  it('lists the roster as a checklist with who was there ticked, and counts them', () => {
    mount(WORK_DAY, ['p-dana']);
    expect(screen.getByRole('heading', { name: 'נוכחים · 1 מתוך 2' })).toBeTruthy();
    expect((screen.getByLabelText('דנה') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('אבי') as HTMLInputElement).checked).toBe(false);
  });

  it('writes a tick at once, says so, and moves the count', async () => {
    mount(WORK_DAY, ['p-dana']);
    await act(async () => { fireEvent.click(screen.getByLabelText('אבי')); });
    expect(setMarkAction).toHaveBeenCalledWith('e1', 'p-avi', true);
    expect(screen.getByRole('heading', { name: 'נוכחים · 2 מתוך 2' })).toBeTruthy();
    expect(await screen.findByText(/אבי סומן\/ה כנוכח\/ה/)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('puts a refused tick back and shows the refusal', async () => {
    setMarkAction.mockResolvedValueOnce({ ok: false, error: 'היום הזה בוטל' });
    mount(WORK_DAY, []);
    await act(async () => { fireEvent.click(screen.getByLabelText('אבי')); });
    expect((screen.getByLabelText('אבי') as HTMLInputElement).checked).toBe(false);
    expect(await screen.findByText('היום הזה בוטל')).toBeTruthy();
  });

  it('cancels only after the consequence is read, and keeps the words about the marks', async () => {
    mount(WORK_DAY, ['p-dana']);
    await press('ביטול היום');
    expect(setEventCancelledAction).not.toHaveBeenCalled();
    const confirm = screen.getByRole('alertdialog', { name: 'ביטול יום בלוח הנוכחות' });
    expect(confirm.textContent).toMatch(/הסימונים עצמם נשמרים/);
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'ביטול היום' })); });
    expect(setEventCancelledAction).toHaveBeenCalledWith('e1', true);
    expect(push).toHaveBeenCalledWith(CLOSE);
  });

  it('offers a cancelled day back, and disables its checklist with a word why', async () => {
    mount({ ...WORK_DAY, cancelledAt: new Date('2027-04-01T00:00:00Z') }, ['p-dana']);
    expect(screen.getByText('בוטל')).toBeTruthy();
    expect((screen.getByLabelText('דנה') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/היום הזה בוטל/)).toBeTruthy();
    await press('החזרה ללוח');
    expect(setEventCancelledAction).toHaveBeenCalledWith('e1', false);
  });

  it('says nothing in English beyond the lead’s own address', () => {
    mount(WORK_DAY, ['p-dana']);
    // `updatedBy` is data — the address of whoever saved last — not copy.
    const text = (screen.getByRole('dialog').textContent ?? '').replace(WORK_DAY.updatedBy ?? '', '');
    expect(text).not.toMatch(/[A-Za-z]/);
  });
});
