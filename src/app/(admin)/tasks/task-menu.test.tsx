/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { setTaskStatusAction, setTaskBudgetLineAction } = vi.hoisted(() => ({
  setTaskStatusAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  setTaskBudgetLineAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => ({ setTaskStatusAction, setTaskBudgetLineAction }));

import { TaskMenu } from './task-menu';

function open(over: Partial<React.ComponentProps<typeof TaskMenu>> = {}) {
  render(
    <TaskMenu
      taskId="t1"
      title="הקמת הצל והמבנה"
      status="open"
      kind="build"
      accepted={3}
      hasBudgetLine={false}
      budgetLines={[{ id: 'b1', label: 'גנרטור וחשמל' }]}
      {...over}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'אפשרויות' }));
}

/**
 * Every label here is a verbal noun rather than an imperative: `סגירת המשימה`,
 * not `סגור`. The plan wrote masculine singular imperatives, which I12/A9
 * rules out for a mixed roster, and the kit's own ConfirmDialog asks for the
 * verb-noun form ("`מחיקת התשלום`, `ביטול המשימה`"). The menu item and the
 * dialog's confirm are deliberately different phrases so that a query for one
 * cannot match the other while both are on screen.
 */
describe('TaskMenu', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('confirms before closing a task, naming it', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'סגירת המשימה' }));
    expect(setTaskStatusAction).not.toHaveBeenCalled();
    expect(screen.getByText(/לסגור את המשימה "הקמת הצל והמבנה"/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'סימון כהושלמה' }));
    expect(setTaskStatusAction).toHaveBeenCalledWith('t1', 'done');
  });

  it('confirms before cancelling, and says what happens to the people on it', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'ביטול המשימה' }));
    expect(screen.getByText(/3 שיבוצים/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'סימון כמבוטלת' }));
    expect(setTaskStatusAction).toHaveBeenCalledWith('t1', 'cancelled');
  });

  it('backs out of a confirmation without doing anything', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'ביטול המשימה' }));
    fireEvent.click(screen.getByRole('button', { name: 'חזרה' }));
    expect(setTaskStatusAction).not.toHaveBeenCalled();
  });

  it('reopens a cancelled task, with no confirmation', () => {
    open({ status: 'cancelled' });
    fireEvent.click(screen.getByRole('button', { name: 'פתיחה מחדש' }));
    expect(setTaskStatusAction).toHaveBeenCalledWith('t1', 'open');
  });

  it('offers no closing or cancelling once the task is not open', () => {
    open({ status: 'done' });
    expect(screen.queryByRole('button', { name: 'סגירת המשימה' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ביטול המשימה' })).toBeNull();
  });

  it('links an unlinked deliverable to a budget line', () => {
    open({ kind: 'deliverable' });
    fireEvent.change(screen.getByLabelText('שיוך לסעיף תקציב'), { target: { value: 'b1' } });
    fireEvent.click(screen.getByRole('button', { name: 'שיוך' }));
    expect(setTaskBudgetLineAction).toHaveBeenCalledWith('t1', 'b1');
  });

  it('does not offer a budget line to a task that is not a deliverable', () => {
    open();
    expect(screen.queryByLabelText('שיוך לסעיף תקציב')).toBeNull();
  });

  it('does not offer one to a deliverable that already has a line', () => {
    open({ kind: 'deliverable', hasBudgetLine: true });
    expect(screen.queryByLabelText('שיוך לסעיף תקציב')).toBeNull();
  });

  it('surfaces a failure', async () => {
    setTaskStatusAction.mockResolvedValueOnce({
      ok: false, error: 'שינוי מצב המשימה נכשל. נסו שוב.',
    });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'סגירת המשימה' }));
    fireEvent.click(screen.getByRole('button', { name: 'סימון כהושלמה' }));
    expect(await screen.findByText('שינוי מצב המשימה נכשל. נסו שוב.')).toBeDefined();
  });
});
