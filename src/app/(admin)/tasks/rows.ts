import type { TaskKind, TaskStatus } from '@/db/schema/camp';
import { covers, type Assignee, type TaskCoverage } from '@/lib/work/coverage';
import { taskWhen, whenDate } from '@/lib/work/gate';
import { openActHref } from '@/components/ui/drawer-url';
import { TASK_KIND_GROUP_LABELS, TASK_KIND_ROW_LABELS } from '@/lib/work/labels';

/** Groups run in the order the burn does: what is built, who staffs it,
 *  what happens at the parties, and who owns which budget. */
export const KIND_ORDER: TaskKind[] = ['build', 'shift', 'event_task', 'deliverable'];

/**
 * A39: the four task-kind label maps have collapsed into
 * `src/lib/work/labels.ts`, which is the library home for them. These two
 * names stay as the aliases this screen already imports under — the register
 * each one is written in is the thing that differs, and it is documented there.
 */
export { TASK_KIND_GROUP_LABELS as KIND_LABELS, TASK_KIND_ROW_LABELS as KIND_ROW_LABELS };

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'פתוחה',
  done: 'הושלמה',
  cancelled: 'בוטלה',
};

export type TaskView = 'all' | 'gaps' | 'covered' | 'undated';
const VIEWS: TaskView[] = ['all', 'gaps', 'covered', 'undated'];

/** A view that is not one of ours is the whole list, not a 404: the value
 *  comes from a URL a lead may have edited by hand. */
export function asTaskView(value: string | undefined): TaskView {
  return VIEWS.includes(value as TaskView) ? (value as TaskView) : 'all';
}

export function filterTasks(rows: TaskCoverage[], view: TaskView): TaskCoverage[] {
  if (view === 'gaps') return rows.filter((row) => row.uncovered);
  if (view === 'covered') {
    return rows.filter((row) => row.status === 'open' && !row.uncovered);
  }
  if (view === 'undated') {
    return rows.filter((row) => row.status === 'open' && taskWhen(row).kind === 'none');
  }
  return rows;
}

export interface TaskGroup { kind: TaskKind; label: string; rows: TaskCoverage[] }

/** Open gaps, then open and staffed, then everything closed or cancelled. */
function rank(row: TaskCoverage): number {
  if (row.status !== 'open') return 2;
  return row.uncovered ? 0 : 1;
}

function compare(a: TaskCoverage, b: TaskCoverage): number {
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const left = whenDate(taskWhen(a));
  const right = whenDate(taskWhen(b));
  if (left && right && left.getTime() !== right.getTime()) {
    return left.getTime() - right.getTime();
  }
  // An undated task sorts last within its rank rather than first, which is
  // where a null would otherwise put it.
  if (!left !== !right) return left ? -1 : 1;
  // `taskId` breaks the last tie for the same reason `coverageFor` orders
  // by it: a recurring `משמרת בר` shares its title with its siblings.
  return a.title.localeCompare(b.title, 'he') || a.taskId.localeCompare(b.taskId);
}

/**
 * One group per kind, in `KIND_ORDER`, and a row lands in the group its own
 * `kind` column names. The mock draws an event task inside משמרות; that is a
 * drawing, not a fact about the row, and reproducing it would make the
 * משמרות count disagree with `listTasks`.
 */
export function groupByKind(rows: TaskCoverage[]): TaskGroup[] {
  return KIND_ORDER
    .map((kind) => ({
      kind,
      label: TASK_KIND_GROUP_LABELS[kind],
      rows: rows.filter((row) => row.kind === kind).sort(compare),
    }))
    .filter((group) => group.rows.length > 0);
}

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

/** Spec R3: the tone never carries the meaning on its own — the cell always
 *  prints `חסרים 3` or `מאוישת` beside the figure. */
export function coverageTone(row: TaskCoverage): Tone {
  if (row.status !== 'open') return 'neutral';
  if (row.accepted >= row.peopleNeeded) return 'ok';
  return row.accepted === 0 ? 'bad' : 'warn';
}

export interface StackSlots {
  avatars: Assignee[];
  /** Dashed places still to fill. The first one is the button. */
  empty: number;
  /** Places beyond the cap, shown as `+3`. */
  overflow: number;
}

/**
 * The avatar stack: one chip per person who actually covers the task, then
 * one dashed chip per missing place, capped so a task needing twelve does
 * not take the column over. A `proposed` assignment gets no chip, because
 * it fills no place — it appears in the popover with its own accept control.
 */
export function stackSlots(row: TaskCoverage, cap = 5): StackSlots {
  const covering = row.assignees.filter((assignee) => covers(assignee.status));
  const missing = Math.max(0, row.peopleNeeded - covering.length);
  const total = covering.length + missing;
  const shown = Math.min(total, cap);
  const avatars = covering.slice(0, shown);
  return { avatars, empty: shown - avatars.length, overflow: total - shown };
}

export function proposedCount(row: TaskCoverage): number {
  return row.assignees.filter((assignee) => assignee.status === 'proposed').length;
}

/**
 * Every link on this screen keeps the season (spec R5) and carries the
 * drawer in the URL (R6). Built rather than templated so no call site can
 * forget the season and quietly send a lead to a different year.
 *
 * The drawer param is set by the kit's `openActHref` and never spelled here
 * (integration §5 A3/I9): a create drawer has no record, so it is `?act=task`
 * with no `?peek=`, and the kit is the one place that knows that name.
 */
export function tasksHref(
  current: { season?: string; view?: string },
  change: { view?: TaskView | null; open?: 'new' | null },
): string {
  const params = new URLSearchParams();
  if (current.season) params.set('season', current.season);
  const view = change.view === undefined ? asTaskView(current.view) : change.view;
  if (view && view !== 'all') params.set('view', view);
  if (change.open === 'new') return openActHref('/tasks', params, 'task');
  const query = params.toString();
  return query ? `/tasks?${query}` : '/tasks';
}
