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
import { Drawer } from '@/components/ui/drawer';
import { openPeekHref, closePeekHref } from '@/components/ui/drawer-url';
import { Meter } from '@/components/charts/meter';
import { listAccounts } from '@/lib/money/accounts';
import { listPersonChoices } from '@/lib/members/dossier';
import { chipSource } from '../chip-source';
import { SettleForm } from './settle-form';
import { NameForm } from './name-form';
import styles from './debts.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'חובות' };

/**
 * A3, which overrides this plan's `?settle=<id>`: an action drawer is
 * `?peek=<id>&act=<verb>`, and `settle` is one of its six verbs. Both params
 * are read and written only through the kit's `drawer-url.ts`, so `esc`, the
 * close control and the browser's back button cannot disagree about which
 * params survive — `season` above all (R5).
 */
export type DebtsSearchParams = {
  season?: string; view?: string; peek?: string; act?: string;
};

const PATH = '/money/debts';

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

/** The inbox action's label, verbatim, so the row and the inbox say the same
 *  thing. Spelled here rather than imported from `name-form.tsx`: a string
 *  exported from a `'use client'` module reaches a Server Component as a
 *  client reference, not as text. */
const NAME_ACTION_LABEL = 'רישום למי החוב';

/** Verbatim from the promoter's note for a debt whose workbook row carried no
 *  date, so the register and this screen say the same thing about it. */
const DATELESS_NOTE = 'בגיליון אין תאריך לחוב הזה';

function parseView(value: string | undefined): DebtView {
  return VIEWS.includes(value as DebtView) ? (value as DebtView) : 'camp_owes';
}

/** Every param this screen owns, as the kit's builders want them. */
function asParams(current: DebtsSearchParams): URLSearchParams {
  const search = new URLSearchParams();
  if (current.season) search.set('season', current.season);
  if (current.view && current.view !== 'camp_owes') search.set('view', current.view);
  if (current.peek) search.set('peek', current.peek);
  if (current.act) search.set('act', current.act);
  return search;
}

/**
 * A view link closes any open drawer, and it does so through
 * `closePeekHref` rather than by leaving `peek` and `act` out by hand: A19's
 * point is that one function decides which params a drawer owns, and a
 * second correct copy is how that erodes.
 */
function viewHref(current: DebtsSearchParams, view: DebtView): string {
  const next = asParams(current);
  if (view === 'camp_owes') next.delete('view');
  else next.set('view', view);
  return closePeekHref(PATH, next);
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

  const [rows, accounts, people] = await Promise.all([
    listDebts(db, { seasonId: season.id }),
    listAccounts(db),
    listPersonChoices(db),
  ]);
  const totals = debtTotals(rows);
  const shown = applyDebtView(rows, view);
  const nameless = rows.filter((row) => row.unnamed && !row.settled);

  /* An id that names no row on this page opens no drawer and throws nothing:
   * a stale link, or a debt that has since been settled in another tab, is
   * not an error a lead should be shown a crash for.
   *
   * The drawer opens on the record, whatever verb came with it: `settle`
   * from this page's rows, `name` from the inbox, and none at all from the
   * `/money` overview, whose description links are `?peek=<id>` alone. What
   * the drawer offers is decided by the debt — a named one can be settled,
   * a nameless one can be named — not by which link the lead came through,
   * because the verb in the URL cannot know more than the row does. */
  const peeked = params.peek !== undefined
    ? rows.find((row) => row.id === params.peek)
    : undefined;

  const columns: Array<TableColumn<DebtRow>> = [
    {
      key: 'party',
      card: 'title',
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
    { key: 'what', card: 'meta', header: 'על מה', cell: (row) => row.description },
    {
      key: 'when',
      card: 'meta',
      header: 'מתי',
      cell: (row) => (row.openedOn === null
        ? <span className={styles.dateless}>{DATELESS_NOTE}</span>
        : <DateText at={row.openedOn} />),
    },
    {
      key: 'amount',
      card: 'meta',
      header: 'סכום',
      numeric: true,
      cell: (row) => <Money agorot={row.amountAgorot} />,
    },
    {
      key: 'settled',
      card: 'meta',
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
      card: 'figure',
      header: 'נותר',
      numeric: true,
      cell: (row) => <Money agorot={row.outstandingAgorot} />,
    },
    {
      key: 'source',
      card: 'meta',
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
            href={viewHref(params, one)}
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

      {peeked === undefined ? null : (
        <Drawer
          title={peeked.unnamed ? 'חוב בלי שם' : `סגירת חוב — ${peeked.displayParty}`}
          subtitle={peeked.description}
          closeHref={closePeekHref(PATH, asParams(params))}
        >
          {/* The description is the drawer's subtitle and is not repeated
            * here: a fact printed twice in one panel reads as two facts. */}
          <dl className={styles.drawerFacts}>
            <dt>מתי נפתח</dt>
            <dd>
              {peeked.openedOn === null
                ? <span className={styles.dateless}>{DATELESS_NOTE}</span>
                : <DateText at={peeked.openedOn} />}
            </dd>
            <dt>נותר</dt>
            <dd><Money agorot={peeked.outstandingAgorot} /></dd>
            <dt>מקור</dt>
            <dd><SourceChip source={chipSource(peeked.source ?? undefined)} /></dd>
          </dl>

          {peeked.settledAgorot === 0 ? null : (
            <p className={styles.progress}>
              <Meter
                label={`נסגר מתוך ${peeked.description}`}
                valueAgorot={peeked.settledAgorot}
                totalAgorot={peeked.amountAgorot}
              />
              <bdi className={styles.progressText}>
                {`${formatILS(peeked.settledAgorot)} מתוך ${formatILS(peeked.amountAgorot)}`}
              </bdi>
            </p>
          )}

          {peeked.unnamed || peeked.displayParty === null ? (
            /* No settle form at all, not a disabled one. `settleObligation`
             * would refuse this and the drawer says so in its own words —
             * and then offers the one thing that can change it. */
            <>
              <p className={styles.refusal}>{NAMELESS_REFUSAL}</p>
              <NameForm
                obligationId={peeked.id}
                people={people}
                closeHref={closePeekHref(PATH, asParams(params))}
              />
            </>
          ) : (
            <SettleForm
              obligationId={peeked.id}
              direction={peeked.direction}
              displayParty={peeked.displayParty}
              outstandingAgorot={peeked.outstandingAgorot}
              accounts={accounts.map((one) => ({ id: one.id, name: one.name }))}
              closeHref={closePeekHref(PATH, asParams(params))}
            />
          )}
        </Drawer>
      )}

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
 * Settle, or the reason it cannot be settled — and, for a nameless debt, the
 * way out: the only thing that can make it settleable is recording whose it
 * is, so that link stands beside the dead control rather than three screens
 * away in the inbox.
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
        <Link className={styles.settleButton} href={openPeekHref(PATH, asParams(params), row.id, 'name')}>
          {NAME_ACTION_LABEL}
        </Link>
        <button type="button" className={styles.settleButton} disabled aria-describedby={describedBy}>
          סגירה
        </button>
        <span className={styles.refusal} id={describedBy}>{NAMELESS_REFUSAL}</span>
      </span>
    );
  }
  return (
    <Link className={styles.settleButton} href={openPeekHref(PATH, asParams(params), row.id, 'settle')}>
      סגירה
    </Link>
  );
}
