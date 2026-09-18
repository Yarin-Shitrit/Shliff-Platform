'use client';

/**
 * A client component only because `<details>` must live in the browser to
 * collapse when a link inside it is followed. It holds no data — every item
 * is a link, so the menu is server-rendered markup that happens to fold.
 *
 * Hand-written rather than the kit's `Popover` on purpose: R1 forbids reaching
 * for a library, and `popover.tsx` closes on any click matching `a, button`
 * (A28), which is right for a menu of actions and wrong for nothing here —
 * but `<details>` already gives the open state, the toggle and keyboard
 * access for free, so there is nothing left for a component to add.
 */
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import styles from './imports.module.css';

export function FileRowMenu(
  { uploadId, firstOpenBlockId, openDecisions }: {
    uploadId: string;
    firstOpenBlockId: string | null;
    openDecisions: number;
  },
) {
  return (
    <details className={styles.menu}>
      <summary className={styles.menuTrigger} aria-label="פעולות על הקובץ">
        <Icon name="more" size={16} />
      </summary>
      <div className={styles.menuPanel} role="group">
        {firstOpenBlockId ? (
          <Link
            className={styles.menuItem}
            href={`/imports/${uploadId}?block=${firstOpenBlockId}`}
          >
            המשך סקירה
          </Link>
        ) : null}
        <Link className={styles.menuItem} href={`/imports/${uploadId}`}>
          פתיחת הסקירה
        </Link>
        {openDecisions > 0 ? (
          <Link className={styles.menuItem} href="/inbox">
            {/* A17: one isolate for the whole phrase, not one per number. */}
            <bdi>{openDecisions} החלטות פתוחות — לטיפול</bdi>
          </Link>
        ) : null}
      </div>
    </details>
  );
}
