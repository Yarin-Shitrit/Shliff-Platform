/**
 * The דמי קאמפ table.
 *
 * A Server Component: props in, markup out, no state and no database. Every
 * predicate it renders from — what state a row is in, whether it can still
 * take a payment — comes from `@/lib/fees/views`, so the tab above the table
 * and the pill inside it cannot disagree.
 *
 * One column called שינוי used to hold an exception form, a payment form and
 * the payment list, on all thirty-five rows at once. A row now carries one
 * verb that matches its state, plus the exception as its own link. Both live
 * in the kit `Table`'s `rowActions` slot, which fades them in on `:hover` and
 * `:focus-within` through `opacity` and never `display: none` (E4, ruling M).
 *
 * I12: every state word is written about the חיוב, not about the member.
 * `persons` records no gender and inferring one from a Hebrew first name is
 * the guessing this system refuses.
 */

import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { Table, type TableColumn } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Money, DateText } from '@/components/format';
import { formatShekels } from '@/lib/money';
import type { MemberFeeRow } from '@/lib/fees/season-fees';
import {
  paymentStateOf, isPayable, lastPaymentOf, FEE_VIEWS, type FeeView,
} from '@/lib/fees/views';
import { IssueDueButton } from './issue-due-button';
import { feesHref } from './href';
import styles from './fees.module.css';

export interface FeeTotals {
  expectedAgorot: number;
  collectedAgorot: number;
  outstandingAgorot: number;
  memberCount: number;
  exceptionCount: number;
  noDueCount: number;
}

export interface FeeTableProps {
  rows: MemberFeeRow[];
  seasonId: string;
  seasonName: string;
  view: FeeView;
  flatRateAgorot: number;
  totals: FeeTotals;
}

/** `—` where a figure does not exist, rather than a zero that would be a claim. */
const NONE = '—';

function nameCell(row: MemberFeeRow): ReactNode {
  return (
    <span className={styles.nameCell}>
      <Avatar name={row.displayName} size="sm" decorative />
      <Link href={`/members/${row.personId}`}>{row.displayName}</Link>
    </span>
  );
}

function kindCell(row: MemberFeeRow): ReactNode {
  if (row.dueId === null) return <span className={styles.muted}>אין חיוב</span>;
  if (row.kind !== 'exception') return 'תעריף רגיל';
  return (
    <span className={styles.kindCell}>
      <Pill tone="brand">חריג</Pill>
      {row.exceptionReason && (
        <span className={styles.muted}>
          {/* A17: one isolate around the phrase — the decider is an address. */}
          <bdi>{row.exceptionReason}{row.decidedBy ? ` · ${row.decidedBy}` : ''}</bdi>
        </span>
      )}
    </span>
  );
}

/**
 * The word the row carries, always about the due. The meter beside it is
 * `aria-hidden`: the pill already says the state in words, and a bar that
 * repeats it would be a second, redundant announcement (R3).
 */
function stateCell(row: MemberFeeRow, seasonName: string): ReactNode {
  const state = paymentStateOf(row);
  if (state === 'nodue') {
    return <span className={styles.muted}>עדיין אין חיוב ל{seasonName}</span>;
  }

  const pill = state === 'nothing-to-collect' ? <Pill tone="ok" dot>אין מה לגבות</Pill>
    : state === 'unpaid' ? <Pill tone="bad" dot>טרם שולם</Pill>
    : state === 'partial' ? <Pill tone="warn" dot>{`שולם ${formatShekels(row.paidAgorot)}`}</Pill>
    : state === 'paid-by-offset' ? <Pill tone="ok" dot>שולם בקיזוז</Pill>
    : <Pill tone="ok" dot>שולם</Pill>;

  const filled = Math.min(
    100, Math.round((row.paidAgorot / (row.amountAgorot || 1)) * 100),
  );

  return (
    <span className={styles.stateCell}>
      {/* A17: the amount inside the pill is part of one readable phrase. */}
      <bdi>{pill}</bdi>
      <span className={styles.meter} aria-hidden="true">
        <span className={styles.meterFill} style={{ inlineSize: `${filled}%` }} />
      </span>
    </span>
  );
}

