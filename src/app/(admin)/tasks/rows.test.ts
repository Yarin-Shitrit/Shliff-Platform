import { describe, it, expect } from 'vitest';
import type { TaskCoverage } from '@/lib/work/coverage';
import {
  asTaskView, filterTasks, groupByKind, coverageTone, stackSlots,
  proposedCount, tasksHref,
} from './rows';

function task(over: Partial<TaskCoverage> = {}): TaskCoverage {
  return {
    taskId: 't1', title: 'משימה', kind: 'build', status: 'open',
    peopleNeeded: 1, accepted: 0, uncovered: true,
    eventName: null, eventHeldOn: null,
    budgetAgorot: null, budgetLineId: null, budgetLineLabel: null,
    budgetLineTotalAgorot: null,
    startsAt: null, endsAt: null, dueOn: null, assignees: [],
    ...over,
  };
}

function accepted(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    assignmentId: `a${i}`, personId: `p${i}`,
    displayName: `אדם ${i}`, status: 'accepted' as const,
  }));
}

describe('asTaskView', () => {
  it('falls back to the whole list for anything it does not know', () => {
    expect(asTaskView(undefined)).toBe('all');
    expect(asTaskView('nonsense')).toBe('all');
    expect(asTaskView('gaps')).toBe('gaps');
  });
});

describe('filterTasks', () => {
  const rows = [
    task({ taskId: 'gap', uncovered: true, dueOn: new Date('2026-10-20') }),
    task({ taskId: 'full', uncovered: false, accepted: 1, dueOn: new Date('2026-10-21') }),
    task({ taskId: 'undated', uncovered: false, accepted: 1 }),
    task({ taskId: 'cancelled', status: 'cancelled', uncovered: false }),
  ];

  it('keeps everything, closed rows included, in the default view', () => {
    expect(filterTasks(rows, 'all')).toHaveLength(4);
  });

  it('holds only open tasks short of people', () => {
    expect(filterTasks(rows, 'gaps').map((r) => r.taskId)).toEqual(['gap']);
  });

  it('holds only open tasks that are fully staffed', () => {
    expect(filterTasks(rows, 'covered').map((r) => r.taskId))
      .toEqual(['full', 'undated']);
  });

  it('holds the tasks with no date at all', () => {
    expect(filterTasks(rows, 'undated').map((r) => r.taskId)).toEqual(['undated']);
  });
});

