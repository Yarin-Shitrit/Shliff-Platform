import Image from 'next/image';
import { NavList } from './nav-list';
import styles from './sidebar.module.css';

/**
 * The rail (B1). A Server Component: the brand and the groups need no
 * browser, and the pieces that do — the nav's active mark and its counts —
 * are their own client islands.
 *
 * Two logos rather than one tinted mark: the wordmark's lockup differs
 * between the light and dark files, and CSS cannot recolour a PNG.
 *
 * The season switcher, search entry and footer (settings, signed-in user,
 * theme toggle) are B1's remaining pieces — this task lays the rail and its
 * nav groups; Tasks 5, 6, 9 and 10 add those into this file in turn (see
 * the lane ledger's pre-flight conflict scan).
 */
export function Sidebar() {
  return (
    <aside className={styles.side}>
      <div className={styles.brandrow}>
        <Image src="/logo.png" alt="" width={30} height={30} className={styles.markLight} />
        <Image src="/logo-dark.png" alt="" width={30} height={30} className={styles.markDark} />
        <span className={styles.wordmark}>קופת שליף</span>
      </div>
      <NavList />
    </aside>
  );
}
