/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import { unnamedControls } from '@/test/a11y';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  usePathname: () => '/logistics/plan/workdays',
  useSearchParams: () => new URLSearchParams(),
}));

const { placeTaskAction, setCrewMemberAction } = vi.hoisted(() => ({
  placeTaskAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  setCrewMemberAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => ({ placeTaskAction, setCrewMemberAction }));

import { DayBoard, type BoardTask, type BoardPerson, type PoolTask } from './day-board';

const DAY = { id: 'e', label: 'יום עבודה', heldOn: '2026-03-14', words: 'יום עבודה · יום שבת 14/03/2026' };

const BENCHES: BoardTask = {
  id: 'i', title: 'בניית ספסלים', href: '/logistics/plan?season=s&peek=i',
  crewHref: '/logistics/plan/workdays?season=s&day=e&task=i',
  topicName: 'סלון', parentTitle: null, assigneeName: 'דנה', done: false,
  startsOn: '2026-03-14', endsOn: null,
  crew: [{ personId: 'd', displayName: 'דנה', onRoster: true }],
};
const LOUNGE: BoardTask = {
  id: 'l', title: 'להכין סלון', href: '/logistics/plan?season=s&peek=l',
  crewHref: '/logistics/plan/workdays?season=s&day=e&task=l',
  topicName: 'סלון', parentTitle: null, assigneeName: null, done: false,
  startsOn: '2026-03-10', endsOn: '2026-03-20',
  crew: [],
};
const FREE: BoardPerson[] = [
  { personId: 'n', displayName: 'נועה', href: '/members/n' },
  { personId: 'o', displayName: 'עומר', href: '/members/o' },
];
const FRIDGES: PoolTask = { id: 'f', title: 'לתקן מקררים', topicName: 'מטבח', parentTitle: null, startsOn: null, endsOn: null };
const PAINT: PoolTask = { id: 'p', title: 'לצבוע', topicName: 'סלון', parentTitle: 'להכין סלון', startsOn: '2026-04-04', endsOn: '2026-04-05' };

function mount(over: Partial<Parameters<typeof DayBoard>[0]> = {}) {
  return render(
    <ToastProvider>
      <DayBoard
        day={DAY}
        tasks={[BENCHES, LOUNGE]}
        free={FREE}
        pool={{ unscheduled: [FRIDGES], elsewhere: [PAINT] }}
        rosterSize={3}
        seasonName="ברן 26"
        canEdit
        planHref="/logistics/plan?season=s"
        attendanceHref="/logistics/attendance?season=s&peek=e"
        {...over}
      />
    </ToastProvider>,
  );
}

/** jsdom has no `DataTransfer`; this is the part of one the board reads. */
function transfer(type: string, id: string) {
  const data: Record<string, string> = { [type]: id };
  return {
    types: [type],
    getData: (key: string) => data[key] ?? '',
    setData: (key: string, value: string) => { data[key] = value; },
    effectAllowed: 'all',
    dropEffect: 'none',
  };
}

const dayZone = () => screen.getByRole('region', { name: 'המשימות של היום' });
const card = (title: string) => screen.getByRole('heading', { name: title, level: 3 }).closest('li')!;

beforeEach(() => { vi.clearAllMocks(); });

describe('the day as a board', () => {
  it('draws the day\'s tasks with their crews, the free people, and the pool in two groups', () => {
    mount();
    expect(screen.getByText('יום עבודה · יום שבת 14/03/2026')).toBeTruthy();
    expect(within(card('בניית ספסלים')).getByText('דנה')).toBeTruthy();
    expect(within(card('להכין סלון')).getByText(/עדיין לא שובץ אף אחד/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'נועה' }).getAttribute('href')).toBe('/members/n');

    const pool = screen.getByRole('complementary', { name: 'משימות שאפשר למשוך ליום הזה' });
    expect(within(pool).getByText('2 משימות')).toBeTruthy();
    expect(within(pool).getByText('בלי יום')).toBeTruthy();
    expect(within(pool).getByText('ביום אחר')).toBeTruthy();
    expect(within(pool).getByText('לתקן מקררים')).toBeTruthy();
    expect(within(pool).getByText('04/04/2026–05/04/2026')).toBeTruthy();
    expect(within(pool).getByText('חלק של להכין סלון')).toBeTruthy();
  });

  it('says in a word which open task has nobody on it, and not on one that has', () => {
    mount();
    expect(within(card('להכין סלון')).getByText('בלי צוות')).toBeTruthy();
    expect(within(card('בניית ספסלים')).queryByText('בלי צוות')).toBeNull();
  });

  it('does not call a finished task with nobody on it short of a crew', () => {
    mount({ tasks: [{ ...LOUNGE, done: true }] });
    expect(within(card('להכין סלון')).queryByText('בלי צוות')).toBeNull();
  });

  it('marks a person on two of the day\'s tasks on both chips, in a word', () => {
    const doubled = { personId: 'd', displayName: 'דנה', onRoster: true, doubled: true };
    mount({ tasks: [{ ...BENCHES, crew: [doubled] }, { ...LOUNGE, crew: [doubled] }] });
    expect(within(card('בניית ספסלים')).getByText(/כפול/)).toBeTruthy();
    expect(within(card('להכין סלון')).getByText(/כפול/)).toBeTruthy();
  });

  it('writes no such word on a chip that is on one task only', () => {
    mount();
    expect(screen.queryByText(/כפול/)).toBeNull();
  });

  it('keeps the people on no task a region of their own, outside the pool', () => {
    mount();
    const free = screen.getByRole('region', { name: 'בלי משימה ביום הזה' });
    expect(within(free).getByRole('link', { name: 'עומר' })).toBeTruthy();
    expect(within(free).queryByText('לתקן מקררים')).toBeNull();
  });

  it('names every control (E4)', () => {
    const { container } = mount();
    expect(unnamedControls(container)).toEqual([]);
  });

  it('pulls a task onto the day by its button, says so, and the undo gives back no day', async () => {
    mount();
    const row = screen.getByText('לתקן מקררים').closest('li')!;
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: /ליום הזה/ })); });
    expect(placeTaskAction).toHaveBeenCalledWith('f', { startsOn: '2026-03-14', endsOn: null });
    expect(await screen.findByText('לתקן מקררים שויכה ליום עבודה · יום שבת 14/03/2026')).toBeTruthy();
    expect(refresh).toHaveBeenCalled();

    placeTaskAction.mockClear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /ביטול/ })); });
    expect(placeTaskAction).toHaveBeenCalledWith('f', { startsOn: null, endsOn: null });
  });

  it('moves a task from another day, names the days it had, and the undo restores them', async () => {
    mount();
    const row = screen.getByText('לצבוע').closest('li')!;
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: /ליום הזה/ })); });
    expect(placeTaskAction).toHaveBeenCalledWith('p', { startsOn: '2026-03-14', endsOn: null });
    expect(await screen.findByText(/לצבוע עברה ליום עבודה .* הייתה ב04\/04\/2026–05\/04\/2026/)).toBeTruthy();

    placeTaskAction.mockClear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /ביטול/ })); });
    expect(placeTaskAction).toHaveBeenCalledWith('p', { startsOn: '2026-04-04', endsOn: '2026-04-05' });
  });

  it('pulls a task onto the day by dragging it from the pool onto the day\'s tasks', async () => {
    mount();
    const row = screen.getByText('לתקן מקררים').closest('li')!;
    const dataTransfer = transfer('application/x-shliff-task', '');
    await act(async () => { fireEvent.dragStart(row, { dataTransfer }); });
    expect(dataTransfer.getData('application/x-shliff-task')).toBe('f');
    expect(screen.getByText('משחררים כאן, והמשימה עוברת ליום הזה.')).toBeTruthy();

    let allowed = true;
    await act(async () => { allowed = fireEvent.dragOver(dayZone(), { dataTransfer }); });
    /* `fireEvent` returns false when the handler called `preventDefault` — the drop is accepted. */
    expect(allowed).toBe(false);
    await act(async () => { fireEvent.drop(dayZone(), { dataTransfer }); });
    expect(placeTaskAction).toHaveBeenCalledWith('f', { startsOn: '2026-03-14', endsOn: null });
    expect(screen.queryByText('משחררים כאן, והמשימה עוברת ליום הזה.')).toBeNull();
  });

  it('does not take a drop that is not one of its own', async () => {
    mount();
    const dataTransfer = transfer('text/plain', 'לתקן מקררים');
    let allowed = true;
    await act(async () => { allowed = fireEvent.dragOver(dayZone(), { dataTransfer }); });
    expect(allowed).toBe(true);
    await act(async () => { fireEvent.drop(dayZone(), { dataTransfer }); });
    expect(placeTaskAction).not.toHaveBeenCalled();
  });

  it('takes a task off the day, names what that does to its days, and the undo puts them back', async () => {
    mount();
    await act(async () => {
      fireEvent.click(within(card('להכין סלון')).getByRole('button', { name: /הסרה מהיום/ }));
    });
    expect(placeTaskAction).toHaveBeenCalledWith('l', { startsOn: null, endsOn: null });
    expect(await screen.findByText(/להכין סלון הוסרה מיום עבודה · הימים 10\/03\/2026–20\/03\/2026 נמחקו/)).toBeTruthy();

    placeTaskAction.mockClear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /ביטול/ })); });
    expect(placeTaskAction).toHaveBeenCalledWith('l', { startsOn: '2026-03-10', endsOn: '2026-03-20' });
  });

  it('says a one-day task taken off is now without a day', async () => {
    mount();
    await act(async () => {
      fireEvent.click(within(card('בניית ספסלים')).getByRole('button', { name: /הסרה מהיום/ }));
    });
    expect(await screen.findByText('בניית ספסלים הוסרה מיום עבודה · עכשיו בלי יום')).toBeTruthy();
  });

  it('puts a free person on a task by dragging their chip onto its card', async () => {
    mount();
    const chip = screen.getByRole('link', { name: 'נועה' }).closest('li')!;
    const dataTransfer = transfer('application/x-shliff-person', '');
    await act(async () => { fireEvent.dragStart(chip, { dataTransfer }); });
    expect(dataTransfer.getData('application/x-shliff-person')).toBe('n');

    const target = card('להכין סלון');
    let allowed = true;
    await act(async () => { allowed = fireEvent.dragOver(target, { dataTransfer }); });
    expect(allowed).toBe(false);
    await act(async () => { fireEvent.drop(target, { dataTransfer }); });
    expect(setCrewMemberAction).toHaveBeenCalledWith('l', 'n', true);
    /* The card sits inside the day's zone, which must not read this as a task. */
    expect(placeTaskAction).not.toHaveBeenCalled();
    expect(await screen.findByText('נועה · נוסף שיבוץ ללהכין סלון')).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it('does not let the day\'s zone take a person, nor a card take a task', async () => {
    mount();
    const person = transfer('application/x-shliff-person', 'n');
    await act(async () => { fireEvent.drop(dayZone(), { dataTransfer: person }); });
    const task = transfer('application/x-shliff-task', 'f');
    await act(async () => { fireEvent.drop(card('להכין סלון'), { dataTransfer: task }); });
    expect(setCrewMemberAction).not.toHaveBeenCalled();
    /* A drop on the card bubbles to the zone, which does read a task. */
    expect(placeTaskAction).toHaveBeenCalledTimes(1);
  });

  it('takes a person off a task from the chip, and the undo puts them back', async () => {
    mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'הסרת דנה מבניית ספסלים' }));
    });
    expect(setCrewMemberAction).toHaveBeenCalledWith('i', 'd', false);
    expect(await screen.findByText('דנה · הוסר השיבוץ לבניית ספסלים')).toBeTruthy();

    setCrewMemberAction.mockClear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /ביטול/ })); });
    expect(setCrewMemberAction).toHaveBeenCalledWith('i', 'd', true);
  });

  it('shows a refusal in Hebrew and does not refresh', async () => {
    placeTaskAction.mockResolvedValueOnce({ ok: false, error: 'לא מצאנו את המשימה הזו בלוח' });
    mount();
    const row = screen.getByText('לתקן מקררים').closest('li')!;
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: /ליום הזה/ })); });
    expect(await screen.findByText('לא מצאנו את המשימה הזו בלוח')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('narrows the pool by title, topic or parent, and says when nothing matches', () => {
    mount();
    const search = screen.getByLabelText('חיפוש משימה');
    fireEvent.change(search, { target: { value: 'מקרר' } });
    expect(screen.getByText('לתקן מקררים')).toBeTruthy();
    expect(screen.queryByText('לצבוע')).toBeNull();
    fireEvent.change(search, { target: { value: 'סלון' } });
    expect(screen.getByText('לצבוע')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'אין כזה' } });
    expect(screen.getByText(/אין משימה שהשם, הנושא או המשימה הכללית שלה/)).toBeTruthy();
    /* The count is of the pool, filtered or not. */
    expect(screen.getByText('2 משימות')).toBeTruthy();
  });

  it('with an empty pool, sends a lead to add a task on the board', () => {
    mount({ pool: { unscheduled: [], elsewhere: [] } });
    expect(screen.getByRole('link', { name: 'הוספת משימה בלוח העבודה' }).getAttribute('href')).toBe('/logistics/plan?season=s');
  });

  it('with no tasks on the day, says how one gets here', () => {
    mount({ tasks: [] });
    expect(screen.getByText(/מושכים משימה מהרשימה שלצד/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'מעבר ללוח העבודה' })).toBeTruthy();
  });

  it('for an account that only reads: no pool, no buttons, no drag', () => {
    mount({ canEdit: false, tasks: [{ ...BENCHES, crewHref: null }] });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('button', { name: /הסרה מהיום/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /הסרת דנה/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /שיבוץ/ })).toBeNull();
    const chip = screen.getByRole('link', { name: 'נועה' }).closest('li')!;
    expect(chip.getAttribute('draggable')).not.toBe('true');
  });
});
