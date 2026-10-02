import type { ReactNode } from 'react';
import Link from 'next/link';
import { formatTime } from '@/lib/dates';
import { DateText, Money } from '@/components/format';
import type { RosterCandidate, TaskCoverage } from '@/lib/work/coverage';
import { gateRelation, taskWhen } from '@/lib/work/gate';
import { AvatarStack } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import type { TableColumn } from '@/components/ui/table';
import { GateNote } from './gate-note';
import { AssignPopover } from './assign-popover';
import { TaskMenu } from './task-menu';
import {
  coverageTone, proposedCount, stackSlots,
  KIND_ROW_LABELS, TASK_STATUS_LABELS,
} from './rows';
import styles from './tasks.module.css';

/**
 * The five cells of a task, as columns for the kit's `Table`.
 *
 * The plan wrote this as a `<TaskRow>` returning its own `<tr>`, against a
 * draft `Table` that took `children` and a separate `TableGroupRow`. The kit
 * that shipped is data-driven — it owns the `<tr>`, the `<td>`s, the group
 * heading (`TableRowModel.group`, whose docstring names D9's kinds) and the
 * `<tfoot>` — and there is no `TableGroupRow` at all. Forking a second table
 * to keep the old shape is the one thing spec C forbids outright, so the call
 * site adapts: a cell renderer per column, and the row actions through the
 * `rowActions` slot the kit provides for exactly this.
 */
export interface TaskRowContext {
  seasonName: string;
  gate: Date | null;
  candidates: RosterCandidate[];
  budgetLines: Array<{ id: string; label: string }>;
}

/** The sentence beside the `5/8`, as one string. R3: the pill's colour never
 *  carries the meaning on its own, so the words are always there — and A17
 *  keeps the whole phrase in one isolate rather than one per number, because
 *  a phrase split across isolates is a phrase no test can read. */
function coverageWords(row: TaskCoverage): string {
  if (row.status !== 'open') return TASK_STATUS_LABELS[row.status];
  const missing = Math.max(0, row.peopleNeeded - row.accepted);
  if (missing === 0) return 'מאוישת';
  const proposed = proposedCount(row);
  return proposed > 0 ? `חסרים ${missing} · הוצעו ${proposed}` : `חסרים ${missing}`;
}

function TitleCell({ row }: { row: TaskCoverage }) {
  return (
    <span className={styles.title}>
      <b>{row.title}</b>
      <span className={styles.sub}>
        {KIND_ROW_LABELS[row.kind]}
        {row.eventName && <>{' · '}<bdi>{row.eventName}</bdi></>}
      </span>
    </span>
  );
}

function WhenCell({ row, gate }: { row: TaskCoverage; gate: Date | null }) {
  const when = taskWhen(row);
  if (when.kind === 'none') return <span className={styles.sub}>בלי תאריך</span>;
  if (when.kind === 'window') {
    return (
      <span className={styles.title}>
        <bdi dir="ltr">{`${formatTime(when.startsAt)}–${formatTime(when.endsAt)}`}</bdi>
        <span className={styles.sub}><DateText at={when.startsAt} /></span>
      </span>
    );
  }
  return (
    <span className={styles.title}>
      <DateText at={when.at} />
      <span className={styles.sub}>
        <GateNote relation={gateRelation(when.at, gate)} />
      </span>
    </span>
  );
}

/**
 * The avatar stack is the kit's `AvatarStack`, which draws the people and the
 * dashed places itself. The first missing place is the assign popover instead
 * of a dashed slot, so a gap is something a lead can click; the kit's own
 * `emptySlotHref` is not used, because it makes a slot a link and this
 * screen's assign control is a popover with no URL of its own (§5 A3).
 */
