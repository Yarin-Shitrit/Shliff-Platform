/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';
/**
 * `@testing-library/user-event` is not an installed dependency in this repo
 * and adding it is out of scope here — installing packages is off-limits for
 * this task. `fireEvent.change` / `fireEvent.click` from the already-installed
 * `@testing-library/react` exercise the same paths these tests need.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws "Cannot access before
 * initialization" — `vi.hoisted` is what this codebase already uses to give
 * the factory something to close over (see `member-fee-row.test.tsx`).
 */
const { createTaskAction } = vi.hoisted(() => ({
  createTaskAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ createTaskAction }));

import { NewTaskForm } from './new-task-form';

const EVENTS = [{ id: 'e1', name: 'מסיבת פתיחה' }];

describe('NewTaskForm', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('defaults to shift and shows the shift fields, hiding the others', () => {
    render(<NewTaskForm seasonId="s1" events={EVENTS} />);
    expect(screen.getByLabelText('התחלה')).toBeDefined();
    expect(screen.getByLabelText('סיום')).toBeDefined();
    expect(screen.queryByLabelText('אירוע')).toBeNull();
    expect(screen.queryByLabelText('תקציב (לא חובה)')).toBeNull();
    expect(screen.queryByLabelText('מועד יעד (לא חובה)')).toBeNull();
  });

  it('shows only the event field for an event_task, hiding shift fields', () => {
    render(<NewTaskForm seasonId="s1" events={EVENTS} />);
    fireEvent.change(screen.getByLabelText('סוג'), { target: { value: 'event_task' } });

    expect(screen.getByLabelText('אירוע')).toBeDefined();
    expect(screen.queryByLabelText('התחלה')).toBeNull();
    expect(screen.queryByLabelText('סיום')).toBeNull();
  });

  it('shows only the budget field for a deliverable', () => {
    render(<NewTaskForm seasonId="s1" events={EVENTS} />);
    fireEvent.change(screen.getByLabelText('סוג'), { target: { value: 'deliverable' } });

    expect(screen.getByLabelText('תקציב (לא חובה)')).toBeDefined();
    expect(screen.queryByLabelText('התחלה')).toBeNull();
    expect(screen.queryByLabelText('אירוע')).toBeNull();
  });

  it('shows only the deadline field for a build', () => {
    render(<NewTaskForm seasonId="s1" events={EVENTS} />);
    fireEvent.change(screen.getByLabelText('סוג'), { target: { value: 'build' } });

    expect(screen.getByLabelText('מועד יעד (לא חובה)')).toBeDefined();
    expect(screen.queryByLabelText('התחלה')).toBeNull();
  });

  it('refuses a blank title without calling the action', () => {
    render(<NewTaskForm seasonId="s1" events={EVENTS} />);
    fireEvent.change(screen.getByLabelText('התחלה'), { target: { value: '2026-09-20T10:00' } });
    fireEvent.change(screen.getByLabelText('סיום'), { target: { value: '2026-09-20T18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוסף משימה' }));

    expect(createTaskAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('כותרת');
  });

  it('a shift without both times does not call the action', () => {
    render(<NewTaskForm seasonId="s1" events={EVENTS} />);
    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'משמרת בר' } });
    fireEvent.change(screen.getByLabelText('התחלה'), { target: { value: '2026-09-20T10:00' } });
    // endsAt left blank
    fireEvent.click(screen.getByRole('button', { name: 'הוסף משימה' }));

    expect(createTaskAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('a shift with both times calls the action', () => {
    render(<NewTaskForm seasonId="s1" events={EVENTS} />);
    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'משמרת בר' } });
    fireEvent.change(screen.getByLabelText('התחלה'), { target: { value: '2026-09-20T10:00' } });
    fireEvent.change(screen.getByLabelText('סיום'), { target: { value: '2026-09-20T18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוסף משימה' }));

    expect(createTaskAction).toHaveBeenCalledWith(expect.objectContaining({
      seasonId: 's1',
      kind: 'shift',
      title: 'משמרת בר',
      startsAt: '2026-09-20T10:00',
      endsAt: '2026-09-20T18:00',
    }));
  });

  it('an event_task with no event chosen does not call the action', () => {
    render(<NewTaskForm seasonId="s1" events={EVENTS} />);
    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'ניקיון אחרי המסיבה' } });
    fireEvent.change(screen.getByLabelText('סוג'), { target: { value: 'event_task' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוסף משימה' }));

    expect(createTaskAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('אירוע');
  });

  it('an event_task with an event chosen calls the action', () => {
    render(<NewTaskForm seasonId="s1" events={EVENTS} />);
    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'ניקיון אחרי המסיבה' } });
    fireEvent.change(screen.getByLabelText('סוג'), { target: { value: 'event_task' } });
    fireEvent.change(screen.getByLabelText('אירוע'), { target: { value: 'e1' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוסף משימה' }));

    expect(createTaskAction).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'event_task', title: 'ניקיון אחרי המסיבה', eventId: 'e1',
    }));
  });

  it('surfaces a server refusal, such as a domain rule this form does not duplicate', async () => {
    createTaskAction.mockResolvedValueOnce({ ok: false, error: 'a shift may not end before it starts' });
    render(<NewTaskForm seasonId="s1" events={EVENTS} />);
    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'משמרת בר' } });
    fireEvent.change(screen.getByLabelText('התחלה'), { target: { value: '2026-09-20T18:00' } });
    fireEvent.change(screen.getByLabelText('סיום'), { target: { value: '2026-09-20T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוסף משימה' }));

    expect(await screen.findByText('a shift may not end before it starts')).toBeDefined();
  });

  it('a deliverable with no budget calls the action with an undefined budget', () => {
    render(<NewTaskForm seasonId="s1" events={EVENTS} />);
    fireEvent.change(screen.getByLabelText('כותרת'), { target: { value: 'עגלת ברים' } });
    fireEvent.change(screen.getByLabelText('סוג'), { target: { value: 'deliverable' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוסף משימה' }));

    expect(createTaskAction).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'deliverable', budgetAmount: undefined,
    }));
  });
});
