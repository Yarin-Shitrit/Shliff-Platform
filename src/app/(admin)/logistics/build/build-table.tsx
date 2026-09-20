import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { Table, type TableColumn, type TableRowModel } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { AvatarStack } from '@/components/ui/avatar';
import { DateText } from '@/components/format';
import type { BuildTask, MaterialRow } from '@/lib/logistics/build';
import { MATERIAL_STATE_LABELS, MATERIAL_STATE_TONES, STATUS_LABELS } from '@/lib/logistics/labels';
/* The tasks screen's own map, imported rather than copied. A second spelling
   of `הושלמה` on this screen would be the exact failure `work/labels.ts`
   documents: four copies of one idea across three files. That file belongs to
   the משימות area — this reads it, and does not edit it. */
import { TASK_STATUS_LABELS } from '../../tasks/rows';
import { itemHref } from '@/lib/logistics/warehouse-views';
import { acquisitionHref } from '@/lib/logistics/acquisitions-views';
import styles from './build.module.css';

/**
 * One table, two kinds of line: a task, then the things it needs, indented
 * under it. The kit's `Table` takes one row type, so the row type is the
 * union — which is also how the artboard draws it, and keeps the columns
 * (`דרוש`, `מצב החומר`, `היכן`) aligned between a task and its materials
 * instead of splitting them across two tables that share nothing.
 */

export type BuildLine =
  | { kind: 'task'; task: BuildTask }
  | { kind: 'material'; task: BuildTask; material: MaterialRow };

const DASH = '—';

/** The bucket a task sits in. The order is the screen's argument. */
export function groupOf(task: BuildTask): string {
  switch (task.materialState) {
    case 'missing': return 'ממתינות לחומרים';
    case 'needs_repair': return 'חומר דורש תיקון';
    case 'none': return 'בלי רשימת חומרים';
    case 'ready':
    default: return 'החומרים מוכנים';
  }
}

/** What a task's own `מצב החומר` cell says, in words (R3). */
function taskStateLabel(task: BuildTask): string {
  const missing = task.materials.filter((one) => one.state === 'missing').length;
  const repair = task.materials.filter((one) => one.state === 'needs_repair').length;

  if (missing === 1) return 'חסר חומר אחד';
  if (missing > 1) return `חסרים ${missing} חומרים`;
  if (repair > 0) return repair === 1 ? 'חומר דורש תיקון' : `${repair} חומרים דורשים תיקון`;
  if (task.materials.length === 0) return 'לא נרשמו חומרים';
  return 'כל החומרים מוכנים';
}

function taskTone(task: BuildTask): 'ok' | 'warn' | 'bad' | 'neutral' {
  switch (task.materialState) {
    case 'missing': return 'bad';
    case 'needs_repair': return 'warn';
    case 'none': return 'neutral';
    case 'ready':
    default: return 'ok';
  }
}

export type BuildTableProps = {
  tasks: readonly BuildTask[];
  /** Counted per bucket by the page, so a heading can say how many. */
  groupCounts: Readonly<Record<string, number>>;
  rowActions?: (line: BuildLine) => ReactNode;
  /** E1: a table is never left with nothing to show and nothing to say. */
  empty: ReactNode;
};

export function BuildTable({
  tasks, groupCounts, rowActions, empty,
}: BuildTableProps): ReactElement {
  const columns: ReadonlyArray<TableColumn<BuildLine>> = [
    {
      key: 'title',
      header: 'משימה וחומרים',
      card: 'title',
      cell: (line) => (line.kind === 'task' ? (
        <span className={styles.taskTitle}>
          <b>{line.task.title}</b>
          {line.task.status === 'open' ? null : (
            <Pill tone="neutral">{TASK_STATUS_LABELS[line.task.status]}</Pill>
          )}
        </span>
      ) : (
        <span className={styles.materialName}>{line.material.name}</span>
      )),
    },
    {
      key: 'needed',
      header: 'דרוש',
      card: 'figure',
      numeric: true,
      // A task needs no count of its own; the number belongs to each thing.
      cell: (line) => (line.kind === 'task' ? DASH : line.material.quantityNeeded),
    },
    {
      key: 'state',
      header: 'מצב החומר',
      card: 'meta',
      cell: (line) => (line.kind === 'task' ? (
        <Pill tone={taskTone(line.task)} dot>{taskStateLabel(line.task)}</Pill>
      ) : (
        <Pill tone={MATERIAL_STATE_TONES[line.material.state]} dot>
          {MATERIAL_STATE_LABELS[line.material.state]}
        </Pill>
      )),
    },
    {
      key: 'where',
      header: 'היכן',
      card: 'meta',
      /*
       * D1, at its most literal: every figure links to the screen that can
       * change it. A material that is on a shelf links to that shelf; one that
       * is on order links to the order. A material with neither has nowhere
       * to send anyone, and says so with a dash rather than a dead link.
       */
      cell: (line) => {
        if (line.kind === 'task') return DASH;
        const { material } = line;
        if (material.inventory !== null) {
          return (
            <Link href={itemHref({}, material.inventory.id)} className="nm">
              {material.inventory.locationText ?? 'במחסן'}
            </Link>
          );
        }
        if (material.acquisition !== null) {
          return (
            <Link href={acquisitionHref({}, material.acquisition.id)} className="nm">
              {`ברכש · ${STATUS_LABELS[material.acquisition.status]}`}
            </Link>
          );
        }
        return DASH;
      },
    },
    {
      key: 'team',
      header: 'אחראי',
      card: 'meta',
      cell: (line) => (line.kind === 'material' ? DASH : (
        <AvatarStack
          people={line.task.assignees.map((person) => ({
            id: person.personId, name: person.displayName,
          }))}
          /* D9's clickable gaps: what is still unstaffed is drawn, not
             implied by a number nobody reads. */
          emptySlots={Math.max(0, line.task.peopleNeeded - line.task.accepted)}
          label={`משובצים ל${line.task.title}`}
        />
      )),
    },
    {
      key: 'due',
      header: 'יעד',
      card: 'meta',
      cell: (line) => {
        if (line.kind === 'material') return DASH;
        return line.task.dueOn === null ? DASH : <DateText at={line.task.dueOn} />;
      },
    },
  ];

  const rows: Array<TableRowModel<BuildLine>> = [];
  for (const task of tasks) {
    const group = `${groupOf(task)} · ${groupCounts[groupOf(task)] ?? 0} משימות`;
    rows.push({
      id: task.taskId,
      data: { kind: 'task', task },
      group,
      tone: task.materialState === 'missing' ? 'warn' : undefined,
    });
    for (const material of task.materials) {
      rows.push({
        id: material.id,
        data: { kind: 'material', task, material },
        group,
      });
    }
  }

  return (
    <Table
      caption="משימות ההקמה והחומרים שכל אחת דורשת"
      columns={columns}
      rows={rows}
      rowActions={rowActions}
      rowActionsHeader="פעולות"
      empty={empty}
    />
  );
}