function TeamCell({ row, ctx }: { row: TaskCoverage; ctx: TaskRowContext }) {
  const slots = stackSlots(row);
  const canAssign = row.status === 'open' && slots.empty > 0;
  return (
    <span className={styles.team}>
      <AvatarStack
        people={slots.avatars.map((assignee) => ({
          id: assignee.assignmentId, name: assignee.displayName,
        }))}
        // `stackSlots` already capped the list and counted the rest, so the
        // stack must not cap it a second time and report its own overflow on
        // top of that one.
        max={slots.avatars.length}
        emptySlots={Math.max(0, slots.empty - (canAssign ? 1 : 0))}
        size="sm"
        label={`צוות — ${row.title}`}
      />
      {canAssign && (
        <AssignPopover
          variant="slot"
          taskId={row.taskId}
          title={row.title}
          seasonName={ctx.seasonName}
          peopleNeeded={row.peopleNeeded}
          accepted={row.accepted}
          assignees={row.assignees}
          candidates={ctx.candidates}
        />
      )}
      {slots.overflow > 0 && (
        <span className={styles.sub}><bdi>{`+${slots.overflow}`}</bdi></span>
      )}
    </span>
  );
}

function CoverageCell({ row }: { row: TaskCoverage }) {
  return (
    <span className={styles.title}>
      {/* The isolate goes outside the Pill, not inside it: `Pill.children` is
          typed `string` because R3 makes a pill a word, and it throws on
          anything it cannot test for blankness. */}
      <bdi>
        <Pill tone={coverageTone(row)}>{`${row.accepted}/${row.peopleNeeded}`}</Pill>
      </bdi>
      <span className={styles.sub}>{coverageWords(row)}</span>
    </span>
  );
}

function BudgetCell({ row }: { row: TaskCoverage }) {
  if (row.budgetLineId && row.budgetLineTotalAgorot !== null) {
    return (
      <span className={styles.title}>
        <Money agorot={row.budgetLineTotalAgorot} />
        {/* Every figure links to the page that can change it. */}
        <span className={styles.sub}>
          <Link className="link" href={`/money#budget-${row.budgetLineId}`}>
            <bdi>{row.budgetLineLabel}</bdi>
          </Link>
        </span>
      </span>
    );
  }
  if (row.budgetAgorot !== null) {
    // Deprecated column, still on rows written before budget lines existed.
    // Shown rather than hidden, and named for what it is — the row menu
    // offers to link it (spec R11's spirit: a figure says where it came from).
    return (
      <span className={styles.title}>
        <Money agorot={row.budgetAgorot} />
        <span className={styles.sub}>סכום ישן, לא משויך לסעיף</span>
      </span>
    );
  }
  return <span className={styles.sub}>—</span>;
}

export function taskColumns(ctx: TaskRowContext): Array<TableColumn<TaskCoverage>> {
  return [
    { key: 'task', card: 'title', header: 'משימה', cell: (row) => <TitleCell row={row} /> },
    { key: 'when', card: 'meta', header: 'מתי', w0: true, cell: (row) => <WhenCell row={row} gate={ctx.gate} /> },
    { key: 'team', card: 'meta', header: 'צוות', w0: true, cell: (row) => <TeamCell row={row} ctx={ctx} /> },
    { key: 'coverage', card: 'figure', header: 'איוש', w0: true, cell: (row) => <CoverageCell row={row} /> },
    { key: 'budget', card: 'meta', header: 'תקציב', w0: true, cell: (row) => <BudgetCell row={row} /> },
  ];
}

/** The row's two islands, for the kit `Table`'s `rowActions` slot. */
export function taskRowActions(ctx: TaskRowContext): (row: TaskCoverage) => ReactNode {
  return function actions(row: TaskCoverage) {
    return (
      <span className={styles.rowActions}>
        {row.status === 'open' && (
          <AssignPopover
            taskId={row.taskId}
            title={row.title}
            seasonName={ctx.seasonName}
            peopleNeeded={row.peopleNeeded}
            accepted={row.accepted}
            assignees={row.assignees}
            candidates={ctx.candidates}
          />
        )}
        <TaskMenu
          taskId={row.taskId}
          title={row.title}
          status={row.status}
          kind={row.kind}
          accepted={row.accepted}
          hasBudgetLine={row.budgetLineId !== null}
          budgetLines={ctx.budgetLines}
        />
      </span>
    );
  };
}
