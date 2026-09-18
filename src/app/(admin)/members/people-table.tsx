'use client';

/**
 * A client component for exactly one reason: the selection checkboxes.
 *
 * Every other control on this screen — the saved views, the search box, the
 * filter chips, the sort chip, the peek drawer — is a link or a GET form that
 * changes the URL, because R6 says a state a lead might want to send to
 * someone else belongs in the URL. A selection is not that: it is two seconds
 * old, it dies on navigation, and putting six ids in the address bar would
 * make the merge link unreadable.
 */

import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { Table, type TableColumn } from '@/components/ui/table';
import { Avatar } from '@/components/ui/avatar';
import { Pill, type PillTone } from '@/components/ui/pill';
import { Icon } from '@/components/ui/icon';
import { Money, DateText } from '@/components/format';
import { formatShekels } from '@/lib/money';
import { roleLabel } from '@/lib/members/labels';
import type { DuesState, PersonListRow } from '@/lib/members/people-list';
import { peekHref, type RawParams } from '@/lib/members/people-views';
import { PeopleBulkBar } from './people-bulk-bar';
import styles from './people.module.css';

/**
 * Ungendered, every one of them. The mock writes `טרם שילמה` / `שילמה חלקית` /
 * `פטורה`; the schema records no gender and the roster is mixed, so those
 * forms cannot be produced from the data at all. These are passive and say the
 * same thing about the due rather than about the person.
 */
export const DUES_STATE_LABELS: Record<DuesState, string> = {
  paid: 'שולם',
  offset: 'שולם בקיזוז',
  partial: 'שולם חלקית',
  unpaid: 'טרם שולם',
  exempt: 'פטור',
  none: 'אין חיוב',
};

const DUES_STATE_TONE: Record<DuesState, PillTone> = {
  paid: 'ok',
  offset: 'info',
  partial: 'warn',
  unpaid: 'bad',
  exempt: 'neutral',
  none: 'neutral',
};

export interface PeopleTableProps {
  rows: PersonListRow[];
  /** Every year the camp has, so a chip row is the same width on every line. */
  seasonYears: number[];
  /** The list's current URL params — every drawer href is built from these. */
  params: RawParams;
  seasonId: string | null;
  /** The scope season's own name, so the bar can say שיוך לברן 26. */
  seasonName: string | null;
  /** The name of the view being totalled, so the footer says what it counted. */
  viewLabel: string;
  /** C10's `EmptyState`, chosen by the page from the data rather than here. */
  empty: ReactNode;
}

/**
 * Summed from the rows this table was handed — which are the filtered ones —
 * so the footer can never disagree with the rows above it. The alternative,
 * an independently derived season total, drifts the moment a filter is on.
 */
function totalsFor(rows: PersonListRow[], viewLabel: string) {
  const bucket = { settled: 0, partial: 0, unpaid: 0, none: 0, exempt: 0 };
  let balance = 0;
  let tasks = 0;
  for (const row of rows) {
    balance += row.outstandingAgorot;
    tasks += row.taskCount;
    switch (row.dues?.state ?? 'none') {
      case 'paid': case 'offset': bucket.settled += 1; break;
      case 'partial': bucket.partial += 1; break;
      case 'unpaid': bucket.unpaid += 1; break;
      case 'exempt': bucket.exempt += 1; break;
      default: bucket.none += 1;
    }
  }
  /* פטור is appended rather than folded into שילמו: nothing was collected, and
     a breakdown that said otherwise would overstate what the קופה holds. */
  const breakdown = `שילמו ${bucket.settled} · חלקית ${bucket.partial}`
    + ` · טרם ${bucket.unpaid} · בלי חיוב ${bucket.none}`
    + (bucket.exempt > 0 ? ` · פטור ${bucket.exempt}` : '');

  return [
    { key: 'label', colSpan: 4, content: <bdi>{`סה״כ ${rows.length} ב${viewLabel}`}</bdi> },
    { key: 'states', content: <span className={styles.totalsBreakdown}><bdi>{breakdown}</bdi></span> },
    { key: 'balance', numeric: true, content: balance === 0 ? '—' : <Money agorot={balance} /> },
    { key: 'tasks', numeric: true, content: tasks === 0 ? '—' : <bdi>{tasks}</bdi> },
    { key: 'rest', colSpan: 2, content: '' },
  ];
}

function SeasonChips({ years, own }: { years: number[]; own: number[] }): ReactElement {
  const label = own.length === 0
    ? 'לא שויך/ה לאף שנה'
    : `שנים: ${own.join(', ')}`;
  return (
    <span className={styles.seasons} role="img" aria-label={label}>
      {years.map((year) => (
        <span key={year} data-on={own.includes(year) ? 'true' : 'false'}>
          {String(year).slice(-2)}
        </span>
      ))}
    </span>
  );
}

