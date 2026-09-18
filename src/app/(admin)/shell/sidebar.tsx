import Image from 'next/image';
import { db } from '@/db';
import { resolveSeason } from '@/lib/seasons/current';
import { NavList } from './nav-list';
import { SeasonSwitch, type SwitchSeason } from './season-switch';
import styles from './sidebar.module.css';

/**
 * The state word beside each season is derived, never stored (B4): the
 * newest season is the one the camp is running, and an older season whose
 * flat rate is zero never charged dues. Each word is a statement about a
 * row, not a guess and not a new column.
 */
function stateOf(index: number, flatRate: string): string {
  if (index === 0) return 'פעילה';
  return Number(flatRate) === 0 ? 'בלי דמי קאמפ' : 'הסתיימה';
}

/**
 * The rail (B1). A Server Component: the brand and the groups need no
 * browser, and the pieces that do — the nav's active mark and its counts —
 * are their own client islands. It is `async` now that it resolves the
 * season list once for the switcher (R5): every other season-scoped page
 * calls the same `resolveSeason`, so the rail can never list a season no
 * page can show.
 *
 * Two logos rather than one tinted mark: the wordmark's lockup differs
 * between the light and dark files, and CSS cannot recolour a PNG.
 *
 * The search entry and footer (settings, signed-in user, theme toggle) are
 * B1's remaining pieces — Tasks 6, 9 and 10 add those into this file in turn
 * (see the lane ledger's pre-flight conflict scan).
 */
export async function Sidebar() {
  const { seasons } = await resolveSeason(db);
  const options: SwitchSeason[] = seasons.map((season, index) => ({
    id: season.id,
    name: season.name,
    state: stateOf(index, season.flatRate),
  }));

  return (
    <aside className={styles.side}>
      <div className={styles.brandrow}>
        <Image src="/logo.png" alt="" width={30} height={30} className={styles.markLight} />
        <Image src="/logo-dark.png" alt="" width={30} height={30} className={styles.markDark} />
        <span className={styles.wordmark}>קופת שליף</span>
      </div>
      <SeasonSwitch seasons={options} />
      <NavList />
    </aside>
  );
}
