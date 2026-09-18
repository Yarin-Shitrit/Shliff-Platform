import Link from 'next/link';
import type { Movement } from '@/lib/money/ledger';
import type { SourceCell } from '@/lib/money/trace';
import { sourceKey } from '@/lib/money/overview';
import { Money, DateText } from '@/components/format';
import { Table } from '@/components/ui/table';
import type { TableColumn } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { SourceChip } from '@/components/ui/source-chip';
import { EmptyState } from '@/components/ui/empty-state';
import { chipSource } from './chip-source';
import styles from './money.module.css';

/**
 * The five newest movements, and a door to the rest.
 *
 * Two columns, never a signed amount: direction is carried by the column an
 * amount sits in (A11), which is also what the workbook's own
 * `הוצאות` / `הכנסות` pair does. No running balance — D7 shows one only when
 * the view is a single account in date order, and five rows across three
 * accounts is precisely the case where a running total would be a lie.
 */
export function RecentMovements({ rows, total, sources, scope, seasonName }: {
  rows: Movement[];
  total: number;
  sources: Map<string, SourceCell>;
  scope: string;
  seasonName: string;
}) {
  const columns: ReadonlyArray<TableColumn<Movement>> = [
    { key: 'when', header: 'תאריך', cell: (move) => <DateText at={move.occurredOn} /> },
    { key: 'what', header: 'תיאור', cell: (move) => move.description },
    {
      key: 'account',
      header: 'חשבון',
      // A movement with no account is admitted in a word, never folded into
      // a guessed one and never left as an empty cell.
      cell: (move) => move.accountName ?? <Pill tone="warn">לא צוין</Pill>,
    },
    {
      key: 'in',
      header: 'נכנס',
      numeric: true,
      cell: (move) => (move.direction === 'in'
        ? <Money agorot={move.amountAgorot} />
        : <span className={styles.dim}>—</span>),
    },
    {
      key: 'out',
      header: 'יצא',
      numeric: true,
      cell: (move) => (move.direction === 'out'
        ? <Money agorot={move.amountAgorot} />
        : <span className={styles.dim}>—</span>),
    },
    {
      key: 'source',
      header: 'מקור',
      cell: (move) => (
        // `payments` has no provenance columns, and a dues payment genuinely
        // was typed by a lead — `נרשם ידנית` is the true answer, not a
        // missing one. The `dues` arm is short-circuited rather than looked
        // up, because a payment id could collide with a ledger entry's and
        // borrow a cell that belongs to a different row.
        <SourceChip source={chipSource(move.source === 'dues'
          ? undefined
          : sources.get(sourceKey('ledger_entries', move.id)))} />
      ),
    },
  ];

  return (
    <section>
      <div className={styles.sectionTitle}>
        <h2 className={styles.sectionHeading}>התנועות האחרונות</h2>
        <Link className={`link ${styles.sectionLink}`} href={`/money/ledger${scope}`}>
          <bdi>לכל {total} התנועות ←</bdi>
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState kind="nothing-this-season" noun="תנועות" seasonName={seasonName}
                    action={{ href: '/upload', label: 'לדף הייבוא' }} />
      ) : (
        <Table
          caption="התנועות האחרונות"
          density="compact"
          columns={columns}
          rows={rows.map((move) => ({ id: `${move.source}-${move.id}`, data: move }))}
        />
      )}
    </section>
  );
}
