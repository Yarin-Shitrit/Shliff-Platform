import type { ReactNode } from 'react';
import Link from 'next/link';
import { Table, type TableColumn, type TableRowModel } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { Icon } from '@/components/ui/icon';
import { ButtonLink } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { DateText } from '@/components/format';
import { cx } from '@/components/ui/cx';
import { isOverdue, isUnderway, type PlanGroup, type PlanItem } from '@/lib/logistics/plan';
import { itemHref, newItemHref, topicHref, type RawParams } from '@/lib/logistics/plan-views';
import { acquisitionHref } from '@/lib/logistics/acquisitions-views';
import {
  STATUS_LABELS, STATUS_TONES, WORK_STATUS_LABELS, WORK_STATUS_TONES,
} from '@/lib/logistics/labels';
import styles from './plan.module.css';

/**
 * The plan as a list: one table per topic, a general item and then its
 * sub-items indented under it. The kit's `Table` takes one row type, so the
 * row carries whether it is a part — which is also how the הקמה screen
 * draws a task and its materials, and for the same reason: the columns
 * (when, who, state, what it waits for) stay aligned between a parent and
 * its parts.
 *
 * A server component. The controls on a row (`rowLead`, `rowActions`) are
 * handed in by the page, so this file holds no client code.
 */

export type PlanLine = { item: PlanItem; sub: boolean };

/** A civil day as the instant `DateText` reads back as that day in Israel. */
export function civil(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** `3 מתוך 6 הושלמו`, and the share for the meter. Cancelled items count nowhere. */
export function topicProgress(group: PlanGroup): { done: number; total: number; percent: number } {
  const live = group.branches
    .flatMap((branch) => [branch.item, ...branch.children])
    .filter((item) => item.status !== 'cancelled');
  const done = live.filter((item) => item.status === 'done').length;
  return { done, total: live.length, percent: live.length === 0 ? 0 : Math.round((done / live.length) * 100) };
}

function When({ item, params, today }: { item: PlanItem; params: RawParams; today: string }) {
  if (item.startsOn === null) {
    return (
      <span className={styles.unscheduled}>
        <Link href={itemHref(params, item.id)}>
          <Icon name="calendar" size={14} />
          לקבוע יום
        </Link>
      </span>
    );
  }
  return (
    <span className={styles.whenCell}>
      <span className={styles.when}>
        <DateText at={civil(item.startsOn)} />
        {item.endsOn !== null && item.endsOn !== item.startsOn ? (
          <>
            <span aria-hidden="true">–</span>
            <DateText at={civil(item.endsOn)} />
          </>
        ) : null}
      </span>
      {isOverdue(item, today) ? <Pill tone="warn">עבר התאריך</Pill>
        : isUnderway(item, today) ? <Pill tone="info">בעבודה</Pill> : null}
    </span>
  );
}

function WaitsFor({ item, params }: { item: PlanItem; params: RawParams }) {
  if (item.waitsFor.length === 0) return <span className={styles.muted} aria-label="לא תלויה במשימה אחרת">—</span>;
  return (
    <span className={styles.waits}>
      {item.waitsFor.map((dep) => (
        <span key={dep.dependencyId} className={cx(styles.waitsOne, dep.conflict && styles.waitsConflict)}>
          {dep.conflict ? <Icon name="alert" size={14} /> : dep.status === 'done' ? <Icon name="check" size={14} /> : null}
          <Link href={itemHref(params, dep.itemId)}>{dep.title}</Link>
          {dep.conflict ? <span className={styles.waitsNote}>לא מסתיימת קודם</span> : null}
        </span>
      ))}
    </span>
  );
}

export function PlanList({
  groups, params, today, currentItemId, rowLead, rowActions,
}: {
  groups: PlanGroup[];
  params: RawParams;
  today: string;
  currentItemId: string | null;
  /** Drawn before the title — the page's done toggle. */
  rowLead?: (line: PlanLine) => ReactNode;
  rowActions?: (line: PlanLine) => ReactNode;
}) {
  const columns: TableColumn<PlanLine>[] = [
    {
      key: 'title', header: 'משימה', card: 'title',
      cell: (line) => {
        const { item, sub } = line;
        return (
          <span className={cx(sub ? styles.subTitle : styles.itemTitle, item.status !== 'open' && styles.titleClosed)}>
            {rowLead?.(line)}
            {sub ? <Icon name="enter" size={14} /> : null}
            <Link href={itemHref(params, item.id)} aria-current={item.id === currentItemId ? 'true' : undefined}>
              {item.title}
            </Link>
          </span>
        );
      },
    },
    { key: 'when', header: 'מתי', card: 'figure', cell: ({ item }) => <When item={item} params={params} today={today} /> },
    {
      key: 'who', header: 'אחראי', card: 'meta',
      cell: ({ item }) => (item.assignee === null
        ? <span className={styles.muted}>לא נקבע</span>
        : (
          <Link href={`/members/${item.assignee.personId}`} className={styles.who}>
            <Avatar name={item.assignee.displayName} size="sm" decorative />
            {item.assignee.displayName}
          </Link>
        )),
    },
    {
      key: 'status', header: 'מצב', card: 'meta',
      /* A purchase's line says the list's word and links to the row that
         can change it; a cancelled line is the board's own word. */
      cell: ({ item }) => (item.purchase !== null && item.status !== 'cancelled' ? (
        <Link href={acquisitionHref(params, item.purchase.id)} className={styles.purchasePill} title="פתיחה ברשימת הרכש">
          <Pill tone={STATUS_TONES[item.purchase.status]} dot>{`רכש · ${STATUS_LABELS[item.purchase.status]}`}</Pill>
        </Link>
      ) : (
        <Pill tone={WORK_STATUS_TONES[item.status]} dot>{WORK_STATUS_LABELS[item.status]}</Pill>
      )),
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
        const progress = topicProgress(group);
        const addHref = newItemHref(params, group.topic === null ? {} : { topicId: group.topic.id });

        return (
          <section key={key} className={styles.topic} aria-label={name}>
            <div className={cx(styles.topicHead, archived && styles.topicArchived)}>
              <h3>
                {group.topic === null ? name : (
                  <Link href={topicHref(params, group.topic.id)}>{name}</Link>
                )}
              </h3>
              {archived ? <Pill tone="outline">בארכיון</Pill> : null}
              {progress.total === 0 ? null : (
                <span className={styles.progress}>
                  <span className={cx(styles.meter, progress.percent === 100 && styles.meterFull)} role="img" aria-label={`${progress.done} מתוך ${progress.total} הושלמו`}>
                    <i style={{ inlineSize: `${progress.percent}%` }} />
                  </span>
                  <bdi className={styles.topicMeta}>{`${progress.done} מתוך ${progress.total} הושלמו`}</bdi>
                </span>
              )}
              <span className={styles.topicSpacer} />
              {archived ? null : (
                <ButtonLink size="sm" tone="ghost" href={addHref}>
                  <Icon name="plus" size={14} />
                  משימה
                </ButtonLink>
              )}
            </div>
            {rows.length === 0 ? (
              <p className={styles.topicEmpty}>
                {'עדיין אין משימות תחת '}
                <bdi>{name}</bdi>
                {'. משימה כללית היא מה שצריך להכין — למשל ״להכין מכולת מטבח״ — ואפשר לפרק אותה לחלקים. '}
                <Link href={addHref}>הוספת משימה</Link>
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
