import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons } from '@/lib/members/roster';
import { listParties } from '@/lib/money/parties';
import type { PartySummary } from '@/lib/money/parties';
import { Money, DateText } from '@/components/format';
import { Table } from '@/components/ui/table';
import type { TableColumn, TableRowModel, TableTotalsCell } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { EmptyState } from '@/components/ui/empty-state';
import { Drawer } from '@/components/ui/drawer';
import { openActHref, closePeekHref } from '@/components/ui/drawer-url';
import { SavedViews } from '@/components/ui/saved-views';
import { StatTile } from '@/components/ui/stat-tile';
import { PartyForm } from './party-form';
import styles from './events.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'מסיבות' };

type EventsSearchParams = { season?: string; sort?: string; act?: string };

const PATH = '/money/events';

type PartySort = 'date' | 'net';

const SORT_LABELS: Readonly<Record<PartySort, string>> = {
  date: 'לפי תאריך',
  net: 'לפי מה שנשאר לקאמפ',
};

function asParams(current: EventsSearchParams): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  return search;
}

function eventsHref(current: EventsSearchParams, sort: PartySort): string {
  const search = new URLSearchParams();
  if (current.season) search.set('season', current.season);
  if (sort !== 'date') search.set('sort', sort);
  const query = search.toString();
  return query === '' ? PATH : `${PATH}?${query}`;
}

function Nothing(): ReactNode {
  return <span className={styles.none} aria-hidden="true">—</span>;
}

/** A signed figure, coloured by its sign and never only by it: the minus is
 *  in the digits (`formatShekels` welds it on). */
function Net({ agorot }: { agorot: number }): ReactNode {
  const tone = agorot > 0 ? styles.gain : agorot < 0 ? styles.loss : undefined;
  return <span className={tone}><Money agorot={agorot} /></span>;
}

/** Money that passed between the camp and its partner, from the camp's side:
 *  positive when the partner paid us on balance. */
function partnerNet(party: PartySummary): number {
  return party.partnerInAgorot - party.partnerOutAgorot;
}

/**
 * מסיבות — the history of every party the camp made, and what each one left
 * in the camp's hands. Parties are where the camp's money comes from, so this
 * is the page that answers "was it worth it" a year later.
 *
 * Not season-scoped, on purpose: the question is asked across years. The
 * season param is still carried, so the shell's switcher keeps its place and
 * a new party defaults to the year being looked at.
 */
