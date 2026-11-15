/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { BoardRow, PersonalMark } from '@/lib/logistics/attendance';
import { unnamedControls } from '@/test/a11y';

const { push, replace, refresh } = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh }) }));

const { addPersonalMarkAction, removePersonalMarkAction } = vi.hoisted(() => ({
  addPersonalMarkAction: vi.fn(async (): Promise<ActionResult<string>> => ({ ok: true, value: 'new' })),
  removePersonalMarkAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => ({ addPersonalMarkAction, removePersonalMarkAction }));

import { PersonalDrawer } from './personal-drawer';

const LEAD = 'lead@shliff.camp';

const ROSTER = [
  { personId: 'p-avi', displayName: 'אבי' },
  { personId: 'p-dana', displayName: 'דנה' },
];

const GENERATOR: PersonalMark = {
  id: 'm1', seasonId: 's1', personId: 'p-dana', displayName: 'דנה', doneOn: '2027-04-01',
  title: 'הביאה את הגנרטור', notes: 'מחיפה', markedBy: LEAD, createdAt: new Date('2027-04-01T18:00:00Z'),
};

const DANA: BoardRow = {
  personId: 'p-dana', displayName: 'דנה', onRoster: true, present: new Set(), personal: [GENERATOR], total: 1,
};

const PARAMS = { season: 's1' };
const CLOSE = '/logistics/attendance?season=s1';

function mount(person: BoardRow | null) {
  return render(
    <ToastProvider>
      <PersonalDrawer
        person={person}
        seasonId="s1"
        seasonName="ברן 27"
        closeHref={CLOSE}
        params={PARAMS}
        roster={ROSTER}
        presetDay="2027-03-20"
      />
    </ToastProvider>,
  );
}

async function press(name: string | RegExp) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('the drawer that adds a personal mark', () => {
  it('names every control and says nothing in English', () => {
    const { container } = mount(null);
    expect(unnamedControls(container)).toEqual([]);
    expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('starts on the day it was given, offers the roster, and refuses a missing person beside the field', async () => {
    mount(null);
    expect((screen.getByLabelText(/באיזה יום/) as HTMLInputElement).value).toBe('2027-03-20');
    expect(screen.getByRole('option', { name: 'אבי' })).toBeTruthy();
    await press('הוספת הסימון');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/למי/);
    expect(addPersonalMarkAction).not.toHaveBeenCalled();
  });

  it('refuses a blank title and a blank day without a round trip', async () => {
    mount(null);
    fireEvent.change(screen.getByLabelText(/למי/), { target: { value: 'p-avi' } });
    await press('הוספת הסימון');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/מה נעשה/);

    fireEvent.change(screen.getByLabelText(/מה נעשה/), { target: { value: 'הדפיס מדבקות' } });
    fireEvent.change(screen.getByLabelText(/באיזה יום/), { target: { value: '' } });
    await press('הוספת הסימון');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/יום/);
    expect(addPersonalMarkAction).not.toHaveBeenCalled();
  });

  it('sends the mark for the season, says so with an undo, and lands on the person’s drawer', async () => {
    mount(null);
    fireEvent.change(screen.getByLabelText(/למי/), { target: { value: 'p-avi' } });
    fireEvent.change(screen.getByLabelText(/מה נעשה/), { target: { value: ' הדפיס מדבקות ' } });
    await press('הוספת הסימון');
    expect(addPersonalMarkAction).toHaveBeenCalledWith('s1', {
      personId: 'p-avi', doneOn: '2027-03-20', title: 'הדפיס מדבקות', notes: null,
    });
    expect(await screen.findByText('״הדפיס מדבקות״ נרשם לאבי')).toBeTruthy();
    expect(push).toHaveBeenCalledWith('/logistics/attendance?season=s1&person=p-avi');
    expect(refresh).toHaveBeenCalled();

    // The toast's ביטול is the domain's inverse: remove the row just made.
    await press('ביטול');
    expect(removePersonalMarkAction).toHaveBeenCalledWith('new');
  });

  it('shows the action’s Hebrew refusal and stays open', async () => {
    addPersonalMarkAction.mockResolvedValueOnce({ ok: false, error: 'לא מצאנו את השנה הזו' });
    mount(null);
    fireEvent.change(screen.getByLabelText(/למי/), { target: { value: 'p-avi' } });
    fireEvent.change(screen.getByLabelText(/מה נעשה/), { target: { value: 'א' } });
    await press('הוספת הסימון');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('לא מצאנו את השנה הזו');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('the drawer over a person’s personal marks', () => {
  it('is titled by the name, lists what they did with its day and notes, and has no person to pick', () => {
    mount(DANA);
    expect(screen.getByRole('heading', { name: 'דנה' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'סימונים אישיים · 1' })).toBeTruthy();
    expect(screen.getByText('הביאה את הגנרטור')).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toMatch(/01\/04\/2027.*מחיפה/);
    expect(screen.queryByLabelText(/למי/)).toBeNull();
    expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('adds for that person and stays put, with the form cleared for the next one', async () => {
    mount(DANA);
    fireEvent.change(screen.getByLabelText(/מה נעשה/), { target: { value: 'תיקנה את המקרר' } });
    fireEvent.change(screen.getByLabelText(/הערות/), { target: { value: 'ביום שישי' } });
    await press('הוספת הסימון');
    expect(addPersonalMarkAction).toHaveBeenCalledWith('s1', {
      personId: 'p-dana', doneOn: '2027-03-20', title: 'תיקנה את המקרר', notes: 'ביום שישי',
    });
    expect(push).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect((screen.getByLabelText(/מה נעשה/) as HTMLInputElement).value).toBe('');
  });

  it('removes a mark at once, says so, and offers it back as the same mark', async () => {
    mount(DANA);
    await press('הסרה · הביאה את הגנרטור');
    expect(removePersonalMarkAction).toHaveBeenCalledWith('m1');
    expect(screen.queryByText('הביאה את הגנרטור')).toBeNull();
    expect(screen.getByRole('heading', { name: 'עדיין אין סימונים אישיים' })).toBeTruthy();
    expect(await screen.findByText('״הביאה את הגנרטור״ של דנה הוסר')).toBeTruthy();

    await press('ביטול');
    expect(addPersonalMarkAction).toHaveBeenCalledWith('s1', {
      personId: 'p-dana', doneOn: '2027-04-01', title: 'הביאה את הגנרטור', notes: 'מחיפה',
    });
  });

  it('puts a refused removal back and shows the refusal', async () => {
    removePersonalMarkAction.mockResolvedValueOnce({ ok: false, error: 'לא מצאנו את הסימון הזה' });
    mount(DANA);
    await press('הסרה · הביאה את הגנרטור');
    expect(await screen.findByText('לא מצאנו את הסימון הזה')).toBeTruthy();
    expect(screen.getByText('הביאה את הגנרטור')).toBeTruthy();
  });

  it('offers no form for someone off the roster, and says why', () => {
    mount({ ...DANA, onRoster: false });
    expect(screen.queryByRole('button', { name: 'הוספת הסימון' })).toBeNull();
    expect(screen.queryByLabelText(/מה נעשה/)).toBeNull();
    expect(screen.getByText(/כבר לא ברשימת ברן 27/)).toBeTruthy();
    expect(screen.getByText('לא ברשימת השנה')).toBeTruthy();
    // What was recorded is still listed, and can still be taken back.
    expect(screen.getByRole('button', { name: 'הסרה · הביאה את הגנרטור' })).toBeTruthy();
  });
});
