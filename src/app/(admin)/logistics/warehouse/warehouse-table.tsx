import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { Table, type TableColumn } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { SourceChip } from '@/components/ui/source-chip';
import type { WarehouseRow } from '@/lib/logistics/warehouse';
import { CATEGORY_LABELS, CONDITION_LABELS, CONDITION_TONES } from '@/lib/logistics/labels';
import { itemHref, type RawParams } from '@/lib/logistics/warehouse-views';

/**
 * No `'use client'`. This component calls no hook and owns no state — the
 * drawer it links to is a URL (R6), and sorting is a server concern, so the
 * whole table renders on the server like the rest of the page.
 */

export type WarehouseTableProps = {
  rows: readonly WarehouseRow[];
  params: RawParams;
  /** Totalled over the filtered set by the page, not over this array's page. */
  shownQuantity: number;
  /**
   * What stands in for the body when there is nothing to list. It arrives
   * from the page because only the page knows *why* the list is empty —
   * nothing entered yet, or nothing matching a filter — and E1 exists so
   * that no table can be left with nothing to show and nothing to say.
   */
  empty: ReactNode;
};

/** An empty cell reads as "nobody filled this in" and as "there is none" at
 *  the same time. The dash picks one. */
const DASH = '—';

export function WarehouseTable(
  { rows, params, shownQuantity, empty }: WarehouseTableProps,
): ReactElement {
  const columns: ReadonlyArray<TableColumn<WarehouseRow>> = [
    {
      key: 'name',
      header: 'פריט',
      card: 'title',
      cell: (row) => (
        <Link href={itemHref(params, row.id)} className="nm">{row.name}</Link>
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
      cell: (row) => row.quantity,
    },
    {
      key: 'location',
      header: 'מיקום במחסן',
      card: 'meta',
      cell: (row) => row.locationText || DASH,
    },
    {
      key: 'condition',
      header: 'מצב',
      card: 'meta',
      // R3: the word carries the meaning; the tone only decorates it, so a
      // reader who cannot tell the colours apart loses nothing.
      cell: (row) => (
        <Pill tone={CONDITION_TONES[row.condition]} dot>
          {CONDITION_LABELS[row.condition]}
        </Pill>
      ),
    },
    {
      key: 'source',
      header: 'מקור הנתון',
      card: 'meta',
      // R11: every number says where it came from. Logistics has no source
      // workbook at all, so every row says so rather than staying silent and
      // letting a reader assume the count was imported from something.
      cell: () => <SourceChip source={{ kind: 'manual' }} />,
    },
  ];

  return (
    <Table
      caption="ציוד הקאמפ במחסן"
      columns={columns}
      rows={rows.map((row) => ({ id: row.id, data: row }))}
      totals={[
        { key: 'label', content: 'סך הכול בתצוגה הזו' },
        { key: 'category', content: '' },
        { key: 'quantity', content: shownQuantity, numeric: true },
        { key: 'rest', content: '', colSpan: 3 },
      ]}
      totalsLabel="סיכום"
      empty={empty}
    />
  );
}
