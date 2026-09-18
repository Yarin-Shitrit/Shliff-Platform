import type { ReactElement } from 'react';
import type { AnyDb } from '@/lib/db-types';
import type { InboxItem } from '@/lib/inbox/items';
import { blockEvidence, type Evidence } from '@/lib/data/evidence';
import styles from './inbox.module.css';

/**
 * Which cell each kind of decision is about.
 *
 * Lives beside the grid rather than inside it because the **page** does the
 * reading: `EvidenceGrid` used to be an async component rendered from a
 * synchronous parent, which React renders as nothing at all outside a Server
 * Component tree — the panel was simply absent and no test could see it. The
 * page is already awaited, so the fetch belongs there and this component
 * stays a pure function of what it was given.
 */
export async function evidenceFor(db: AnyDb, item: InboxItem): Promise<Evidence | null> {
  switch (item.kind) {
    case 'block-undecided':
      return blockEvidence(db, item.blockId, topRowOf(item.range));
    case 'refused-row':
      return blockEvidence(db, item.blockId, item.refusal.sheetRow);
    case 'unnamed-debt':
      if (item.obligation.sourceBlockId === null || item.obligation.sourceRow === null) {
        return null;
      }
      return blockEvidence(db, item.obligation.sourceBlockId, item.obligation.sourceRow);
    default:
      return null;
  }
}

/** `סיכום כללי!A5:F20` → 5. The range is built by plan 11's projection. */
function topRowOf(range: string): number {
  const match = /[A-Z]+(\d+):/.exec(range);
  return match ? Number(match[1]) : 1;
}

/**
 * The workbook rows around the offending cell, out of `blocks.raw_grid`.
 *
 * The gutter carries the absolute sheet row, and the header carries the A1
 * column letters, so the reference on screen — דמי קאמפ!C14 — is the reference
 * a lead types into the workbook open beside them. Ruling 6: nothing in this
 * path reads a file, re-parses a workbook, or looks at `docs/reference-data`.
 */
export function EvidenceGrid({ evidence }: { evidence: Evidence | null }): ReactElement {
  if (evidence === null) {
    return <p className={styles.muted}>הטבלה המקורית כבר לא קיימת במערכת.</p>;
  }

  const shown = evidence.rows.length;
  const total = shown + evidence.hiddenBefore + evidence.hiddenAfter;

  return (
    <section className={styles.panel}>
      <div className={styles.sectionTitle}>
        איפה זה מופיע
        <span className={styles.src}>
          <bdi>{evidence.filename} › {evidence.reference}</bdi>
        </span>
      </div>
      <table className={styles.grid}>
        <caption className={styles.srOnly}>
          השורות בגיליון סביב התא שההחלטה נוגעת אליו
        </caption>
        <thead>
          <tr>
            <th scope="col" className={styles.gutter}>
              <span className={styles.srOnly}>שורה</span>
            </th>
            {evidence.columns.map((letter) => (
              <th key={letter} scope="col"><bdi>{letter}</bdi></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {evidence.rows.map((row) => (
            <tr key={row.sheetRow} data-marked={row.marked ? 'true' : undefined}>
              <th scope="row" className={styles.gutter}><bdi>{row.sheetRow}</bdi></th>
              {row.cells.map((cell) => (
                <td key={cell.column} data-marked={cell.marked ? 'true' : undefined}>
                  <bdi>{cell.text}</bdi>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {evidence.hiddenBefore > 0 || evidence.hiddenAfter > 0 ? (
        /* A17: one isolate for the whole phrase — a paired test queries the
           sentence, and `getNodeText` reads only direct text children. */
        <p className={styles.muted}>
          <bdi>מוצגות {shown} שורות מתוך {total} בטבלה.</bdi>
        </p>
      ) : null}
    </section>
  );
}
