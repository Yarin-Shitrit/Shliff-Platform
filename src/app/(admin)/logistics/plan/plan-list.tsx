import type { ReactNode } from 'react';
import Link from 'next/link';
import { Table, type TableColumn, type TableRowModel } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { Icon } from '@/components/ui/icon';
import { ButtonLink } from '@/components/ui/button';
import { DateText } from '@/components/format';
import { cx } from '@/components/ui/cx';
import type { PlanGroup, PlanItem } from '@/lib/logistics/plan';
import { itemHref, newItemHref, topicHref, type RawParams } from '@/lib/logistics/plan-views';
import { WORK_STATUS_LABELS, WORK_STATUS_TONES } from '@/lib/logistics/labels';
import styles from './plan.module.css';

/**
 * The plan as a list: one table per topic, a general item and then its
 * sub-items indented under it. The kit's `Table` takes one row type, so the
 * row carries whether it is a part — which is also how the הקמה screen
 * draws a task and its materials, and for the same reason: the columns
 * (when, who, state, what it waits for) stay aligned between a parent and
 * its parts.
 *
 * A server component. The one control on a row (`rowActions`) is handed in
 * by the page, so this file holds no client code.
 */

export type PlanLine = { item: PlanItem; sub: boolean };

/** A civil day as the instant `DateText` reads back as that day in Israel. */
export function civil(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function When({ item, params }: { item: PlanItem; params: RawParams }) {
  if (item.startsOn === null) {
    return (
      <span className={styles.unscheduled}>
        <Link href={itemHref(params, item.id)}>עדיין לא נקבע</Link>
      </span>
    );
  }
  return (
    <span className={styles.when}>
      <DateText at={civil(item.startsOn)} />
      {item.endsOn !== null && item.endsOn !== item.startsOn ? (
        <>
          <span aria-hidden="true">–</span>
          <DateText at={civil(item.endsOn)} />
        </>
      ) : null}
    </span>
  );
}

function WaitsFor({ item, params }: { item: PlanItem; params: RawParams }) {
  if (item.waitsFor.length === 0) return <span className={styles.muted}>—</span>;
  return (
    <span className={styles.waits}>
      {item.waitsFor.map((dep) => (
        <span key={dep.dependencyId} className={cx(dep.conflict && styles.waitsConflict)}>
          <Link href={itemHref(params, dep.itemId)}>{dep.title}</Link>
          {dep.conflict ? ' · לא מסתיימת קודם' : null}
        </span>
      ))}
    </span>
  );
}

export function PlanList({
  groups, params, currentItemId, rowActions,
}: {
  groups: PlanGroup[];
  params: RawParams;
  currentItemId: string | null;
  rowActions?: (line: PlanLine) => ReactNode;
}) {
  const columns: TableColumn<PlanLine>[] = [
    {
      key: 'title', header: 'משימה', card: 'title',
      cell: ({ item, sub }) => (
        <span className={sub ? styles.subTitle : styles.itemTitle}>
          {sub ? <Icon name="enter" size={14} /> : null}
          <Link href={itemHref(params, item.id)} aria-current={item.id === currentItemId ? 'true' : undefined}>
            {item.title}
          </Link>
        </span>
      ),
    },
    { key: 'when', header: 'מתי', card: 'figure', cell: ({ item }) => <When item={item} params={params} /> },
    {
      key: 'who', header: 'אחראי', card: 'meta',
      cell: ({ item }) => (item.assignee === null
        ? <span className={styles.muted}>לא נקבע</span>
        : <Link href={`/members/${item.assignee.personId}`}>{item.assignee.displayName}</Link>),
    },
    {
      key: 'status', header: 'מצב', card: 'meta',
      cell: ({ item }) => <Pill tone={WORK_STATUS_TONES[item.status]} dot>{WORK_STATUS_LABELS[item.status]}</Pill>,
    },
    { key: 'waits', header: 'אחרי', card: 'meta', cell: ({ item }) => <WaitsFor item={item} params={params} /> },
  ];

  return (
    <>
      {groups.map((group) => {
        const key = group.topic?.id ?? 'none';
        const name = group.topic?.name ?? 'בלי נושא';
        const rows: Array<TableRowModel<PlanLine>> = group.branches.flatMap((branch) => [
          lineOf(branch.item, false),
          ...branch.children.map((child) => lineOf(child, true)),
        ]);
        const archived = group.topic?.archivedAt != null;

        return (
          <section key={key} className={styles.section} aria-label={name}>
            <div className={cx(styles.topicHead, archived && styles.topicArchived)}>
              <h3>
                {group.topic === null ? name : (
                  <Link href={topicHref(params, group.topic.id)}>{name}</Link>
                )}
              </h3>
              <span className={styles.topicMeta}>
                {archived ? 'בארכיון · ' : null}
                {countText(rows.length)}
              </span>
              {archived ? null : (
                <ButtonLink size="sm" tone="ghost" href={newItemHref(params, group.topic === null ? {} : { topicId: group.topic.id })}>
                  <Icon name="plus" size={14} />
                  משימה
                </ButtonLink>
              )}
            </div>
            {rows.length === 0 ? (
              <p className={styles.topicEmpty}>
                {'עדיין אין משימות תחת '}
                <bdi>{name}</bdi>
                {'. משימה כללית היא מה שצריך להכין — למשל ״להכין מכולת מטבח״ — ואפשר לפרק אותה לתת־משימות. '}
                <Link href={newItemHref(params, group.topic === null ? {} : { topicId: group.topic.id })}>הוספת משימה</Link>
              </p>
            ) : (
              <Table<PlanLine>
                caption={`משימות · ${name}`}
                density="compact"
                columns={columns}
                rows={rows}
                rowActions={rowActions}
                rowActionsVisible
                rowActionsHeader="פעולות"
                empty={<p className={styles.topicEmpty}>אין משימות</p>}
              />
            )}
          </section>
        );
      })}
    </>
  );
}

function lineOf(item: PlanItem, sub: boolean): TableRowModel<PlanLine> {
  return {
    id: item.id,
    data: { item, sub },
    tone: item.waitsFor.some((dep) => dep.conflict) ? 'warn' : undefined,
  };
}

function countText(count: number): string {
  if (count === 0) return 'אין משימות';
  if (count === 1) return 'משימה אחת';
  return `${count} משימות`;
}
