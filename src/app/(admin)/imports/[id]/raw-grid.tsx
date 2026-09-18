/**
 * The block exactly as it sits in the workbook, with the dry run's verdict on
 * each row where the row is.
 *
 * A Server Component. The filter lives in the URL, so the segmented control is
 * three links and a 59-row grid never reaches the browser as client state
 * (R6). Every sentence in it is the promoter's own Hebrew, from
 * `Refusal.message` and `PromotedRow.notes` — this screen shows refusals, it
 * does not word them.
 */
import { Fragment } from 'react';
import Link from 'next/link';
import type { GridRow } from '@/lib/import/review';
import { colLabel } from '@/lib/xlsx/col-label';
import { Icon } from '@/components/ui/icon';
import styles from './import-review.module.css';

export type RowFilter = 'all' | 'written' | 'refused';

const KEEPS: Record<RowFilter, (row: GridRow) => boolean> = {
  all: (row) => row.state !== 'header',
  written: (row) => row.state === 'written' || row.state === 'noted',
  refused: (row) => row.state === 'refused',
};

const TINT: Partial<Record<GridRow['state'], string>> = {
  noted: styles.rowNoted,
  refused: styles.rowRefused,
};

export function RawGrid(
  { uploadId, blockId, left, rows, filter }: {
    uploadId: string;
    blockId: string;
    /** The block's first column, so the A1 letters are the sheet's own. */
    left: number;
    rows: GridRow[];
    filter: RowFilter;
  },
) {
  const header = rows.find((row) => row.state === 'header') ?? null;
  const body = rows.filter((row) => KEEPS[filter](row));
  const width = header?.cells.length
    ?? rows.reduce((n, row) => Math.max(n, row.cells.length), 0);

  const counts = {
    all: rows.filter(KEEPS.all).length,
    written: rows.filter(KEEPS.written).length,
    refused: rows.filter(KEEPS.refused).length,
  };

  const tab = (key: RowFilter, text: string) => (
    <Link
      key={key}
      className={`${styles.segButton} ${filter === key ? styles.segOn : ''}`}
      href={`/imports/${uploadId}?block=${blockId}${key === 'all' ? '' : `&rows=${key}`}`}
      aria-current={filter === key ? 'true' : undefined}
    >
      {/* A17: the label and its count are one phrase, so one isolate. */}
      <bdi>{text} {counts[key]}</bdi>
    </Link>
  );

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>
        <Icon name="grid" size={15} /> הטבלה כפי שהיא
        <span className={styles.seg}>
          {tab('all', 'הכול')}
          {tab('written', 'ייכתבו')}
          {tab('refused', 'נדחו')}
        </span>
      </h3>

      <div className={styles.tableScroll}>
        <table className={styles.rawGrid}>
          <caption className="sr-only">הטבלה כפי שהיא בגיליון</caption>
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">שורה בגיליון</span></th>
              {Array.from({ length: width }, (_, index) => (
                <th key={index} scope="col"><bdi>{colLabel(left + index)}</bdi></th>
              ))}
            </tr>
            {/* The workbook's own header row, kept under every filter: without
                it the columns below have no names. */}
            {header ? (
              <tr className={styles.rowHeader}>
                <th scope="row"><bdi>{header.sheetRow}</bdi></th>
                {Array.from({ length: width }, (_, index) => (
                  <th key={index} scope="col">{header.cells[index] ?? ''}</th>
                ))}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {body.map((row) => (
              <Fragment key={row.sheetRow}>
                <tr className={TINT[row.state]}>
                  <th scope="row"><bdi>{row.sheetRow}</bdi></th>
                  {Array.from({ length: width }, (_, index) => (
                    <td key={index}>{row.cells[index] ?? ''}</td>
                  ))}
                </tr>
                {row.message ? (
                  <tr className={TINT[row.state]}>
                    <td colSpan={width + 1} className={styles.rowMessage}>
                      {row.state === 'refused'
                        ? <>לא נכתב: {row.message}</>
                        : (
                          <>
                            נכתב עם הערה: {row.message}{' '}
                            <Link className={styles.inboxLink} href="/inbox">לטיפול</Link>
                          </>
                        )}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        * Not the kit's `EmptyState`: `all-clear`'s sentence is about tasks and
        * would claim the block is dealt with, which it is not, and `no-matches`
        * would send a lead hunting for a filter when the news is good. An
        * empty state is an invitation, not an apology — and where nothing was
        * refused it is not even that, it is the answer.
        */}
      {body.length === 0 ? (
        <p className={styles.gridEmpty}>
          {filter === 'refused' ? 'אף שורה לא נדחתה' : 'אין שורות בתצוגה הזו'}
        </p>
      ) : null}
    </section>
  );
}
