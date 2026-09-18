import type { ReactElement } from 'react';
import type { SheetCollisionItem } from '@/lib/inbox/items';
import { Banner } from '@/components/ui/banner';
import styles from './inbox.module.css';

/**
 * Two copies of one sheet, line by line, so a lead choosing which is
 * authoritative sees what the choice costs (W19).
 *
 * When the comparison refuses — a copy with no confirmed column mapping — the
 * stored Hebrew reason is rendered in place of it, verbatim. Showing a
 * difference derived from a positional guess, on the screen where a lead
 * decides which copy is real, is worse than showing nothing.
 */
export function CopyCompare({ item }: { item: SheetCollisionItem }): ReactElement {
  const { group, diff } = item;

  return (
    <section className={styles.panel}>
      <div className={styles.sectionTitle}>
        מה ההבדל בין העותקים
      </div>

      {/*
        Choosing a copy makes the other superseded, and a superseded block is
        refused whole — so the next promotion sweeps the rows that copy already
        wrote. A lead is told before they choose, not after.
      */}
      <Banner
        tone="warn"
        label="מה קורה כשבוחרים עותק"
        headline="בחירת עותק קובעת גם מה נמחק"
        detail="העותק שלא נבחר מסומן כמוחלף, והשורות שכבר נכתבו ממנו יוסרו בקידום הבא. השורות של העותק הנבחר נכתבות במקומן."
      />

      {diff.ok ? (
        <table className={styles.grid}>
          <caption className={styles.srOnly}>השוואת השורות בין העותקים</caption>
          <thead>
            <tr>
              <th scope="col">שורה</th>
              {group.sheets.map((sheet) => (
                <th key={sheet.id} scope="col"><bdi>{sheet.filename}</bdi></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {diff.rows.map((row) => (
              <tr key={row.label} data-marked={row.differs ? 'true' : undefined}>
                <th scope="row">{row.label}</th>
                {row.values.map((value, index) => (
                  <td key={group.sheets[index]?.id ?? index}>
                    {value === null
                      ? <span className={styles.muted}>אין שורה כזו</span>
                      : <bdi>{value}</bdi>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Banner
          tone="info"
          label="למה אי אפשר להשוות"
          headline={diff.reason}
        />
      )}
    </section>
  );
}
