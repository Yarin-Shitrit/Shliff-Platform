import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listAccounts } from '@/lib/money/accounts';
import { formatShekels } from '@/lib/money';
import { partyDetail, PARTY_PART_LABELS } from '@/lib/money/parties';
import type { PartyMovement } from '@/lib/money/parties';
import { Money, DateText } from '@/components/format';
import { Table } from '@/components/ui/table';
import type { TableColumn, TableRowModel, TableTotalsCell } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import type { PillTone } from '@/components/ui/pill';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { Drawer } from '@/components/ui/drawer';
import { openActHref, closePeekHref } from '@/components/ui/drawer-url';
import { StatTile } from '@/components/ui/stat-tile';
import type { PartyPart } from '@/db/schema/money';
import { PartyForm } from '../party-form';
import { PartyMovementForm } from '../party-movement-form';
import { DeleteMovement } from '../delete-movement';
import styles from '../events.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'מסיבה' };

type PartySearchParams = { season?: string; act?: string };

const PART_TONES: Readonly<Record<PartyPart, PillTone>> = {
  tickets: 'ok',
  bar: 'ok',
  cost: 'neutral',
  partner: 'info',
};

function asParams(current: PartySearchParams): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  return search;
}

function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function Nothing(): ReactNode {
  return <span className={styles.none} aria-hidden="true">—</span>;
}

/**
 * One party: what it brought in, what it cost, what passed to the camp it
 * was made with, and what was left. Every figure is a sum of the rows in the
 * table beneath it, and every row is one the lead can see and, if they typed
 * it, remove.
 */
