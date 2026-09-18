import type { ReactElement, ReactNode } from 'react';
import styles from './skeleton.module.css';

/**
 * E3. What a screen shows while its data is still coming.
 *
 * R7: no `'use client'`. Nothing here holds state or reads the browser; a
 * `loading.tsx` is rendered on the server like any other route module.
 *
 * What these must not do, and why each is a rule rather than a preference:
 *
 *   - **No spinner.** A spinner says "something is happening" where a skeleton
 *     says "four tiles and eleven rows are happening", and the second is the
 *     one that stops a lead re-clicking.
 *   - **No figure, not even a zero.** A number drawn here is a lie with a short
 *     shelf life, and a reader who learns that a zero on a screen means "not
 *     yet" will read the real zeroes the same way.
 *   - **One announcement, not one per shape.** Eleven announced grey
 *     rectangles are worse than silence, so every shape is `aria-hidden` and a
 *     single visually hidden sentence carries the whole message.
 *   - **Counts that match the real content's.** The point of the shape is that
 *     nothing jumps when the data lands, and a skeleton of four rows under a
 *     table of eleven moves the page twice instead of once.
 */

export function SkeletonPage({
  label, children,
}: {
  /** Announced once, visually hidden: `טוען את דמי הקאמפ…` */
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <main className={styles.page}>
      {/*
        The live region is inside `<main>`, not on it. Putting `role="status"`
        on the landmark itself replaces it for as long as the screen is
        loading, so a reader navigating by landmark loses the one they were
        heading for at exactly the moment they asked for it.
      */}
      <div role="status" aria-live="polite" className="sr-only">{label}</div>
      <div className={styles.body} aria-hidden="true">{children}</div>
    </main>
  );
}

/** A row of stat tiles (R3's figure cards), `count` of them. */
export function SkeletonTiles({ count }: { count: number }): ReactElement {
  return (
    <div className={styles.tiles}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} data-skeleton="tile" aria-hidden="true" className={styles.tile}>
          <span className={`${styles.shape} ${styles.label}`} />
          <span className={`${styles.shape} ${styles.value}`} />
          <span className={`${styles.shape} ${styles.sub}`} />
        </div>
      ))}
    </div>
  );
}

/** A table of `rows` × `columns`, drawn at the density the real one uses. */
export function SkeletonTable({
  rows, columns,
}: { rows: number; columns: number }): ReactElement {
  return (
    <div className={styles.table}>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} data-skeleton="row" aria-hidden="true" className={styles.row}>
          {Array.from({ length: columns }, (_, column) => (
            <span key={column} className={`${styles.shape} ${styles.cell}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** `lines` lines of prose — a header block, a description, a note. */
export function SkeletonText({ lines }: { lines: number }): ReactElement {
  return (
    <div className={styles.text}>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} data-skeleton="line" aria-hidden="true" className={`${styles.shape} ${styles.line}`} />
      ))}
    </div>
  );
}
