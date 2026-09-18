/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TaskCoverage } from '@/lib/work/coverage';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('./actions', () => ({
  assignPeopleAction: vi.fn(), setAssignmentStatusAction: vi.fn(),
  removeAssignmentAction: vi.fn(), setTaskStatusAction: vi.fn(),
  setTaskBudgetLineAction: vi.fn(),
}));

import { Table } from '@/components/ui/table';
import { taskColumns, taskRowActions } from './task-row';

const GATE = new Date('2026-10-22T00:00:00+03:00');

function row(over: Partial<TaskCoverage> = {}): TaskCoverage {
  return {
    taskId: 't1', title: 'הקמת הצל והמבנה', kind: 'build', status: 'open',
    peopleNeeded: 8, accepted: 0, uncovered: true,
    eventName: null, eventHeldOn: null,
    budgetAgorot: null, budgetLineId: null, budgetLineLabel: null,
    budgetLineTotalAgorot: null,
    startsAt: null, endsAt: null, dueOn: null, assignees: [],
    ...over,
  };
}

/** Driven through the kit's real `Table`, not a bare `<tr>`: the cells only
 *  exist as that component's columns, so anything else would test a shape the
 *  screen never renders. */
function draw(over: Partial<TaskCoverage> = {}, gate: Date | null = GATE) {
  const ctx = { seasonName: 'ברן 26', gate, candidates: [], budgetLines: [] };
  render(
    <Table
      caption="משימות"
      columns={taskColumns(ctx)}
      rowActions={taskRowActions(ctx)}
      rows={[{ id: 't1', data: row(over) }]}
    />,
  );
}

function accepted(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    assignmentId: `a${i}`, personId: `p${i}`,
    displayName: `אדם ${i}`, status: 'accepted' as const,
  }));
}

describe('TaskRow', () => {
  it('names the task and its kind', () => {
    draw();
    expect(screen.getByText('הקמת הצל והמבנה')).toBeDefined();
    expect(screen.getByText('משימת הקמה')).toBeDefined();
  });

  /**
   * `20/10/26`, not the plan's `20/10`: A2 forbids a second date module and
   * `@/lib/dates` has no DD/MM form, so the table's date is `DateText`'s
   * `short`. G4 allows either.
   */
  it('reads a date against the gate', () => {
    draw({ dueOn: new Date('2026-10-20T09:00:00+03:00') });
    expect(screen.getByText('20/10/26')).toBeDefined();
    expect(screen.getByText(/ימים לפני השער/)).toBeDefined();
  });

  it('shows a shift as a window over its date', () => {
    draw({
      kind: 'shift',
      startsAt: new Date('2026-10-23T22:00:00+03:00'),
      endsAt: new Date('2026-10-24T02:00:00+03:00'),
    });
    expect(screen.getByText('22:00–02:00')).toBeDefined();
    expect(screen.getByText('23/10/26')).toBeDefined();
  });

  it('says so when a task has no date at all', () => {
    draw({ kind: 'deliverable' });
    expect(screen.getByText('בלי תאריך')).toBeDefined();
  });

  it('drops the gate line when the season has no gate', () => {
    draw({ dueOn: new Date('2026-10-20T09:00:00+03:00') }, null);
    expect(screen.getByText('20/10/26')).toBeDefined();
    expect(screen.queryByText(/השער/)).toBeNull();
  });

  it('reads coverage as a figure and a word', () => {
    draw({ peopleNeeded: 8, accepted: 5, assignees: accepted(5) });
    expect(screen.getByText('5/8')).toBeDefined();
    expect(screen.getByText(/חסרים/)).toBeDefined();
  });

  /** `מאוישת`, agreeing with משימה. The plan wrote `מאויש` here and
   *  `מאוישות` elsewhere for the same idea — A9 names that inconsistency. */
  it('says a full task is staffed, in a word', () => {
    draw({ peopleNeeded: 1, accepted: 1, uncovered: false });
    expect(screen.getByText('1/1')).toBeDefined();
    expect(screen.getByText('מאוישת')).toBeDefined();
  });

  it('counts proposals separately from covering assignments', () => {
    draw({
      peopleNeeded: 2, accepted: 0,
      assignees: [{
        assignmentId: 'a1', personId: 'p1', displayName: 'נועה', status: 'proposed',
      }],
    });
    expect(screen.getByText(/הוצעו/)).toBeDefined();
  });

  /**
   * One chip per covering person, then the missing places: the first is the
   * assign control, the rest are dashed slots the kit draws. Two people short
   * of three means one popover trigger and one dashed slot.
   */
  it('shows a chip per person and a place per gap, the first of them clickable', () => {
    draw({ peopleNeeded: 3, accepted: 1, assignees: accepted(1) });
    expect(screen.getByLabelText('אדם 0')).toBeDefined();
    expect(screen.getAllByLabelText('תפקיד פנוי')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'שיבוץ' }).length).toBeGreaterThan(0);
  });

  it('shows a deliverable\'s budget line, amount first', () => {
    draw({
      kind: 'deliverable', budgetLineId: 'b1',
      budgetLineLabel: 'גנרטור וחשמל', budgetLineTotalAgorot: 4_130_000,
    });
    expect(screen.getByText('41,300 ₪')).toBeDefined();
    expect(screen.getByRole('link', { name: 'גנרטור וחשמל' }).getAttribute('href'))
      .toBe('/money/budget#line-b1');
  });

  it('marks a legacy per-task amount as unlinked rather than hiding it', () => {
    draw({ kind: 'deliverable', budgetAgorot: 1_200_000 });
    expect(screen.getByText('12,000 ₪')).toBeDefined();
    expect(screen.getByText('סכום ישן, לא משויך לסעיף')).toBeDefined();
  });

  it('marks a task that is no longer open', () => {
    draw({ status: 'cancelled', uncovered: false });
    expect(screen.getByText('בוטלה')).toBeDefined();
  });
});
