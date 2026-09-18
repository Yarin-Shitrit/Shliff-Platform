import type { ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import type { IconName } from '@/components/ui/icon';
import { Pill } from '@/components/ui/pill';
import type { PillTone } from '@/components/ui/pill';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import styles from './home.module.css';

/**
 * One row of the preview, already composed into Hebrew by the caller.
 *
 * These are the panel's own props, not the register's. The register belongs to
 * the לטיפול plan, and the mapping from its items onto this shape will live in
 * `page.tsx`, in one place. A presentational component owning its props is
 * ordinary React; a second copy of the register's logic here would not be —
 * which is why this file imports nothing from `@/lib/inbox`.
 */
export interface PreviewItem {
  id: string;
  icon: IconName;
  title: ReactNode;
  detail: ReactNode;
  pill?: { text: string; tone: PillTone };
  /** The workbook cell or file this came from, in mono (R11). */
  source?: string;
  action?: { label: string; href: string };
}

/**
 * The first few decisions waiting on a lead.
 *
 * `items` being empty is not by itself good news — it is good news only when
 * `total` is zero too. All-clear is the one empty state that celebrates (C10),
 * and celebrating over a queue nobody has looked at is how a screen starts
 * lying to the person reading it.
 *
 * `href` is null until the register's own page exists. A "לכל הרשימה" link to
 * a route nobody has built is a 404 dressed as a next step, which is the one
 * thing this screen may never do.
 */
export function InboxPreview({ items, total, remainder, seasonName, href }: {
  items: PreviewItem[];
  /** Every open decision, not just the ones shown. */
  total: number;
  /** The footer sentence about what did not fit, or null. */
  remainder: ReactNode | null;
  seasonName: string;
  /** The register's own page. Null until plan 05 ships `/inbox`. */
  href: string | null;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <Icon name="inbox" size={16} />
        <h2>לטיפול</h2>
        {/* The scope this panel speaks about. C10's all-clear carries no
            season of its own, and three panels reading "הכול מטופל" on one
            screen have to say what they are clear of. */}
        <bdi className={styles.scope}>{seasonName}</bdi>
        {total > 0 ? (
          <bdi>
            <Pill tone="brand">{total === 1 ? 'החלטה אחת' : `${total} החלטות`}</Pill>
          </bdi>
        ) : null}
        <span className={styles.panelLead}>
          המערכת לא מנחשת. אלה ההכרעות שממתינות.
        </span>
        {href ? (
          <Link className={styles.more} href={href}>לכל הרשימה ←</Link>
        ) : null}
      </div>

      {items.length === 0 && total === 0 ? (
        <div className={styles.emptyBody}>
          <EmptyState kind="all-clear" />
        </div>
      ) : (
        <ul className={styles.rows}>
          {items.map((item) => (
            <li key={item.id} className={styles.row}>
              <Icon name={item.icon} size={15} />
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  {item.title}
                  {item.pill ? (
                    <Pill tone={item.pill.tone}>{item.pill.text}</Pill>
                  ) : null}
                </span>
                <span className={styles.rowDetail}>{item.detail}</span>
              </span>
              {item.source ? (
                <span className={styles.source}>{item.source}</span>
              ) : null}
              {item.action ? (
                <ButtonLink size="sm" href={item.action.href}>
                  {item.action.label}
                </ButtonLink>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {remainder ? (
        <div className={styles.panelFoot}>
          <span>{remainder}</span>
          {href ? <Link className={styles.more} href={href}>פתיחת הרשימה</Link> : null}
        </div>
      ) : null}
    </section>
  );
}
