import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import {
  listLedgerRows, applyLedgerView, ledgerStrip, groupByMonth, runningBalanceFor,
} from '@/lib/money/ledger-view';
import type {
  LedgerQuery, LedgerRow, LedgerScope, LedgerSort, LedgerView,
} from '@/lib/money/ledger-view';
import { Money, DateText } from '@/components/format';
import { Table } from '@/components/ui/table';
import type { TableColumn, TableRowModel, TableTotalsCell } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { SourceChip } from '@/components/ui/source-chip';
import { EmptyState } from '@/components/ui/empty-state';
import { chipSource } from '../chip-source';
import styles from './ledger.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'תנועות' };

export type LedgerSearchParams = {
  season?: string; account?: string; view?: string; q?: string;
  budget?: string; sort?: string;
};

/** The season param that means "every year at once". R5 keeps the season in
 *  one param; this is a value of that param, not a second control. A ledger
 *  is a continuous register and an account's balance is not season-scoped
 *  ("חשבונות אינם שייכים לשנה", already on `/money`), so there has to be a
 *  way to read one without a year filter across it — otherwise the running
 *  balance in Task 3 could never be true on this screen. */
export const ALL_SEASONS = 'all';

/** The six saved views, in the order the strip shows them. These *are* the
 *  saved views (C2 without an add affordance): a `+` a lead cannot save is a
 *  button that lies. */
export const VIEW_LABELS: Readonly<Record<LedgerView, string>> = {
  all: 'הכול',
  in: 'נכנס',
  out: 'יצא',
  'no-account': 'בלי חשבון',
  imported: 'מהקבצים',
  manual: 'נרשמו ידנית',
};

const VIEWS = Object.keys(VIEW_LABELS) as LedgerView[];

function parseView(value: string | undefined): LedgerView {
  return VIEWS.includes(value as LedgerView) ? (value as LedgerView) : 'all';
}

function parseSort(value: string | undefined): LedgerSort {
  return value === 'date-asc' ? 'date-asc' : 'date-desc';
}

/** The empty cell of a direction, of a budget line, of a counterpart. Hidden
 *  from assistive technology: "em dash" is not information, and the cell that
 *  does carry a number says everything this one would. */
function Nothing(): ReactNode {
  return <span className={styles.none} aria-hidden="true">—</span>;
}

/**
 * תנועות (D7).
 *
 * Two empty states from C10 are deliberately absent, and this is the record
 * of why. `all-clear` does not belong on a register: an empty ledger is never
 * good news, and a celebration over one would be the app congratulating a
 * lead for having no record of the camp's money. `not-permitted` is served by
 * the admin guard's `notFound()` below rather than by a panel, so a
 * non-admin learns nothing about what exists here.
 */