function DuesCell({ row }: { row: PersonListRow }): ReactElement {
  const state: DuesState = row.dues?.state ?? 'none';
  const partial = row.dues !== null && state === 'partial';
  return (
    <span className={styles.duesCell}>
      <Pill tone={DUES_STATE_TONE[state]} dot>{DUES_STATE_LABELS[state]}</Pill>
      {partial && row.dues !== null ? (
        /*
         * R3: never colour alone. A part payment is the one state whose degree
         * matters, so the word carries a meter beside it and the meter carries
         * both amounts in its own name — a sighted reader sees the fill, a
         * screen-reader user hears `שולם 500 ₪ מתוך 1,200 ₪`.
         */
        <span
          className={styles.meter}
          role="meter"
          aria-valuenow={row.dues.paidAgorot}
          aria-valuemin={0}
          aria-valuemax={row.dues.amountAgorot}
          aria-label={`שולם ${formatShekels(row.dues.paidAgorot)} מתוך ${formatShekels(row.dues.amountAgorot)}`}
        >
          <i style={{ inlineSize: `${Math.round((row.dues.paidAgorot / row.dues.amountAgorot) * 100)}%` }} />
        </span>
      ) : null}
      {row.dues !== null && row.dues.kind === 'exception' && row.dues.amountAgorot > 0 ? (
        /* One `<bdi>` for the whole phrase, per A17 — `getByText` reads only
           direct text children, and a lead reads `חריג · 600 ₪` as one thing. */
        <Pill tone="brand">{`חריג · ${formatShekels(row.dues.amountAgorot)}`}</Pill>
      ) : null}
    </span>
  );
}

export function PeopleTable({
  rows, seasonYears, params, seasonId, seasonName, viewLabel, empty,
}: PeopleTableProps): ReactElement {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const byId = useMemo(
    () => new Map(rows.map((row) => [row.personId, row])),
    [rows],
  );

  /** Sorted, so two leads selecting the same pair get the same merge URL. */
  const selectedIds = useMemo(() => [...selected].sort(), [selected]);

  const columns: ReadonlyArray<TableColumn<PersonListRow>> = [
    {
      key: 'name',
      card: 'title',
      header: 'שם',
      cell: (row) => (
        <span className={styles.namecell}>
          <Avatar name={row.displayName} size="sm" />
          <span className={styles.nameText}>
            <Link className={styles.nm} href={`/members/${row.personId}`}>
              {row.displayName}
            </Link>
            {row.aliases.length > 0 ? (
              <span className={styles.al}>{`גם: ${row.aliases.join(' · ')}`}</span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      card: 'meta',
      header: 'תפקיד',
      cell: (row) => (row.role === null
        ? <span className="muted">—</span>
        : <Pill tone={row.role === 'lead' ? 'brand' : 'neutral'}>{roleLabel(row.role)}</Pill>),
    },
    {
      key: 'seasons',
      card: 'meta',
      header: 'שנים',
      cell: (row) => (
        <SeasonChips years={seasonYears} own={row.seasons.map((s) => s.year)} />
      ),
    },
    { key: 'dues', card: 'meta', header: 'דמי קאמפ', cell: (row) => <DuesCell row={row} /> },
    {
      key: 'balance',
      card: 'figure',
      header: 'יתרה',
      numeric: true,
      /* A zero balance is `—`, not `0 ₪`: a column of zeroes reads as a column
         of debts you have to check, and there is nothing here to check. */
      cell: (row) => (row.outstandingAgorot === 0
        ? <span className="muted">—</span>
        : <Money agorot={row.outstandingAgorot} />),
    },
    {
      key: 'tasks',
      card: 'meta',
      header: 'משימות',
      numeric: true,
      cell: (row) => (row.taskCount === 0
        ? <span className="muted">—</span>
        : <bdi>{row.taskCount}</bdi>),
    },
    {
      key: 'activity',
      card: 'meta',
      header: 'פעילות אחרונה',
      cell: (row) => <DateText at={row.lastActivityAt} />,
    },
  ];

  return (
    <>
      <Table
        caption="אנשים"
        columns={columns}
        empty={empty}
        rows={rows.map((row) => ({ id: row.personId, data: row }))}
        selection={{
          selectedIds: selected,
          onToggleRow: (id) => {
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            });
          },
          onToggleAll: () => {
            setSelected((current) => (current.size === rows.length
              ? new Set()
              : new Set(rows.map((row) => row.personId))));
          },
          rowCheckboxLabel: (id) => `בחירת ${byId.get(id)?.displayName ?? ''}`,
          allCheckboxLabel: 'בחירת כל השורות',
        }}
        /* Omitted for an empty list: a row of zeroes under an empty state is
           noise, and the empty state is already saying the useful thing. */
        totals={rows.length === 0 ? undefined : totalsFor(rows, viewLabel)}
        rowActions={(row) => (
          <Link
            className={styles.rowact}
            href={peekHref(params, row.personId)}
            /* Named after the row, the way the kit already requires of
               `rowCheckboxLabel`: a screen reader tabbing a 38-row list would
               otherwise hear `תצוגה מהירה` thirty-eight times with nothing to
               tell the links apart. */
            aria-label={`תצוגה מהירה: ${row.displayName}`}
          >
            <Icon name="eye" size={15} />
          </Link>
        )}
      />

      <PeopleBulkBar
        selected={selectedIds}
        names={Object.fromEntries(rows.map((row) => [row.personId, row.displayName]))}
        seasonId={seasonId}
        seasonName={seasonName}
        params={params}
        onClear={() => { setSelected(new Set()); }}
      />
    </>
  );
}