function lastPaymentCell(row: MemberFeeRow): ReactNode {
  const last = lastPaymentOf(row);
  if (last === null) return <span className={styles.muted}>{NONE}</span>;
  return (
    <span className={styles.lastCell}>
      <DateText at={last.paidOn} />
      <span className={styles.muted}>{last.channel}</span>
    </span>
  );
}

export function FeeTable({
  rows, seasonId, seasonName, view, flatRateAgorot, totals,
}: FeeTableProps): ReactElement {
  const columns: ReadonlyArray<TableColumn<MemberFeeRow>> = [
    { key: 'name', header: 'שם', cell: nameCell },
    { key: 'kind', header: 'סוג החיוב', cell: kindCell },
    {
      key: 'due', header: 'לתשלום', numeric: true,
      cell: (row) => (row.amountAgorot === null ? NONE : <Money agorot={row.amountAgorot} />),
    },
    { key: 'state', header: 'שולם', cell: (row) => stateCell(row, seasonName) },
    {
      key: 'outstanding', header: 'יתרה', numeric: true,
      cell: (row) => (row.dueId === null ? NONE : <Money agorot={row.outstandingAgorot} />),
    },
    { key: 'last', header: 'תשלום אחרון', cell: lastPaymentCell },
  ];

  const viewLabel = FEE_VIEWS.find((one) => one.id === view)?.label ?? 'הכול';

  /**
   * Two different emptinesses, and conflating them would tell a lead to clear
   * a filter that is not the problem: nobody matched this view, versus nobody
   * is on this season's roster at all.
   */
  const empty = totals.memberCount === 0 ? (
    <EmptyState kind="nothing-this-season" noun="חברי קאמפ" seasonName={seasonName} />
  ) : (
    <EmptyState
      kind="no-matches"
      filterSummary={viewLabel}
      action={{ label: 'הצגת הכול', href: feesHref({ season: seasonId }) }}
    />
  );

  return (
    <Table<MemberFeeRow>
      caption={`דמי קאמפ ל${seasonName}`}
      columns={columns}
      rows={rows.map((row) => ({ id: row.personId, data: row }))}
      empty={empty}
      rowActions={(row) => (
        <>
          {row.dueId === null ? (
            <IssueDueButton
              personId={row.personId} seasonId={seasonId} flatRateAgorot={flatRateAgorot}
            />
          ) : isPayable(row) ? (
            <ButtonLink
              size="sm"
              href={feesHref({ season: seasonId, view, pay: row.personId })}
            >
              רישום תשלום
            </ButtonLink>
          ) : (
            <ButtonLink
              tone="ghost" size="sm" iconLabel="תשלומים"
              href={feesHref({ season: seasonId, view, pay: row.personId })}
            >
              <Icon name="eye" size={15} />
            </ButtonLink>
          )}
          <ButtonLink
            tone="ghost" size="sm"
            iconLabel={row.kind === 'exception' ? 'עריכת החריג' : 'הגדרת חריג'}
            href={feesHref({ season: seasonId, view, exception: row.personId })}
          >
            <Icon name="pencil" size={15} />
          </ButtonLink>
        </>
      )}
      totals={[
        {
          key: 'who',
          content: <bdi>{`${totals.memberCount} חברים`}</bdi>,
        },
        {
          key: 'shape',
          content: (
            <bdi>
              {`${totals.exceptionCount} חריגים · ${totals.noDueCount} בלי חיוב`}
            </bdi>
          ),
        },
        { key: 'expected', numeric: true, content: <Money agorot={totals.expectedAgorot} /> },
        {
          key: 'collected',
          content: <bdi>{`${formatShekels(totals.collectedAgorot)} נגבו`}</bdi>,
        },
        {
          key: 'outstanding', numeric: true,
          content: <Money agorot={totals.outstandingAgorot} />,
        },
        { key: 'pad', content: null },
      ]}
    />
  );
}
