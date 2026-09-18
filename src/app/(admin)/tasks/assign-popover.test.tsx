/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const {
  assignPeopleAction, setAssignmentStatusAction, removeAssignmentAction,
} = vi.hoisted(() => ({
  assignPeopleAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  setAssignmentStatusAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  removeAssignmentAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({
  assignPeopleAction, setAssignmentStatusAction, removeAssignmentAction,
}));

import { AssignPopover } from './assign-popover';

const CANDIDATES = [
  { personId: 'p1', displayName: 'נועה לוי', taskCount: 0 },
  { personId: 'p2', displayName: 'איתי כהן', taskCount: 0 },
  { personId: 'p3', displayName: 'רוני אדלר', taskCount: 2 },
];

function open(over: Partial<React.ComponentProps<typeof AssignPopover>> = {}) {
  render(
    <AssignPopover
      taskId="t1"
      title="הקמת הצל והמבנה"
      seasonName="ברן 26"
      peopleNeeded={8}
      accepted={5}
      assignees={[]}
      candidates={CANDIDATES}
      {...over}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'שיבוץ' }));
}

describe('AssignPopover', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('offers the season roster it was given', () => {
    open();
    expect(screen.getByRole('button', { name: /נועה לוי/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /רוני אדלר/ })).toBeDefined();
  });

  it('says how loaded each candidate already is', () => {
    open();
    expect(screen.getByText('כבר ב־2 משימות')).toBeDefined();
    expect(screen.getAllByText('בברן 26 · 0 משימות')).toHaveLength(2);
  });

  it('assigns several people in one action', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /נועה לוי/ }));
    fireEvent.click(screen.getByRole('button', { name: /איתי כהן/ }));
    fireEvent.click(screen.getByRole('button', { name: /^שיבוץ 2$/ }));
    expect(assignPeopleAction).toHaveBeenCalledWith('t1', ['p1', 'p2']);
  });

  it('will not submit an empty selection', () => {
    open();
    expect(screen.getByRole('button', { name: /^שיבוץ 0$/ })
      .hasAttribute('disabled')).toBe(true);
  });

  it('searches by name', () => {
    open();
    fireEvent.change(screen.getByLabelText('חיפוש חבר'), { target: { value: 'רוני' } });
    expect(screen.queryByRole('button', { name: /נועה לוי/ })).toBeNull();
    expect(screen.getByRole('button', { name: /רוני אדלר/ })).toBeDefined();
  });

  /** `כבר במשימה הזו`, not the plan's `כבר משובץ`: I12/A9 — the roster is
   *  mixed and `משובץ` inflects on the person. */
  it('will not offer someone already on this task', () => {
    open({
      assignees: [{
        assignmentId: 'a1', personId: 'p1', displayName: 'נועה לוי', status: 'accepted',
      }],
    });
    expect(screen.getByText('כבר במשימה הזו')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /נועה לוי/ }));
    expect(screen.getByRole('button', { name: /^שיבוץ 0$/ })
      .hasAttribute('disabled')).toBe(true);
  });

  it('accepts a proposed assignment', () => {
    open({
      assignees: [{
        assignmentId: 'a1', personId: 'p1', displayName: 'נועה לוי', status: 'proposed',
      }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'אשרו' }));
    expect(setAssignmentStatusAction).toHaveBeenCalledWith('a1', 'accepted');
  });

  /** Every assignment status reads as a fact about the שיבוץ, never about the
   *  person — `אושר`, not `אישר`; `בוטל`, not `ירד`. */
  it('states an assignment status without inflecting on the person', () => {
    open({
      assignees: [{
        assignmentId: 'a1', personId: 'p1', displayName: 'נועה לוי', status: 'accepted',
      }],
    });
    expect(screen.getByText('אושר')).toBeDefined();
    expect(screen.queryByText('אישר')).toBeNull();
  });

  it('confirms before removing an assignment', () => {
    open({
      assignees: [{
        assignmentId: 'a1', personId: 'p1', displayName: 'נועה לוי', status: 'accepted',
      }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'הסרה' }));
    expect(removeAssignmentAction).not.toHaveBeenCalled();
    expect(screen.getByText(/להסיר את נועה לוי/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'הסרת השיבוץ' }));
    expect(removeAssignmentAction).toHaveBeenCalledWith('a1');
  });

  /** The kit's EmptyState writes the sentence; the screen supplies the noun,
   *  the season and — T4 — the page that can change it. */
  it('says what to do when the season has no members yet', () => {
    open({ candidates: [] });
    expect(screen.getByText(/אין חברי קאמפ בברן 26/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'הוספת חברים לשנה' })
      .getAttribute('href')).toBe('/members');
  });

  it('surfaces a failure instead of closing on it', async () => {
    assignPeopleAction.mockResolvedValueOnce({
      ok: false, error: 'האדם הזה מוזג לאדם אחר — שבצו את מי שנשאר',
    });
    open();
    fireEvent.click(screen.getByRole('button', { name: /נועה לוי/ }));
    fireEvent.click(screen.getByRole('button', { name: /^שיבוץ 1$/ }));
    expect(await screen.findByText('האדם הזה מוזג לאדם אחר — שבצו את מי שנשאר'))
      .toBeDefined();
  });

  it('closes on esc', () => {
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByLabelText('חיפוש חבר')).toBeNull();
  });
});
