import type { BudgetGroup, BudgetLineActuals } from '@/lib/money/budget';
import type { SourceCell } from '@/lib/money/trace';
import { sourceKey } from '@/lib/money/overview';
import { formatShekels } from '@/lib/money';
import { Money } from '@/components/format';
import { Table } from '@/components/ui/table';
import type { TableColumn } from '@/components/ui/table';
import { Pill } from '@/components/ui/pill';
import { SourceChip } from '@/components/ui/source-chip';
import { EmptyState } from '@/components/ui/empty-state';
import { chipSource } from './chip-source';
import { SpendBar } from './spend-bar';
import styles from './money.module.css';

export interface BudgetTableTotals {
  plannedAgorot: number;
  spentAgorot: number;
  remainingAgorot: number;
  count: number;
}

/**
 * A line's quantity, exactly as the workbook wrote it. The quantity column
 * holds `12,000kw`, `מכולה`, `תפריט שלם לשבוע` and `מקרר תעשייתי` beside plain
 * numbers, and this renders all of them as text. The unit price is appended
 * only when there is one; a `× ₪0` would be an assertion nobody made.
 */
function QuantityLine({ line }: { line: BudgetLineActuals }) {
  if (line.quantityText === null && line.unitCostAgorot === null) return null;
  return (
    <span className={styles.quantity}>
      {line.quantityText !== null ? <bdi>{line.quantityText}</bdi> : null}
      {line.quantityText !== null && line.unitCostAgorot !== null ? ' × ' : null}
      {line.unitCostAgorot !== null ? <Money agorot={line.unitCostAgorot} /> : null}
    </span>
  );
}

/**
 * The season's plan, what has gone out against it, and what is left.
 *
 * `סה״כ` is now `בתקציב`: the row carries three amounts, and `סה״כ` no longer
 * says which one it is. An overrun is the word `חריגה` and a positive figure,
 * never a minus sign in a column of positives — a reader scanning `נותר`
 * should never have to decode a sign to learn that a line went over.
 */
export function BudgetTable({ groups, totals, sources, seasonName }: {
  groups: BudgetGroup[];
  totals: BudgetTableTotals;
  sources: Map<string, SourceCell>;
  seasonName: string;
}) {
  if (groups.length === 0) {
    return (
      <EmptyState kind="nothing-this-season" noun="סעיפי תקציב"
                  seasonName={seasonName}
                  action={{ href: '/upload', label: 'לדף הייבוא' }} />
    );
  }

  const columns: ReadonlyArray<TableColumn<BudgetLineActuals>> = [
    {
      key: 'label',
      card: 'title',
      header: 'סעיף',
      cell: (line) => (
        <>
          <span className={styles.lineLabel}>
            {line.label}
            {line.arithmeticOff ? (
              // `Pill` carries no `title`, so the tooltip lives on the wrapper.
              // The word is what carries the meaning either way (R3); the
              // tooltip only spells out the arithmetic that failed.
              <span title="כמות × מחיר ליחידה אינו שווה לסה״כ">
                <Pill tone="warn">החשבון לא מסתדר</Pill>
              </span>
            ) : null}
          </span>
          <QuantityLine line={line} />
          <SpendBar spentAgorot={line.spentAgorot} plannedAgorot={line.totalAgorot}
                    over={line.overAgorot > 0} />
        </>
      ),
    },
    {
      key: 'planned',
      card: 'meta',
      header: 'בתקציב',
      numeric: true,
      cell: (line) => <Money agorot={line.totalAgorot} />,
    },
    {
      key: 'spent',
      card: 'meta',
      header: 'הוצא עד כה',
      numeric: true,
      cell: (line) => (line.spentAgorot === 0
        ? <span className={styles.dim}>—</span>
        : <Money agorot={line.spentAgorot} />),
    },
    {
      key: 'left',
      card: 'figure',
      header: 'נותר',
      numeric: true,
      cell: (line) => {
        if (line.overAgorot > 0) {
          return <Pill tone="warn">{`חריגה ${formatShekels(line.overAgorot)}`}</Pill>;
        }
        if (line.remainingAgorot === 0) return <span className={styles.dim}>—</span>;
        return <Money agorot={line.remainingAgorot} />;
      },
    },
    {
      key: 'why',
      card: 'meta',
      header: 'למה',
      cell: (line) => <span className={styles.rationale}>{line.rationale ?? ''}</span>,
    },
    {
      key: 'source',
      card: 'meta',
      header: 'מקור',
      cell: (line) => (
        <SourceChip source={chipSource(sources.get(sourceKey('budget_lines', line.id)))} />
      ),
    },
  ];

  /** `קאמפ · 12 סעיפים · 46,200 ₪` — one phrase, one isolate (A17). */
  const groupLabel = (group: BudgetGroup) =>
    `${group.label} · ${group.count} סעיפים · ${formatShekels(group.plannedAgorot)}`;

  return (
    <Table
      caption="התקציב"
      density="compact"
      columns={columns}
      rows={groups.flatMap((group) => group.lines.map((line) => ({
        id: line.id,
        data: line,
        group: groupLabel(group),
        tone: line.arithmeticOff ? ('warn' as const) : undefined,
      })))}
      totals={[
        { key: 'count', content: <bdi>{totals.count} סעיפים</bdi> },
        { key: 'planned', content: <Money agorot={totals.plannedAgorot} />, numeric: true },
        { key: 'spent', content: <Money agorot={totals.spentAgorot} />, numeric: true },
        { key: 'left', content: <Money agorot={totals.remainingAgorot} />, numeric: true },
        { key: 'rest', content: '', colSpan: 2 },
      ]}
    />
  );
}