export default async function LedgerPage(
  { searchParams }: { searchParams: Promise<LedgerSearchParams> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const seasons = await listSeasons(db);
  const params = await searchParams;

  if (seasons.length === 0) {
    return (
      <main className={styles.page}>
        <h1>תנועות</h1>
        <p className="muted">עדיין אין שנים. הריצו את הזריעה מדף הייבוא.</p>
      </main>
    );
  }

  const campWide = params.season === ALL_SEASONS;
  const season = campWide
    ? undefined
    : seasons.find((one) => one.id === params.season) ?? seasons[0];

  const scope: LedgerScope = {
    seasonId: season?.id,
    accountId: params.account,
  };
  const query: LedgerQuery = {
    view: parseView(params.view),
    text: params.q,
    budgetLineId: params.budget,
    sort: parseSort(params.sort),
  };

  const all = await listLedgerRows(db, scope);
  const rows = applyLedgerView(all, query);
  const strip = ledgerStrip(rows);
  const balance = await runningBalanceFor(db, rows, scope, query);
  const groups = groupByMonth(rows, query.sort);

  const balanceByRow = new Map<string, number>();
  if (balance.shown) {
    rows.forEach((one, index) => { balanceByRow.set(one.id, balance.balancesAgorot[index]); });
  }

  /**
   * What a lead would have to remove to see rows again — named, so C10's
   * `no-matches` can say which filter emptied the table instead of "a filter".
   * The most specific one wins, because that is the one most likely to be the
   * surprise.
   */
  const searching = query.text !== undefined && query.text.trim() !== '';
  const filterSummary = searching ? query.text!.trim()
    : query.budgetLineId !== undefined ? 'סעיף תקציב'
    : query.view !== 'all' ? VIEW_LABELS[query.view]
    : undefined;

  const columns: Array<TableColumn<LedgerRow>> = [
    {
      key: 'date',
      header: 'תאריך',
      cell: (one) => <DateText at={one.occurredOn} />,
    },
    {
      key: 'description',
      header: 'תיאור',
      cell: (one) => (
        <span className={styles.description}>
          <span>{one.description}</span>
          {one.isTransfer ? <Pill tone="info">העברה</Pill> : null}
        </span>
      ),
    },
    {
      key: 'counterpart',
      header: 'מ/אל',
      cell: (one) => {
        if (one.counterpartPersonId !== null && one.counterpartName !== null) {
          return (
            <Link className={styles.party} href={`/members/${one.counterpartPersonId}`}>
              <Avatar name={one.counterpartName} size="sm" />
              {one.counterpartName}
            </Link>
          );
        }
        if (one.counterpartName !== null) return one.counterpartName;
        // The absence is a fact, not a gap: a plain `ledger_entries` row has
        // no supplier column, and a name parsed out of the description would
        // be a guess. So it is said in words for a screen reader and drawn as
        // a dash for everyone else.
        return (
          <>
            <Nothing />
            <span className="sr-only">אין צד שני רשום</span>
          </>
        );
      },
    },
    {
      key: 'account',
      header: 'חשבון',
      cell: (one) => (one.accountName !== null
        ? one.accountName
        : <Pill tone="warn">לא צוין</Pill>),
    },
    {
      key: 'budget',
      header: 'סעיף תקציב',
      cell: (one) => one.budgetLineLabel ?? <Nothing />,
    },
    {
      key: 'source',
      header: 'מקור',
      cell: (one) => <SourceChip source={chipSource(one.source ?? undefined)} />,
    },
    {
      key: 'in',
      header: 'נכנס',
      numeric: true,
      cell: (one) => (one.direction === 'in'
        ? <Money agorot={one.amountAgorot} />
        : <Nothing />),
    },
    {
      key: 'out',
      header: 'יצא',
      numeric: true,
      cell: (one) => (one.direction === 'out'
        ? <Money agorot={one.amountAgorot} />
        : <Nothing />),
    },
  ];

  if (balance.shown) {
    columns.push({
      key: 'balance',
      header: 'יתרה',
      numeric: true,
      cell: (one) => {
        const at = balanceByRow.get(one.id);
        return at === undefined ? <Nothing /> : <Money agorot={at} />;
      },
    });
  }

  const tableRows: Array<TableRowModel<LedgerRow>> = groups.flatMap((group) => (
    group.rows.map((one) => ({
      id: one.id,
      data: one,
      group: `${group.label} · ${group.count} תנועות`,
      tone: one.accountId === null ? ('warn' as const) : undefined,
    }))
  ));

  const totals: TableTotalsCell[] = [
    { key: 'count', content: <bdi>{strip.count} תנועות</bdi>, colSpan: 6 },
    { key: 'in', content: <Money agorot={strip.inAgorot} />, numeric: true },
    { key: 'out', content: <Money agorot={strip.outAgorot} />, numeric: true },
  ];
  if (balance.shown) totals.push({ key: 'balance', content: <Nothing />, numeric: true });

  const clearHref = `/money/ledger?season=${params.season ?? seasons[0].id}`;

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>תנועות</h1>
        <p className={styles.lead}>
          כל שקל שנכנס ויצא, משורות הגיליון ומדמי הקאמפ גם יחד.
          {campWide ? ' כרגע מוצגות כל השנים.' : null}
        </p>
      </div>

      {balance.shown ? null : (
        <p className={styles.balanceNote}>{balance.reason}</p>
      )}

      <Table
        caption="תנועות"
        columns={columns}
        rows={tableRows}
        totals={tableRows.length === 0 ? undefined : totals}
        empty={filterSummary !== undefined ? (
          <EmptyState
            kind="no-matches"
            filterSummary={filterSummary}
            action={{ href: clearHref, label: 'ניקוי הסינון' }}
          />
        ) : seasons.length > 1 && season !== undefined ? (
          <EmptyState
            kind="nothing-this-season"
            noun="תנועות"
            seasonName={season.name}
            action={{ href: '/upload', label: 'לדף הייבוא' }}
          />
        ) : (
          <EmptyState
            kind="nothing-yet"
            noun="תנועות"
            action={{ href: '/upload', label: 'לדף הייבוא' }}
          />
        )}
      />
    </main>
  );
}
