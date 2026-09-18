import Link from 'next/link';
import type { ObligationRow } from '@/lib/money/obligations';
import type { ObligationDirection } from '@/db/schema/money';
import type { SourceCell } from '@/lib/money/trace';
import { sourceKey } from '@/lib/money/overview';
import { Money } from '@/components/format';
import { Table } from '@/components/ui/table';
import type { TableColumn } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { SourceChip } from '@/components/ui/source-chip';
import { chipSource } from './chip-source';
import styles from './money.module.css';

/** `למי` for what the camp owes, `ממי` for what is owed to it. */
const PARTY_HEADER: Record<ObligationDirection, string> = {
  camp_owes: 'למי',
  owed_to_camp: 'ממי',
};

const CAPTION: Record<ObligationDirection, string> = {
  camp_owes: 'מה אנחנו חייבים',
  owed_to_camp: 'מה חייבים לנו',
};

/**
 * One direction's debts.
 *
 * The party header is derived from `direction` rather than passed in: `למי`
 * headed both tables until this component existed, which told a reader of the
 * right-hand table that the camp owed the money it was owed. A string prop
 * would let a caller put that back.
 *
 * Outstanding only. The settlement chain — `חוב יוסף → 6,000 → five ברן 26
 * dues` — belongs on /money/debts (D8), which has the room to show it as one
 * visible chain; an overview's job is to say how much is open.
 */
export function ObligationsTable({ direction, rows, sources, scope }: {
  direction: ObligationDirection;
  rows: ObligationRow[];
  sources: Map<string, SourceCell>;
  scope: string;
}) {
  const openTotal = rows.reduce((total, row) => total + row.outstandingAgorot, 0);

  const columns: ReadonlyArray<TableColumn<ObligationRow>> = [
    {
      key: 'party',
      card: 'title',
      header: PARTY_HEADER[direction],
      cell: (row) => {
        // An unnamed debt has no party to show and no settle affordance to
        // offer — `settleObligation` refuses it — so the cell says why in a
        // word rather than sitting empty (R3).
        if (row.unnamed) return <Pill tone="bad">חסר שם</Pill>;
        if (row.partyPersonId) {
          return (
            <Link className="link" href={`/members/${row.partyPersonId}`}>
              {row.displayParty}
            </Link>
          );
        }
        return <bdi>{row.displayParty}</bdi>;
      },
    },
    {
      key: 'what',
      card: 'meta',
      header: 'על מה',
      cell: (row) => (
        <>
          {/* R6: a drawer is a URL. D8 owns the drawer itself. */}
          <Link className={styles.rowLink} href={`/money/debts${scope}&peek=${row.id}`}>
            {row.description}
          </Link>
          <SourceChip source={chipSource(sources.get(sourceKey('obligations', row.id)))} />
        </>
      ),
    },
    {
      key: 'left',
      card: 'figure',
      header: 'נותר',
      numeric: true,
      cell: (row) => <Money agorot={row.outstandingAgorot} />,
    },
  ];

  return (
    <Table
      caption={CAPTION[direction]}
      density="compact"
      columns={columns}
      rows={rows.map((row) => ({
        id: row.id,
        data: row,
        tone: row.unnamed ? ('bad' as const) : undefined,
      }))}
      totals={[
        { key: 'count', content: <bdi>{rows.length} חובות</bdi>, colSpan: 2 },
        { key: 'sum', content: <Money agorot={openTotal} />, numeric: true },
      ]}
    />
  );
}
