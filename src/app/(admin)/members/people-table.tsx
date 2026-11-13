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
import { roleLabel, DUES_STATE_LABELS } from '@/lib/members/labels';
import type { DuesState, PersonListRow } from '@/lib/members/people-list';
import { peekHref, type RawParams } from '@/lib/members/people-views';
import { PeopleBulkBar } from './people-bulk-bar';
import styles from './people.module.css';

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
function totalsFor(rows: PersonListRow[], viewLabel: string, seasonId: string | null) {
  const bucket = { settled: 0, partial: 0, unpaid: 0, none: 0, exempt: 0 };
  let balance = 0;
  let other = 0;
  let tasks = 0;
  for (const row of rows) {
    balance += seasonId === null ? row.outstandingAgorot : row.scopeOutstandingAgorot;
    other += seasonId === null ? 0 : row.otherSeasonsOutstandingAgorot;
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
    {
      key: 'balance',
      numeric: true,
      content: <BalanceFigure agorot={balance} otherAgorot={other} />,
    },
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

/**
 * The balance as one figure, and the part of it that is not this season's
 * as a second, quieter line. A lead who set the rate to 2,000 ₪ and reads
 * 3,500 ₪ beside a name is owed the sentence "and 1,500 ₪ from earlier
 * years" — the alternative is a column that disagrees with the rate for a
 * reason only the database knows.
 *
 * Zero is `—`, not `0 ₪`: a column of zeroes reads as a column of debts you
 * have to check, and there is nothing here to check.
 */
function BalanceFigure(
  { agorot, otherAgorot, href }: { agorot: number; otherAgorot: number; href?: string },
): ReactElement {
  if (agorot === 0 && otherAgorot === 0) return <span className="muted">—</span>;
  const figure = agorot === 0 ? <span className="muted">—</span> : <Money agorot={agorot} />;
  return (
    <span className={styles.balanceCell}>
      {/* Every figure links to the page that can change it: the season's
          payment drawer, which is where this one shrinks. */}
      {href && agorot > 0 ? <Link href={href}>{figure}</Link> : figure}
      {otherAgorot > 0 ? (
        <span className={styles.balanceNote}>
          <bdi>{`+ ${formatShekels(otherAgorot)} משנים אחרות`}</bdi>
        </span>
      ) : null}
    </span>
  );
}

function DuesCell({ row, seasonId }: { row: PersonListRow; seasonId: string | null }): ReactElement {
  const state: DuesState = row.dues?.state ?? 'none';
  const partial = row.dues !== null && state === 'partial';
  /*
   * A flat due issued before the rate changed keeps its own amount — the
   * rate drawer says so and asks whether to rewrite them. Until a lead
   * answers, the two figures disagree, and this is where the disagreement
   * is shown instead of left for someone to discover from the balance: the
   * pill names the amount the due was issued on, and links to the drawer
   * that can bring it onto today's rate.
   */
  const staleRate = row.dues !== null
    && row.dues.kind === 'flat'
    && row.dues.amountAgorot !== row.dues.seasonRateAgorot;
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
      {staleRate && row.dues !== null ? (
        seasonId === null ? (
          <Pill tone="warn">{`הונפק על ${formatShekels(row.dues.amountAgorot)}`}</Pill>
        ) : (
          <Link
            href={`/fees?season=${seasonId}&act=rate`}
            title={`החיוב הונפק על ${formatShekels(row.dues.amountAgorot)} והתעריף היום ${formatShekels(row.dues.seasonRateAgorot)}. שינוי התעריף יכול לעדכן אותו.`}
          >
            <Pill tone="warn">{`הונפק על ${formatShekels(row.dues.amountAgorot)}`}</Pill>
          </Link>
        )
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
    {
      key: 'dues',
      card: 'meta',
      /* The column is the scope season's due and nobody else's, so the header
         says which season — the mock draws `דמי קאמפ · ברן 26`, and a lead
         reading `טרם שולם` beside a name should not have to remember which
         year's bill that is. */
      header: seasonName === null ? 'דמי קאמפ' : `דמי קאמפ · ${seasonName}`,
      cell: (row) => <DuesCell row={row} seasonId={seasonId} />,
    },
    {
      key: 'balance',
      card: 'figure',
      header: 'יתרה',
      numeric: true,
      /* Under a season the figure is that season's share, with the rest as
         a second line; with no season in scope it is the whole balance. */
      cell: (row) => (seasonId === null
        ? <BalanceFigure agorot={row.outstandingAgorot} otherAgorot={0} />
        : (
          <BalanceFigure
            agorot={row.scopeOutstandingAgorot}
            otherAgorot={row.otherSeasonsOutstandingAgorot}
            href={`/fees?season=${seasonId}&peek=${row.personId}&act=pay`}
          />
        )),
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
        totals={rows.length === 0 ? undefined : totalsFor(rows, viewLabel, seasonId)}
        totalsLabel="סיכום"
        rowActionsHeader="פעולות"
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