export default async function EventsPage(
  { searchParams }: { searchParams: Promise<EventsSearchParams> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const params = await searchParams;
  const seasons = await listSeasons(db);

  if (seasons.length === 0) {
    return (
      <main className={styles.page}>
        <h1>מסיבות</h1>
        <p className="muted">עדיין אין שנים. הריצו את הזריעה מדף הייבוא.</p>
      </main>
    );
  }

  const season = seasons.find((one) => one.id === params.season) ?? seasons[0];
  const sort: PartySort = params.sort === 'net' ? 'net' : 'date';
  const creating = params.act === 'party';

  const all = await listParties(db);
  const parties = sort === 'net'
    ? [...all].sort((a, b) => b.netAgorot - a.netAgorot)
    : all;

  const sum = (pick: (party: PartySummary) => number) =>
    all.reduce((total, party) => total + pick(party), 0);
  const incomeAgorot = sum((p) => p.ticketsAgorot + p.barAgorot);
  const costAgorot = sum((p) => p.costAgorot);
  const netAgorot = sum((p) => p.netAgorot);
  const anyShared = all.some((party) => party.partnerName !== null);

  const newHref = openActHref(PATH, asParams(params), 'party');

  const columns: Array<TableColumn<PartySummary>> = [
    {
      key: 'name',
      card: 'title',
      header: 'מסיבה',
      cell: (party) => (
        <span className={styles.name}>
          <Link className={styles.nameLink} href={`${PATH}/${party.id}`}>{party.name}</Link>
          {party.partnerName === null ? null : (
            <span className={styles.partner}>עם <bdi>{party.partnerName}</bdi></span>
          )}
          {party.count === 0 ? <Pill tone="outline">עוד לא נרשם כסף</Pill> : null}
          {party.unsortedInAgorot + party.unsortedOutAgorot > 0
            ? <Pill tone="warn">יש תנועות לא מסווגות</Pill>
            : null}
        </span>
      ),
    },
    {
      key: 'date',
      card: 'meta',
      header: 'תאריך',
      cell: (party) => (party.heldOn === null
        ? <Pill tone="warn">אין תאריך</Pill>
        : <DateText at={party.heldOn} />),
    },
    {
      key: 'tickets',
      card: 'figure',
      header: 'כרטיסים',
      numeric: true,
      cell: (party) => (party.ticketsAgorot === 0 ? <Nothing /> : <Money agorot={party.ticketsAgorot} />),
    },
    {
      key: 'bar',
      card: 'figure',
      header: 'בר',
      numeric: true,
      cell: (party) => (party.barAgorot === 0 ? <Nothing /> : <Money agorot={party.barAgorot} />),
    },
    {
      key: 'cost',
      card: 'figure',
      header: 'הוצאות',
      numeric: true,
      cell: (party) => (party.costAgorot === 0 ? <Nothing /> : <Money agorot={party.costAgorot} />),
    },
  ];
  if (anyShared) {
    columns.push({
      key: 'partner',
      card: 'figure',
      header: 'מול השותף',
      numeric: true,
      cell: (party) => (party.partnerName === null || partnerNet(party) === 0
        ? <Nothing />
        : <Money agorot={partnerNet(party)} />),
    });
  }
  columns.push({
    key: 'net',
    card: 'figure',
    header: 'נשאר לקאמפ',
    numeric: true,
    cell: (party) => (party.count === 0 ? <Nothing /> : <Net agorot={party.netAgorot} />),
  });

  const rows: Array<TableRowModel<PartySummary>> = parties.map((party) => ({
    id: party.id,
    data: party,
    // Ranked by result, a year heading between rows would split the ranking.
    group: sort === 'date' ? party.seasonName : undefined,
  }));

  const totals: TableTotalsCell[] = [
    { key: 'count', content: <bdi>{all.length} מסיבות</bdi>, colSpan: 2 },
    { key: 'tickets', content: <Money agorot={sum((p) => p.ticketsAgorot)} />, numeric: true },
    { key: 'bar', content: <Money agorot={sum((p) => p.barAgorot)} />, numeric: true },
    { key: 'cost', content: <Money agorot={costAgorot} />, numeric: true },
  ];
  if (anyShared) {
    totals.push({ key: 'partner', content: <Money agorot={sum(partnerNet)} />, numeric: true });
  }
  totals.push({ key: 'net', content: <Net agorot={netAgorot} />, numeric: true });

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>מסיבות</h1>
          <Link className={styles.newLink} href={newHref}>מסיבה חדשה</Link>
        </div>
        <p className={styles.lead}>
          כל מסיבה שעשינו: כמה נכנס מכרטיסים ומהבר, כמה היא עלתה, וכמה נשאר לקאמפ
          אחרי ההתחשבנות עם קאמפ שותף.
        </p>
      </div>

      {all.length === 0 ? null : (
        <ul className={styles.strip} aria-label="סיכום כל המסיבות">
          <li><StatTile label="נכנס מכרטיסים ובר" valueAgorot={incomeAgorot} /></li>
          <li><StatTile label="הוצאות" valueAgorot={costAgorot} /></li>
          <li>
            <StatTile
              label="נשאר לקאמפ מכל המסיבות"
              valueAgorot={netAgorot}
              derivation="נכנס פחות יצא, כולל ההתחשבנות עם שותפים"
              tone={netAgorot < 0 ? 'bad' : 'default'}
            />
          </li>
        </ul>
      )}

      {all.length < 2 ? null : (
        <SavedViews
          label="סדר המסיבות"
          views={(Object.keys(SORT_LABELS) as PartySort[]).map((one) => ({
            id: one, label: SORT_LABELS[one], href: eventsHref(params, one),
          }))}
          currentId={sort}
        />
      )}

      {!creating ? null : (
        <Drawer
          title="מסיבה חדשה"
          subtitle="אחרי השמירה נפתח דף המסיבה, ושם רושמים את הכסף"
          closeHref={closePeekHref(PATH, asParams(params))}
        >
          <PartyForm
            mode="create"
            seasonId={season.id}
            seasons={seasons.map((one) => ({ id: one.id, name: one.name }))}
            closeHref={closePeekHref(PATH, asParams(params))}
          />
        </Drawer>
      )}

      <Table
        caption="מסיבות"
        columns={columns}
        rows={rows}
        totals={rows.length === 0 ? undefined : totals}
        totalsLabel="סיכום"
        empty={(
          <EmptyState
            kind="nothing-yet"
            noun="מסיבות"
            action={{ href: newHref, label: 'מסיבה חדשה' }}
          />
        )}
      />
    </main>
  );
}
