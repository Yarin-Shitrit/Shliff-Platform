/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push }),
}));

const { createTaskAction } = vi.hoisted(() => ({
  /** Typed with its argument so `mock.calls[0][0]` is readable: the point of
   *  the budgetAmount test is what the call carried, not that it happened.
   *  The signature goes on `vi.fn`'s type parameter rather than on an unused
   *  implementation argument, which would be a lint error this repo has no
   *  convention for silencing. */
  createTaskAction: vi.fn<(input: Record<string, unknown>) => Promise<ActionResult>>(
    async () => ({ ok: true }),
  ),
}));
vi.mock('./actions', () => ({ createTaskAction }));

import { NewTaskForm } from './new-task-drawer';

const EVENTS = [{ id: 'e1', name: 'מסיבת אוקטובר' }];
const LINES = [{ id: 'b1', label: 'גנרטור וחשמל', totalAgorot: 4_130_000 }];

function form(over: Partial<React.ComponentProps<typeof NewTaskForm>> = {}) {
  render(
    <NewTaskForm
      seasonId="s1"
      seasonName="ברן 26"
      events={EVENTS}
      budgetLines={LINES}
      closeHref="/tasks?season=s1"
      {...over}
    />,
  );
}

function pickKind(value: string) {
  fireEvent.change(screen.getByLabelText('סוג'), { target: { value } });
}

/** `הוספת משימה`, not the plan's `הוסף משימה`: a masculine singular
 *  imperative addressed to a mixed roster is what I12/A9 rules out. */
const SUBMIT = 'הוספת משימה';

describe('NewTaskForm', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows a shift its window and nothing else', () => {
    form();
    pickKind('shift');
    expect(screen.getByLabelText('התחלה')).toBeDefined();
    expect(screen.getByLabelText('סיום')).toBeDefined();
    expect(screen.queryByLabelText('מועד יעד (לא חובה)')).toBeNull();
    expect(screen.queryByLabelText('סעיף תקציב')).toBeNull();
  });

  it('shows a build task its deadline', () => {
    form();
    pickKind('build');
    expect(screen.getByLabelText('מועד יעד (לא חובה)')).toBeDefined();
  });

  /** The amount comes from `formatShekels`, the one place a shekel sign is
   *  attached — `money.ts` forbids composing it at a call site. */
  it('offers a deliverable the season\'s budget lines, with their amounts', () => {
    form();
    pickKind('deliverable');
    expect(screen.getByLabelText('סעיף תקציב')).toBeDefined();
    expect(screen.getByText('גנרטור וחשמל — 41,300 ₪')).toBeDefined();
  });

  it('sends budgetLineId and never budgetAmount', () => {
    form();
    pickKind('deliverable');
    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'גנרטור וחשמל' } });
    fireEvent.change(screen.getByLabelText('סעיף תקציב'), { target: { value: 'b1' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(createTaskAction).toHaveBeenCalledTimes(1);
    const sent = createTaskAction.mock.calls[0]?.[0] ?? {};
    expect(sent.budgetLineId).toBe('b1');
    expect('budgetAmount' in sent).toBe(false);
  });

  it('refuses an event task with no event, as the domain does', () => {
    form();
    pickKind('event_task');
    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'דלת' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(createTaskAction).not.toHaveBeenCalled();
    expect(screen.getByText('משימה באירוע חייבת להיות משויכת לאירוע.')).toBeDefined();
  });

  it('does not offer an event task at all on a season with no events', () => {
    form({ events: [] });
    const option = screen.getByRole('option', { name: 'משימה באירוע' }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(screen.getByText(/אין אירועים בברן 26/)).toBeDefined();
  });

  it('refuses a blank title', () => {
    form();
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(createTaskAction).not.toHaveBeenCalled();
    expect(screen.getByText('כותרת לא יכולה להיות ריקה.')).toBeDefined();
  });

  it('refuses a shift with no window', () => {
    form();
    pickKind('shift');
    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'משמרת בר' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(screen.getByText('משמרת חייבת לכלול שעת התחלה ושעת סיום.')).toBeDefined();
  });

  it('closes the drawer by navigating, once the task is created', async () => {
    form();
    pickKind('build');
    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'הובלה' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    await screen.findByRole('button', { name: SUBMIT });
    expect(push).toHaveBeenCalledWith('/tasks?season=s1');
  });

  it('keeps the drawer open on a failure and says why', async () => {
    createTaskAction.mockResolvedValueOnce({
      ok: false, error: 'משמרת לא יכולה להסתיים לפני שהתחילה.',
    });
    form();
    pickKind('build');
    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'הובלה' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(await screen.findByText('משמרת לא יכולה להסתיים לפני שהתחילה.')).toBeDefined();
    expect(push).not.toHaveBeenCalled();
  });
});