export default async function PartyPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<PartySearchParams>;
}) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const { id } = await params;
  const query = await searchParams;
  const party = await partyDetail(db, id);
  if (party === undefined) notFound();

  const path = `/money/events/${party.id}`;
  const recording = query.act === 'movement';
  const editing = query.act === 'edit';
  const accounts = recording ? await listAccounts(db) : [];
  const closeHref = closePeekHref(path, asParams(query));
  const recordHref = openActHref(path, asParams(query), 'movement');
  const backHref = query.season ? `/money/events?season=${query.season}` : '/money/events';

  const unsortedAgorot = party.unsortedInAgorot + party.unsortedOutAgorot;
  const partnerNetAgorot = party.partnerInAgorot - party.partnerOutAgorot;

  const columns: Array<TableColumn<PartyMovement>> = [
    {
      key: 'date',
      card: 'meta',
      header: 'תאריך',
      cell: (one) => <DateText at={one.occurredOn} />,
    },
    {
      key: 'part',
      card: 'meta',
      header: 'סוג',
      cell: (one) => (one.part === null
        ? <Pill tone="warn">לא מסווג</Pill>
        : <Pill tone={PART_TONES[one.part]}>{PARTY_PART_LABELS[one.part]}</Pill>),
    },
    {
      key: 'description',
      card: 'title',
      header: 'תיאור',
      cell: (one) => one.description,
    },
    {
      key: 'account',
      card: 'meta',
      header: 'חשבון',
      cell: (one) => one.accountName ?? <Pill tone="warn">לא צוין</Pill>,
    },
    {
      key: 'in',
      card: 'figure',
      header: 'נכנס',
      numeric: true,
      cell: (one) => (one.direction === 'in' ? <Money agorot={one.amountAgorot} /> : <Nothing />),
    },
    {
      key: 'out',
      card: 'figure',
      header: 'יצא',
      numeric: true,
      cell: (one) => (one.direction === 'out' ? <Money agorot={one.amountAgorot} /> : <Nothing />),
    },
  ];

  const rows: Array<TableRowModel<PartyMovement>> = party.movements.map((one) => ({
    id: one.id,
    data: one,
    tone: one.accountId === null || one.part === null ? 'warn' : undefined,
  }));

  const inAgorot = party.movements
    .filter((one) => one.direction === 'in')
    .reduce((total, one) => total + one.amountAgorot, 0);
  const outAgorot = party.movements
    .filter((one) => one.direction === 'out')
    .reduce((total, one) => total + one.amountAgorot, 0);

  const totals: TableTotalsCell[] = [
    { key: 'count', content: <bdi>{party.count} תנועות</bdi>, colSpan: 4 },
    { key: 'in', content: <Money agorot={inAgorot} />, numeric: true },
    { key: 'out', content: <Money agorot={outAgorot} />, numeric: true },
  ];

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <Link className={`link ${styles.back}`} href={backHref}>→ כל המסיבות</Link>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{party.name}</h1>
          <div className={styles.actions}>
            <Link className={styles.editLink} href={openActHref(path, asParams(query), 'edit')}>
              עריכת המסיבה
            </Link>
            <Link className={styles.newLink} href={recordHref}>רישום כסף</Link>
          </div>
        </div>
        <p className={styles.lead}>
          {party.heldOn === null ? 'אין תאריך' : <DateText at={party.heldOn} form="full" />}
          {' · '}<bdi>{party.seasonName}</bdi>
          {' · '}
          {party.partnerName === null
            ? 'עשינו לבד'
            : <>יחד עם <bdi>{party.partnerName}</bdi></>}
        </p>
      </div>

      <ul className={styles.strip} aria-label="סיכום המסיבה">
        <li><StatTile label="כרטיסים" valueAgorot={party.ticketsAgorot} href={recordHref} /></li>
        <li><StatTile label="בר" valueAgorot={party.barAgorot} href={recordHref} /></li>
        <li><StatTile label="הוצאות" valueAgorot={party.costAgorot} href={recordHref} /></li>
        {party.partnerName === null ? null : (
          <li>
            <StatTile
              label={`מול ${party.partnerName}`}
              valueAgorot={partnerNetAgorot}
              derivation={`קיבלנו ${formatShekels(party.partnerInAgorot)} · שילמנו ${formatShekels(party.partnerOutAgorot)}`}
              href={recordHref}
            />
          </li>
        )}
        <li>
          <StatTile
            label="נשאר לקאמפ"
            valueAgorot={party.netAgorot}
            derivation={party.partnerName === null
              ? 'כרטיסים ובר, פחות הוצאות'
              : 'כרטיסים ובר, פחות הוצאות, ואחרי ההתחשבנות עם השותף'}
            tone={party.netAgorot < 0 ? 'bad' : party.netAgorot > 0 ? 'ok' : 'default'}
          />
        </li>
      </ul>

      {unsortedAgorot === 0 ? null : (
        <Banner
          tone="warn"
          headline="חלק מהכסף של המסיבה לא מסווג."
          detail="התנועות האלה נספרות במה שנשאר לקאמפ, אבל לא בכרטיסים, בבר או בהוצאות. אפשר למחוק אותן ולרשום מחדש עם סוג."
        />
      )}

      {!recording ? null : (
        <Drawer
          title="רישום כסף"
          subtitle={<>למסיבה <bdi>{party.name}</bdi>. החלון נשאר פתוח לשורה הבאה.</>}
          closeHref={closeHref}
        >
          <PartyMovementForm
            eventId={party.id}
            partyName={party.name}
            partnerName={party.partnerName}
            defaultDate={isoDay(party.heldOn ?? new Date())}
            accounts={accounts.map((one) => ({ id: one.id, name: one.name }))}
          />
        </Drawer>
      )}

      {!editing ? null : (
        <Drawer title="עריכת המסיבה" closeHref={closeHref}>
          <PartyForm
            mode="edit"
            eventId={party.id}
            name={party.name}
            heldOn={party.heldOn === null ? '' : isoDay(party.heldOn)}
            partnerName={party.partnerName}
            closeHref={closeHref}
          />
        </Drawer>
      )}

      <Table
        caption={`הכסף של ${party.name}`}
        columns={columns}
        rows={rows}
        totals={rows.length === 0 ? undefined : totals}
        totalsLabel="סיכום"
        rowActionsHeader="מחיקה"
        rowActions={(one) => (one.manual ? (
          <DeleteMovement
            eventId={party.id}
            entryId={one.id}
            description={one.description}
            amountAgorot={one.amountAgorot}
          />
        ) : null)}
        empty={(
          <EmptyState
            kind="nothing-yet"
            noun="תנועות כסף למסיבה הזו"
            action={{ href: recordHref, label: 'רישום כסף' }}
          />
        )}
      />
    </main>
  );
}
