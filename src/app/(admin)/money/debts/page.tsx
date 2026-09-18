import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { listDebts, applyDebtView, debtTotals } from '@/lib/money/debts-view';
import type { DebtRow, DebtView } from '@/lib/money/debts-view';
import { formatILS } from '@/lib/money';
import { Money, DateText } from '@/components/format';
import { Table } from '@/components/ui/table';
import type { TableColumn, TableRowModel, TableTotalsCell } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { SourceChip } from '@/components/ui/source-chip';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { Banner } from '@/components/ui/banner';
import { Meter } from '@/components/charts/meter';
import { chipSource } from '../chip-source';
import styles from './debts.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'חובות' };

export type DebtsSearchParams = { season?: string; view?: string; settle?: string };

const VIEW_LABELS: Readonly<Record<DebtView, string>> = {
  camp_owes: 'אנחנו חייבים',
  owed_to_camp: 'חייבים לנו',
  settled: 'נסגרו',
};

const VIEWS = Object.keys(VIEW_LABELS) as DebtView[];

/**
 * `settleObligation`'s own sentence, not a paraphrase of it. The button is
 * disabled *because* the library would refuse, so the screen says what the
 * library says — a lead who clicks through to the drawer on another row and
 * meets this sentence there has met it here first.
 */
const NAMELESS_REFUSAL = 'אי אפשר לסגור חוב בלי שם — לא ידוע למי מגיע הכסף';

/** Verbatim from the promoter's note for a debt whose workbook row carried no
 *  date, so the register and this screen say the same thing about it. */
const DATELESS_NOTE = 'בגיליון אין תאריך לחוב הזה';

function parseView(value: string | undefined): DebtView {
  return VIEWS.includes(value as DebtView) ? (value as DebtView) : 'camp_owes';
}

function debtsHref(
  current: DebtsSearchParams, over: Partial<DebtsSearchParams> = {},
): string {
  const next = { ...current, ...over };
  const search = new URLSearchParams();
  if (next.season) search.set('season', next.season);
  if (next.view && next.view !== 'camp_owes') search.set('view', next.view);
  if (next.settle) search.set('settle', next.settle);
  const query = search.toString();
  return query === '' ? '/money/debts' : `/money/debts?${query}`;
}

function Nothing(): ReactNode {
  return <span className={styles.none} aria-hidden="true">—</span>;
}

/**
 * חובות (D8).
 *
 * **There is no dismiss control anywhere in this file, and that is the
 * point.** An obligation with no party can never be settled and can never be
 * dismissed: marking `שולם 500 — מקפיא באיחסון נוסף` as handled would close
 * the only record that anyone is owed anything, which is exactly how the link
 * was lost the first time. The screen's job is to keep showing it.
 */
