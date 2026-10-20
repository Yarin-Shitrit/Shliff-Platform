/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { RosterOption, ScheduleSlot, ShiftType } from '@/lib/logistics/shifts';
import { campInstant, eventWindow } from '@/lib/logistics/shift-time';

const { push, replace, refresh } = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh }) }));

const actions = vi.hoisted(() => ({
  scheduleShiftsAction: vi.fn(async (): Promise<ActionResult<string[]>> => ({ ok: true, value: ['t-new'] })),
  updateShiftSlotAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  cancelShiftSlotAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  assignToShiftAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  unassignFromShiftAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => actions);

import { SlotDrawer } from './slot-drawer';

const WINDOW = eventWindow(new Date('2026-06-08T00:00:00Z'));

const BAR: ShiftType = {
  id: 'bar', name: 'בר', startsClock: '20:00', endsClock: '00:00', peopleNeeded: 2,
  notes: null, retiredAt: null, updatedAt: new Date(), updatedBy: null,
};

const SLOT: ScheduleSlot = {
  taskId: 't1', typeId: 'bar', title: 'בר',
  startsAt: campInstant('2026-06-09', { hours: 20, minutes: 0 }),
  endsAt: campInstant('2026-06-10', { hours: 0, minutes: 0 }),
  peopleNeeded: 2, accepted: 1, uncovered: true, status: 'open',
  assignees: [{ assignmentId: 'a1', personId: 'p1', displayName: 'אופק', status: 'accepted' }],
};

const ROSTER: RosterOption[] = [
  { personId: 'p2', displayName: 'נועה', shifts: 0, minutes: 0 },
  { personId: 'p1', displayName: 'אופק', shifts: 1, minutes: 240 },
  { personId: 'p3', displayName: 'יוסף', shifts: 2, minutes: 480 },
];

function mount(slot: ScheduleSlot | null, preset: { presetTypeId?: string; presetDay?: string } = {}) {
  return render(
    <ToastProvider>
      <SlotDrawer
        slot={slot}
        seasonId="s1"
        closeHref="/logistics/shifts?season=s1"
        params={{ season: 's1' }}
        types={[BAR]}
        days={WINDOW.days}
        roster={ROSTER}
        {...preset}
      />
    </ToastProvider>,
  );
}

async function press(name: string | RegExp) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
}

function alertText(): string {
  return within(screen.getByRole('dialog')).getByRole('alert').textContent ?? '';
}

beforeEach(() => { vi.clearAllMocks(); });

describe('scheduling a kind of shift', () => {
  it('says nothing in English', () => {
    mount(null);
    expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('refuses without a type, then without a day, before any round trip', async () => {
    mount(null);
    await press('הוספה ללוח');
    expect(alertText()).toMatch(/סוג משמרת/);
    fireEvent.change(screen.getByLabelText(/סוג משמרת/), { target: { value: 'bar' } });
    await press('הוספה ללוח');
    expect(alertText()).toMatch(/יום/);
    expect(actions.scheduleShiftsAction).not.toHaveBeenCalled();
  });

  it('fills the window and the count from the type, and sends one slot per ticked day', async () => {
    mount(null);
    fireEvent.change(screen.getByLabelText(/סוג משמרת/), { target: { value: 'bar' } });
    expect(screen.getByLabelText(/^התחלה/)).toHaveProperty('value', '20:00');
    expect(screen.getByLabelText(/כמה אנשים/)).toHaveProperty('value', '2');
    fireEvent.click(screen.getByLabelText(/יום שני/));
    fireEvent.click(screen.getByLabelText(/יום שלישי/));
    actions.scheduleShiftsAction.mockResolvedValueOnce({ ok: true, value: ['t-a', 't-b'] });
    await press('הוספה ללוח');
    expect(actions.scheduleShiftsAction).toHaveBeenCalledWith({
      seasonId: 's1', shiftTypeId: 'bar', days: ['2026-06-08', '2026-06-09'],
      startsClock: '20:00', endsClock: '00:00', peopleNeeded: 2,
    });
    // Several made: back to the board.
    expect(push).toHaveBeenCalledWith('/logistics/shifts?season=s1');
  });

  it('opens the one shift it made, so the lead can put people on it', async () => {
    mount(null, { presetTypeId: 'bar', presetDay: '2026-06-10' });
    expect(screen.getByLabelText(/יום רביעי/)).toHaveProperty('checked', true);
    await press('הוספה ללוח');
    expect(push).toHaveBeenCalledWith('/logistics/shifts?season=s1&peek=t-new');
  });

  it('shows the server\'s refusal in place', async () => {
    actions.scheduleShiftsAction.mockResolvedValueOnce({ ok: false, error: 'המשמרת חורגת מזמן האירוע' });
    mount(null, { presetTypeId: 'bar', presetDay: '2026-06-08' });
    await press('הוספה ללוח');
    expect(alertText()).toBe('המשמרת חורגת מזמן האירוע');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('one scheduled shift', () => {
  it('names its day, its window and its cover', () => {
    mount(SLOT);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('יום שלישי');
    expect(dialog.textContent).toContain('20:00–00:00');
    expect(dialog.textContent).toContain('1 מתוך 2 מאוישים');
    expect(dialog.textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('saves a changed window by id, on its own season', async () => {
    mount(SLOT);
    fireEvent.change(screen.getByLabelText(/^סיום/), { target: { value: '23:00' } });
    await press('שמירת השעות והכמות');
    expect(actions.updateShiftSlotAction).toHaveBeenCalledWith('s1', 't1', {
      startsClock: '20:00', endsClock: '23:00', peopleNeeded: 2,
    });
  });

  it('lists who is on it, and offers the rest of the roster lightest first', () => {
    mount(SLOT);
    const onShift = screen.getByRole('list');
    expect(within(onShift).getByText('אופק')).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox').map((box) => (box as HTMLInputElement).labels?.[0]?.textContent);
    expect(boxes).toEqual(['נועה', 'יוסף']);
    expect(screen.getByText('בלי משמרת')).toBeTruthy();
    expect(screen.getByText('2 משמרות · 8 שעות')).toBeTruthy();
  });

  it('places the ticked people in one action', async () => {
    mount(SLOT);
    fireEvent.click(screen.getByLabelText('נועה'));
    fireEvent.click(screen.getByLabelText('יוסף'));
    await press('שיבוץ 2 למשמרת');
    expect(actions.assignToShiftAction).toHaveBeenCalledWith('t1', ['p2', 'p3']);
    expect(refresh).toHaveBeenCalled();
  });

  it('narrows the roster by search', () => {
    mount(SLOT);
    fireEvent.change(screen.getByLabelText(/חיפוש/), { target: { value: 'יוס' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByLabelText('יוסף')).toBeTruthy();
  });

  it('takes a person off by their assignment', async () => {
    mount(SLOT);
    await press('הסרת אופק מהמשמרת');
    expect(actions.unassignFromShiftAction).toHaveBeenCalledWith('a1');
  });

  it('cancels only after a confirmation, and says the row is kept', async () => {
    mount(SLOT);
    await press('ביטול המשמרת');
    expect(actions.cancelShiftSlotAction).not.toHaveBeenCalled();
    const confirm = screen.getByRole('alertdialog');
    expect(confirm.textContent).toContain('נשארים רשומים');
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'ביטול המשמרת' })); });
    expect(actions.cancelShiftSlotAction).toHaveBeenCalledWith('t1');
    expect(push).toHaveBeenCalledWith('/logistics/shifts?season=s1');
  });
});
