/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';
/**
 * `@testing-library/user-event` is not an installed dependency in this repo
 * (absent from package.json and node_modules) and adding it is out of scope
 * here — installing packages is off-limits for this task. `fireEvent` from
 * the already-installed `@testing-library/react` exercises the same paths;
 * `fireEvent.change` sets a select's value in one event rather than
 * choosing an option character by character.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws "Cannot access before
 * initialization" — `vi.hoisted` is what this codebase already uses to give
 * the factory something to close over (see `src/lib/auth/guard.test.ts`,
 * `src/app/(admin)/members/unlinked-queue.test.tsx`).
 */
const { assignPersonAction, setAssignmentStatusAction, removeAssignmentAction } = vi.hoisted(
  () => ({
    assignPersonAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
    setAssignmentStatusAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
    removeAssignmentAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  }),
);
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({
  assignPersonAction, setAssignmentStatusAction, removeAssignmentAction,
}));

import { AssignControl } from './assign-control';

const PEOPLE = [
  { personId: 'p1', displayName: 'אופק' },
  { personId: 'p2', displayName: 'עמי' },
];

function renderControl(assignees: React.ComponentProps<typeof AssignControl>['assignees'] = []) {
  return render(
    <AssignControl
      taskId="t1"
      peopleNeeded={4}
      accepted={assignees.filter((a) => a.status === 'accepted').length}
      assignees={assignees}
      people={PEOPLE}
    />,
  );
}

describe('AssignControl', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows how far short of the required headcount the task is', () => {
    renderControl();
    expect(screen.getByText('0 מתוך 4')).toBeDefined();
  });

  it('assigns the person a lead selects', async () => {
    renderControl();
    fireEvent.change(screen.getByLabelText('הוסף אדם'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'שבץ' }));
    expect(assignPersonAction).toHaveBeenCalledWith('t1', 'p1');
  });

  it('does nothing when no person is selected', async () => {
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'שבץ' }));
    expect(assignPersonAction).not.toHaveBeenCalled();
  });

  it('marks a proposed assignment as accepted', async () => {
    renderControl([
      { assignmentId: 'a1', personId: 'p1', displayName: 'אופק', status: 'proposed' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'אישר' }));
    expect(setAssignmentStatusAction).toHaveBeenCalledWith('a1', 'accepted');
  });

  it('removes an assignment', async () => {
    renderControl([
      { assignmentId: 'a1', personId: 'p1', displayName: 'אופק', status: 'accepted' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'הסר' }));
    expect(removeAssignmentAction).toHaveBeenCalledWith('a1');
  });

  it('surfaces a failure instead of silently doing nothing', async () => {
    assignPersonAction.mockResolvedValueOnce({ ok: false, error: 'כבר משובץ' });
    renderControl();
    fireEvent.change(screen.getByLabelText('הוסף אדם'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'שבץ' }));
    expect(await screen.findByText('כבר משובץ')).toBeDefined();
  });
});