export default async function DebtsPage(
  { searchParams }: { searchParams: Promise<DebtsSearchParams> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const seasons = await listSeasons(db);
  const params = await searchParams;

  if (seasons.length === 0) {
    return (
      <main className={styles.page}>
        <h1>חובות</h1>
        <p className="muted">עדיין אין שנים. הריצו את הזריעה מדף הייבוא.</p>
      </main>
    );
  }

  const season = seasons.find((one) => one.id === params.season) ?? seasons[0];
  const view = parseView(params.view);

  const rows = await listDebts(db, { seasonId: season.id });
  const totals = debtTotals(rows);
  const shown = applyDebtView(rows, view);
  const nameless = rows.filter((row) => row.unnamed && !row.settled);

  const columns: Array<TableColumn<DebtRow>> = [
    {
      key: 'party',
      header: 'למי',
      cell: (row) => {
        if (row.unnamed) return <Pill tone="bad">חסר שם</Pill>;
        if (row.partyPersonId !== null && row.displayParty !== null) {
          return (
            <Link className={styles.party} href={`/members/${row.partyPersonId}`}>
              <Avatar name={row.displayParty} size="sm" />
              {row.displayParty}
            </Link>
          );
        }
        return row.displayParty;
      },
    },
    { key: 'what', header: 'על מה', cell: (row) => row.description },
    {
      key: 'when',
      header: 'מתי',
      cell: (row) => (row.openedOn === null
        ? <span className={styles.dateless}>{DATELESS_NOTE}</span>
        : <DateText at={row.openedOn} />),
    },
    {
      key: 'amount',
      header: 'סכום',
      numeric: true,
      cell: (row) => <Money agorot={row.amountAgorot} />,
    },
    {
      key: 'settled',
      header: 'קוזז עד כה',
      cell: (row) => (row.settledAgorot === 0 ? <Nothing /> : (
        <span className={styles.progress}>
          <Meter
            label={`נסגר מתוך ${row.description}`}
            valueAgorot={row.settledAgorot}
            totalAgorot={row.amountAgorot}
          />
          {/* A17: one isolate around the whole phrase. Two — one per number —
            * would split the text across elements and make the phrase
            * unqueryable, and unreadable as one sentence. */}
          <bdi className={styles.progressText}>
            {`${formatILS(row.settledAgorot)} מתוך ${formatILS(row.amountAgorot)}`}
          </bdi>
        </span>
      )),
    },
    {
      key: 'outstanding',
      header: 'נותר',
      numeric: true,
      cell: (row) => <Money agorot={row.outstandingAgorot} />,
    },
    {
      key: 'source',
      header: 'מקור',
      cell: (row) => <SourceChip source={chipSource(row.source ?? undefined)} />,
    },
  ];

  function directionTable(which: DebtView) {
    const forView = applyDebtView(rows, which);
    const subtotal = which === 'camp_owes' ? totals.campOwesAgorot : totals.owedToCampAgorot;
    const tableRows: Array<TableRowModel<DebtRow>> = forView.map((row) => ({
      id: row.id,
      data: row,
      tone: row.unnamed ? ('bad' as const) : undefined,
    }));
    // This direction's own subtotal, and only this one. The two directions
    // are never added together and never subtracted from one another.
    const totalsRow: TableTotalsCell[] | undefined = tableRows.length === 0 ? undefined : [
      { key: 'label', content: <bdi>{forView.length} חובות</bdi>, colSpan: 5 },
      { key: 'sum', content: <Money agorot={subtotal} />, numeric: true },
      { key: 'pad', content: null },
    ];

    return (
      <section className={styles.direction} role="group" aria-label={VIEW_LABELS[which]}>
        <div className={styles.directionHead}>
          <h2 className={styles.directionTitle}>{VIEW_LABELS[which]}</h2>
          <span className={styles.directionSum}><Money agorot={subtotal} /></span>
        </div>
        <Table
          caption={VIEW_LABELS[which]}
          columns={columns}
          rows={tableRows}
          totals={totalsRow}
          rowActions={(row) => <SettleControl row={row} params={params} />}
          empty={(
            <EmptyState
              kind="nothing-this-season"
              noun={which === 'camp_owes' ? 'חובות שהקאמפ חייב' : 'חובות שחייבים לקאמפ'}
              seasonName={season.name}
              action={{ href: '/upload', label: 'לדף הייבוא' }}
            />
          )}
        />
      </section>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>חובות</h1>
        <p className={styles.lead}>
          מה הקאמפ חייב, ומה חייבים לו. חוב נסגר במזומן או בקיזוז מול דמי קאמפ.
        </p>
      </div>

      <ul className={styles.tiles} aria-label="סיכום החובות">
        <li>
          <StatTile
            label="אנחנו חייבים"
            valueAgorot={totals.campOwesAgorot}
            derivation={<bdi>{totals.campOwesCount} חובות פתוחים</bdi>}
          />
        </li>
        <li>
          <StatTile
            label="חייבים לנו"
            valueAgorot={totals.owedToCampAgorot}
            derivation={<bdi>{totals.owedToCampCount} חובות פתוחים</bdi>}
          />
        </li>
        <li>
          <StatTile
            label="נסגר בקיזוז"
            valueAgorot={totals.offsetAgorot}
            derivation="לא עברו דרך אף קופה"
          />
        </li>
      </ul>

      {nameless.length === 0 ? null : (
        <Banner
          tone="warn"
          live
          headline={<bdi>{`${nameless.length} חובות בלי שם — ${formatILS(totals.unnamedAgorot)} ₪.`}</bdi>}
          detail={(
            <>
              אי אפשר לסגור אותם עד שיירשם למי מגיע הכסף.{' '}
              {/* R5: camp-wide data says so on screen. A nameless obligation
                * carries no season, so it is here whatever year is selected —
                * and a lead who does not know that would read it as this
                * season's problem. */}
              חובות בלי שם מוצגים בכל השנים — הם שייכים לקאמפ, לא לשנה מסוימת.
            </>
          )}
        />
      )}

      <nav className={styles.views} aria-label="תצוגות החובות">
        {VIEWS.map((one) => (
          <Link
            key={one}
            className={styles.viewLink}
            href={debtsHref(params, { view: one })}
            aria-pressed={one === view}
          >
            {VIEW_LABELS[one]}
            <span className={styles.viewCount}>
              <bdi>
                {one === 'camp_owes' ? totals.campOwesCount
                  : one === 'owed_to_camp' ? totals.owedToCampCount
                  : totals.settledCount}
              </bdi>
            </span>
          </Link>
        ))}
      </nav>

      {view === 'settled' ? (
        <section className={styles.direction} role="group" aria-label={VIEW_LABELS.settled}>
          <div className={styles.directionHead}>
            <h2 className={styles.directionTitle}>{VIEW_LABELS.settled}</h2>
          </div>
          <Table
            caption={VIEW_LABELS.settled}
            columns={columns}
            rows={shown.map((row) => ({ id: row.id, data: row }))}
            /* The one place C10's `all-clear` is honest on these two screens:
             * a debt that has been closed is genuinely finished business. */
            empty={<EmptyState kind="all-clear" />}
          />
        </section>
      ) : (
        <>
          {directionTable('camp_owes')}
          {directionTable('owed_to_camp')}
        </>
      )}
    </main>
  );
}

/**
 * Settle, or the reason it cannot be settled.
 *
 * A native `<button>` rather than the kit's `Button`: a disabled control has
 * to point at the sentence explaining itself, and `ButtonProps` accepts no
 * `aria-describedby`. Reported as a kit gap rather than patched, since the
 * kit is read-only to this plan.
 */
function SettleControl({ row, params }: { row: DebtRow; params: DebtsSearchParams }) {
  if (row.settled) return null;
  if (row.unnamed) {
    const describedBy = `settle-refusal-${row.id}`;
    return (
      <span className={styles.settle}>
        <button type="button" className={styles.settleButton} disabled aria-describedby={describedBy}>
          סגירה
        </button>
        <span className={styles.refusal} id={describedBy}>{NAMELESS_REFUSAL}</span>
      </span>
    );
  }
  return (
    <Link className={styles.settleButton} href={debtsHref(params, { settle: row.id })}>
      סגירה
    </Link>
  );
}