describe('groupByKind', () => {
  it('orders the groups build, shift, event, deliverable and drops empty ones', () => {
    const groups = groupByKind([
      task({ taskId: '1', kind: 'deliverable' }),
      task({ taskId: '2', kind: 'shift' }),
      task({ taskId: '3', kind: 'build' }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['build', 'shift', 'deliverable']);
    expect(groups[0].label).toBe('הקמה ולוגיסטיקה');
  });

  /**
   * The mock draws an event task inside the משמרות group. The domain has four
   * kinds and `tasks.kind` is the only thing that says which one a row is, so
   * an event task groups under משימות באירועים however the mock drew it —
   * otherwise "how many משמרות are short" has two different answers depending
   * on who was asked.
   */
  it('groups an event task by its kind, not beside the shifts', () => {
    const groups = groupByKind([
      task({ taskId: 'shift', kind: 'shift' }),
      task({ taskId: 'door', kind: 'event_task' }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['shift', 'event_task']);
    expect(groups[0].rows.map((r) => r.taskId)).toEqual(['shift']);
    expect(groups[1].rows.map((r) => r.taskId)).toEqual(['door']);
  });

  it('puts gaps first inside a group', () => {
    const [group] = groupByKind([
      task({ taskId: 'full', uncovered: false, accepted: 1, dueOn: new Date('2026-10-01') }),
      task({ taskId: 'gap', uncovered: true, dueOn: new Date('2026-10-30') }),
    ]);
    expect(group.rows.map((r) => r.taskId)).toEqual(['gap', 'full']);
  });

  it('sinks a closed or cancelled task below every open one', () => {
    const [group] = groupByKind([
      task({ taskId: 'done', status: 'done', uncovered: false }),
      task({ taskId: 'open', uncovered: false, accepted: 1 }),
    ]);
    expect(group.rows.map((r) => r.taskId)).toEqual(['open', 'done']);
  });

  /**
   * The undated row's id sorts FIRST alphabetically on purpose. Every row
   * here shares a rank and a title, so the id is the last tie-break, and with
   * the plan's `taskId: 'none'` the expected order also happened to be the
   * id order — the test passed whether or not the undated rule existed.
   * Dropping `if (!left !== !right)` from `compare` must fail this.
   */
  it('sorts equal ranks by date, with the undated last', () => {
    const [group] = groupByKind([
      task({ taskId: 'a-undated' }),
      task({ taskId: 'late', dueOn: new Date('2026-10-30') }),
      task({ taskId: 'early', dueOn: new Date('2026-10-01') }),
    ]);
    expect(group.rows.map((r) => r.taskId)).toEqual(['early', 'late', 'a-undated']);
  });

  it('breaks a tie by title and then by id, so recurring shifts hold still', () => {
    const [group] = groupByKind([
      task({ taskId: 'b', kind: 'shift', title: 'משמרת בר' }),
      task({ taskId: 'a', kind: 'shift', title: 'משמרת בר' }),
    ]);
    expect(group.rows.map((r) => r.taskId)).toEqual(['a', 'b']);
  });
});

describe('coverageTone', () => {
  it('is bad with nobody on it, warn part-way, ok when full', () => {
    expect(coverageTone(task({ peopleNeeded: 6, accepted: 0 }))).toBe('bad');
    expect(coverageTone(task({ peopleNeeded: 8, accepted: 5 }))).toBe('warn');
    expect(coverageTone(task({ peopleNeeded: 4, accepted: 4, uncovered: false }))).toBe('ok');
  });

  it('is neutral once the task is no longer open', () => {
    expect(coverageTone(task({ status: 'cancelled', peopleNeeded: 6 }))).toBe('neutral');
  });
});

describe('stackSlots', () => {
  it('shows one chip per covering person and one per missing place', () => {
    const row = task({ peopleNeeded: 3, accepted: 1, assignees: accepted(1) });
    expect(stackSlots(row)).toEqual({ avatars: row.assignees, empty: 2, overflow: 0 });
  });

  it('caps the stack and counts the rest', () => {
    const row = task({ peopleNeeded: 8, accepted: 5, assignees: accepted(5) });
    const slots = stackSlots(row);
    expect(slots.avatars).toHaveLength(5);
    expect(slots.empty).toBe(0);
    expect(slots.overflow).toBe(3);
  });

  it('gives a proposed assignment no chip and no place', () => {
    const row = task({
      peopleNeeded: 2, accepted: 0,
      assignees: [{ assignmentId: 'a', personId: 'p', displayName: 'נועה', status: 'proposed' }],
    });
    expect(stackSlots(row)).toEqual({ avatars: [], empty: 2, overflow: 0 });
    expect(proposedCount(row)).toBe(1);
  });

  it('shows a surplus as chips without inventing places', () => {
    const row = task({ peopleNeeded: 1, accepted: 3, uncovered: false, assignees: accepted(3) });
    expect(stackSlots(row)).toEqual({ avatars: row.assignees, empty: 0, overflow: 0 });
  });
});

describe('tasksHref', () => {
  /**
   * `act=task`, not the plan's `new=task`: integration §5 A3 gives the create
   * drawer an act-only URL, and the param is set by the kit's `openActHref`
   * rather than spelled here.
   */
  it('keeps the season on every link', () => {
    expect(tasksHref({ season: 's1', view: 'gaps' }, { open: 'new' }))
      .toBe('/tasks?season=s1&view=gaps&act=task');
  });

  it('drops the default view rather than spelling it out', () => {
    expect(tasksHref({ season: 's1' }, { view: 'all' })).toBe('/tasks?season=s1');
  });

  it('closes the drawer by leaving the parameter out', () => {
    expect(tasksHref({ season: 's1', view: 'gaps' }, { open: null }))
      .toBe('/tasks?season=s1&view=gaps');
  });

  it('needs no season when none was chosen', () => {
    expect(tasksHref({}, {})).toBe('/tasks');
  });
});
