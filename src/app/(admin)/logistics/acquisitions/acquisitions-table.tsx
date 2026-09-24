import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { Table, type TableColumn } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { SourceChip } from '@/components/ui/source-chip';
import { Money } from '@/components/format';
import type { AcquisitionRow } from '@/lib/logistics/acquisitions';
import {
  CAMP_WIDE_LABEL, CATEGORY_LABELS, SOURCE_LABELS, STATUS_LABELS, STATUS_TONES,
} from '@/lib/logistics/labels';
import { acquisitionHref, type RawParams } from '@/lib/logistics/acquisitions-views';
import styles from './acquisitions.module.css';

/**
 * No `'use client'`. Sorting and filtering are the server's (plan `ui-03`
 * Task 2), and every control this table draws is a link — except the row
 * action slot, which the page fills.
 */

export type AcquisitionsTableProps = {
  rows: readonly AcquisitionRow[];
  params: RawParams;
  /** Totalled over the whole filtered set by the page, not over this array. */
  shownEstimatedAgorot: number;
  shownActualAgorot: number;
  rowActions?: (row: AcquisitionRow) => ReactNode;
  /** E1: no table is left with nothing to show and nothing to say. */
  empty: ReactNode;
};

/** An empty cell reads as "nobody filled this in" and as "there is none" at
 *  the same time. The dash picks one. */
const DASH = '—';

export function AcquisitionsTable({
  rows, params, shownEstimatedAgorot, shownActualAgorot, rowActions, empty,
}: AcquisitionsTableProps): ReactElement {
  const columns: ReadonlyArray<TableColumn<AcquisitionRow>> = [
    {
      key: 'name',
      header: 'פריט',
      card: 'title',
      cell: (row) => (
        <span className={styles.name}>
          <Link href={acquisitionHref(params, row.id)} className="nm">{row.name}</Link>
          {/* R5: a row that is every season's says so, on the row itself, so a
              lead reading one year's list can tell which lines were written
              for it and which came along because they always apply. */}
          {row.seasonId === null ? <Pill tone="outline">{CAMP_WIDE_LABEL}</Pill> : null}
        </span>
      ),
    },
    {
      key: 'category',
      header: 'קטגוריה',
      card: 'meta',
      cell: (row) => CATEGORY_LABELS[row.category],
    },
    {
      key: 'quantity',
      header: 'כמות',
      card: 'figure',
      numeric: true,
      cell: (row) => row.quantityNeeded,
    },
    {
      key: 'source',
      header: 'דרך ההשגה',
      card: 'meta',
      cell: (row) => (
        row.source === 'borrow_member' && row.lender !== null
          /* Whose it is, not just how it is coming: at the end of the burn
             this is the line that says who to give it back to. */
          ? `${SOURCE_LABELS[row.source]} · ${row.lender.name}`
          : SOURCE_LABELS[row.source]
      ),
    },
    {
      key: 'estimate',
      header: 'אומדן',
      card: 'figure',
      numeric: true,
      // Null is "nobody has priced it", and a dash says that. A zero here
      // would claim the camp expects it to be free.
      cell: (row) => (row.estimatedAgorot === null ? DASH : <Money agorot={row.estimatedAgorot} />),
    },
    {
      key: 'actual',
      header: 'בפועל',
      card: 'figure',
      numeric: true,
      cell: (row) => (row.actualAgorot === null ? DASH : (
        <>
          <Money agorot={row.actualAgorot} />
          {/* R11. There is no purchase workbook, so every amount here was
              typed by somebody and says so. */}
          <span className={styles.cellSource}><SourceChip source={{ kind: 'manual' }} /></span>
        </>
      )),
    },
    {
      key: 'assignee',
      header: 'אחראי',
      card: 'meta',
      cell: (row) => (row.assignee === null ? DASH : (
        <span className={styles.person}>
          <Avatar name={row.assignee.name} size="sm" decorative />
          <Link href={`/members/${row.assignee.id}`} className="nm">{row.assignee.name}</Link>
        </span>
      )),
    },
    {
      key: 'status',
      header: 'סטטוס',
      card: 'meta',
      // R3: the word carries the state; the tone only decorates it.
      cell: (row) => (
        <Pill tone={STATUS_TONES[row.status]} dot>{STATUS_LABELS[row.status]}</Pill>
      ),
    },
  ];

  return (
    <Table
      caption="פריטים שהקאמפ צריך להשיג"
      columns={columns}
      rows={rows.map((row) => ({
        id: row.id,
        data: row,
        /* The one row state worth toning: it arrived and nobody said where it
           went, which is the open decision this screen exists to close. */
        tone: row.status === 'arrived' && row.arrivedItemId === null ? ('warn' as const) : undefined,
      }))}
      rowActions={rowActions}
      rowActionsHeader="פעולות"
      totals={[
        { key: 'label', content: 'סך הכול בתצוגה הזו' },
        { key: 'category', content: '' },
        { key: 'quantity', content: '' },
        { key: 'source', content: '' },
        { key: 'estimate', content: <Money agorot={shownEstimatedAgorot} />, numeric: true },
        {
          key: 'actual',
          content: (
            <>
              <Money agorot={shownActualAgorot} />
              <span className={styles.cellSource}>
                <SourceChip source={{ kind: 'manual' }} />
              </span>
            </>
          ),
          numeric: true,
        },
        { key: 'rest', content: '', colSpan: rowActions === undefined ? 2 : 3 },
      ]}
      totalsLabel="סיכום"
      empty={empty}
    />
  );
}
