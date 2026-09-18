import type { ReactElement, ReactNode } from 'react';
import { cx } from './cx';
import styles from './table.module.css';

/**
 * R7: no `'use client'`. `Table` calls no hook and owns no state — every
 * handler (`onToggleRow`, `onToggleAll`, `rowActions`) arrives as a prop, so
 * the same module renders on the server for a read-only table and inside a
 * client tree for a selectable one.
 */

export type ColumnAlign = 'start' | 'end';
export type RowTone = 'default' | 'warn' | 'bad';

export type TableColumn<Row> = {
  /** Stable key; also the cell's React key. */
  key: string;
  /** Header content. `''` for the action column. */
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** A10's documented exception: physical right alignment + tabular numerals. */
  numeric?: boolean;
  /** Where non-numeric content sits. Default 'start'. Ignored when `numeric`. */
  align?: ColumnAlign;
  /** `inline-size: 1%` — shrinks to its content (checkbox, action slot). */
  w0?: boolean;
  /** The header's name for assistive technology when `header` renders empty. */
  srHeader?: string;
};

export type TableRowModel<Row> = {
  id: string;
  data: Row;
  /** Row-level tone: a flagged budget line is `warn`, a refused import row is `bad`. */
  tone?: RowTone;
  /**
   * A group heading. Table emits a group `<tr>` above this row whenever the
   * value differs from the previous row's — D7's month headers, D9's kinds.
   * Rows arrive already ordered; Table never re-groups them.
   */
  group?: string;
};

export type TableSelection = {
  selectedIds: ReadonlySet<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  /** `בחירת רוני אדלר`, built by the caller from the row it knows. */
  rowCheckboxLabel: (rowId: string) => string;
  /** `בחירת כל השורות`. */
  allCheckboxLabel: string;
};

export type TableTotalsCell = {
  key: string;
  content: ReactNode;
  colSpan?: number;
  numeric?: boolean;
};

export type TableProps<Row> = {
  /** The table's accessible name (E4). Visually hidden unless `captionVisible`. */
  caption: string;
  captionVisible?: boolean;
  columns: ReadonlyArray<TableColumn<Row>>;
  rows: ReadonlyArray<TableRowModel<Row>>;
  /** Prepends a `w0` checkbox column and tones selected rows. */
  selection?: TableSelection;
  /** Appends a `w0` cell revealed on row hover, focus-within and selection. */
  rowActions?: (row: Row) => ReactNode;
  /** A `<tfoot>` of cells in visual order; they may span. */
  totals?: ReadonlyArray<TableTotalsCell>;
  /**
   * A26. A `<tfoot>` is a `rowgroup` with no name of its own, so a totals row
   * cannot be queried or announced as anything — it reads as one more group of
   * rows. This names it (`סיכום`), for the same reason `caption` names the
   * table. Omitted, the footer stays unnamed and renders exactly as before.
   */
  totalsLabel?: string;
  /** Rendered instead of the body when `rows` is empty — usually an `<EmptyState>`. */
  empty?: ReactNode;
  /** A8: 44px comfortable, 36px compact. Default 'comfortable'. */
  density?: 'comfortable' | 'compact';
};

/**
 * A10's one documented exception lives in the global `.num` utility
 * (`src/app/globals.css`), not here: a numeric column composes that class
 * for its physical right alignment rather than declaring its own. `.numeric`
 * itself carries no alignment — it exists only to mark the column.
 */
function cellClass<Row>(column: TableColumn<Row>): string {
  return cx(
    column.numeric && styles.numeric,
    column.numeric && 'num',
    column.align === 'end' && !column.numeric && styles.end,
    column.w0 && styles.w0,
  );
}

export function Table<Row>({
  caption,
  captionVisible,
  columns,
  rows,
  selection,
  rowActions,
  totals,
  totalsLabel,
  empty,
  density = 'comfortable',
}: TableProps<Row>): ReactElement {
  const span = columns.length + (selection ? 1 : 0) + (rowActions ? 1 : 0);
  const selectedCount = selection
    ? rows.filter((row) => selection.selectedIds.has(row.id)).length
    : 0;
  const allChecked = selection !== undefined && rows.length > 0 && selectedCount === rows.length;
  const someChecked = selectedCount > 0 && !allChecked;

  let lastGroup: string | undefined;

  return (
    <div className={cx(styles.wrap, density === 'compact' && styles.compact)}>
      <table className={styles.table}>
        <caption className={captionVisible ? styles.caption : 'sr-only'}>{caption}</caption>
        <thead>
          <tr>
            {selection ? (
              <th scope="col" className={styles.w0}>
                <input
                  type="checkbox"
                  className={styles.check}
                  aria-label={selection.allCheckboxLabel}
                  aria-checked={someChecked ? 'mixed' : allChecked}
                  checked={allChecked}
                  onChange={selection.onToggleAll}
                />
              </th>
            ) : null}
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cellClass(column)}>
                {column.srHeader !== undefined ? (
                  <span className="sr-only">{column.srHeader}</span>
                ) : (
                  column.header
                )}
              </th>
            ))}
            {rowActions ? <th scope="col" className={styles.w0} /> : null}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={span} className={styles.emptyCell}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.flatMap((row) => {
              const nodes: ReactElement[] = [];
              if (row.group !== undefined && row.group !== lastGroup) {
                lastGroup = row.group;
                nodes.push(
                  <tr key={`group-${row.id}`} className={styles.groupRow}>
                    <th scope="rowgroup" colSpan={span}>
                      {row.group}
                    </th>
                  </tr>,
                );
              }
              const selected = selection?.selectedIds.has(row.id) ?? false;
              nodes.push(
                <tr
                  key={row.id}
                  data-tone={row.tone ?? 'default'}
                  className={cx(selected && styles.selected)}
                >
                  {selection ? (
                    <td className={styles.w0}>
                      <input
                        type="checkbox"
                        className={styles.check}
                        aria-label={selection.rowCheckboxLabel(row.id)}
                        checked={selected}
                        onChange={() => selection.onToggleRow(row.id)}
                      />
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td key={column.key} className={cellClass(column)}>
                      {column.cell(row.data)}
                    </td>
                  ))}
                  {rowActions ? (
                    <td className={cx(styles.w0, styles.actions)}>{rowActions(row.data)}</td>
                  ) : null}
                </tr>,
              );
              return nodes;
            })
          )}
        </tbody>

        {totals ? (
          <tfoot aria-label={totalsLabel}>
            <tr>
              {totals.map((cell) => (
                <td
                  key={cell.key}
                  colSpan={cell.colSpan}
                  className={cx(cell.numeric && styles.numeric, cell.numeric && 'num')}
                >
                  {cell.content}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
