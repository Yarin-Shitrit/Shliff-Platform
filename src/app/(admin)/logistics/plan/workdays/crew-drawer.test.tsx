/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';

const { refresh, push } = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push }),
  usePathname: () => '/logistics/plan/workdays',
  useSearchParams: () => new URLSearchParams(),
}));

const { setCrewMemberAction } = vi.hoisted(() => ({
  setCrewMemberAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => ({ setCrewMemberAction }));

import { CrewDrawer, type CrewOption } from './crew-drawer';

const PEOPLE: CrewOption[] = [
  { personId: 'd', displayName: 'דנה', onRoster: true, alsoOn: [] },
  { personId: 'n', displayName: 'נועה', onRoster: true, alsoOn: ['לצבוע'] },
  { personId: 'o', displayName: 'עומר', onRoster: true, alsoOn: [] },
  { personId: 'x', displayName: 'יובל', onRoster: false, alsoOn: [] },
];

function mount(onTask: string[] = ['d', 'x'], people: CrewOption[] = PEOPLE) {
  return render(
    <ToastProvider>
      <CrewDrawer
        task={{ id: 'i', title: 'בניית ספסלים' }}
        dayLabel="יום עבודה · יום שבת 14/03/2026"
        closeHref="/logistics/plan/workdays?season=s&day=e"
        people={people}
        onTask={onTask}
      />
    </ToastProvider>,
  );
}

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

beforeEach(() => { vi.clearAllMocks(); });

describe('the drawer that sets who is on a task', () => {
  it('names the task and the day, and draws who is on it', () => {
    mount();
    expect(screen.getByText('בניית ספסלים')).toBeTruthy();
    expect(screen.getByText('יום עבודה · יום שבת 14/03/2026')).toBeTruthy();
    expect(screen.getByText('משובצים · 2')).toBeTruthy();
    expect(box('דנה').checked).toBe(true);
    expect(box('עומר').checked).toBe(false);
  });

  it('writes a tick at once, says it, and counts it', async () => {
    mount();
    await act(async () => { fireEvent.click(box('עומר')); });
    expect(setCrewMemberAction).toHaveBeenCalledWith('i', 'o', true);
    expect(await screen.findByText('עומר · נוסף שיבוץ לבניית ספסלים')).toBeTruthy();
    expect(screen.getByText('משובצים · 3')).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it('takes a person off the same way, and the undo puts them back', async () => {
    mount();
    await act(async () => { fireEvent.click(box('דנה')); });
    expect(setCrewMemberAction).toHaveBeenCalledWith('i', 'd', false);
    expect(await screen.findByText('דנה · הוסר השיבוץ לבניית ספסלים')).toBeTruthy();
    expect(box('דנה').checked).toBe(false);

    setCrewMemberAction.mockClear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /ביטול/ })); });
    expect(setCrewMemberAction).toHaveBeenCalledWith('i', 'd', true);
    expect(box('דנה').checked).toBe(true);
  });

  it('unticks again and shows the refusal in Hebrew when the write is refused', async () => {
    setCrewMemberAction.mockResolvedValueOnce({ ok: false, error: 'המשימה הזו בוטלה' });
    mount();
    await act(async () => { fireEvent.click(box('עומר')); });
    expect(await screen.findByText('המשימה הזו בוטלה')).toBeTruthy();
    expect(box('עומר').checked).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('names the other task of the day beside someone already on one', () => {
    mount();
    expect(screen.getByText('גם ב: לצבוע')).toBeTruthy();
  });

  it('lets someone who left the roster be taken off, and not put back', async () => {
    mount();
    expect(screen.getByText('לא ברשימת השנה')).toBeTruthy();
    expect(box('יובל').disabled).toBe(false);
    await act(async () => { fireEvent.click(box('יובל')); });
    expect(setCrewMemberAction).toHaveBeenCalledWith('i', 'x', false);
    expect(box('יובל').disabled).toBe(true);
  });

  it('narrows the list by name without changing the count', () => {
    mount();
    fireEvent.change(screen.getByLabelText('חיפוש לפי שם'), { target: { value: 'נוע' } });
    expect(screen.queryByRole('checkbox', { name: 'דנה' })).toBeNull();
    expect(box('נועה')).toBeTruthy();
    expect(screen.getByText('משובצים · 2')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('חיפוש לפי שם'), { target: { value: 'אין כזה' } });
    expect(screen.getByText('אין ברשימה שם שמכיל את מה שנכתב.')).toBeTruthy();
  });

  it('with an empty roster, says where people are added', () => {
    mount([], []);
    expect(screen.getByText('עדיין לא שובץ אף אחד')).toBeTruthy();
    expect(screen.getByText(/מוסיפים אותם במסך אנשים/)).toBeTruthy();
  });

  it('closes by a link back to the day', () => {
    mount();
    expect(screen.getByRole('link', { name: 'סיום' }).getAttribute('href'))
      .toBe('/logistics/plan/workdays?season=s&day=e');
  });
});
