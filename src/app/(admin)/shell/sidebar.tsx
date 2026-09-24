import Image from 'next/image';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import { ThemeToggle } from '@/components/theme-toggle';
import { signOutAction } from './actions';
import { CommandPalette } from './command-palette';
import { NavList } from './nav-list';
import { NewSeasonDrawer } from './new-season-drawer';
import { SeasonDateDrawer } from './season-date-drawer';
import { SeasonSwitch, type SwitchSeason } from './season-switch';
import { UserBlock } from './user-block';
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
 * The search entry (Task 6) sits above the groups; the footer — the signed-in
 * user, a way out, and the theme toggle beside it (B9, Task 10) — sits below
 * them, pinned to the bottom by `.sidefoot`. A non-admin session renders no
 * footer at all: `requireAdmin` here is a display decision, not the
 * enforcement, which every page still performs on its own (B9's ruling).
 * The responsive collapse below 1024px (Task 9) wraps this component from
 * the outside — `SidebarFrame` in `layout.tsx`, and `.rail`/`.railScrim` in
 * the stylesheet — so this file itself needed no change for it.
 *
 * `NewSeasonDrawer` is rendered here, beside `SeasonSwitch`, rather than by
 * a page: `?act=season` (the switcher's `שנה חדשה`) must open from any admin
 * screen, and only the rail is common to all of them. `SeasonDateDrawer`
 * (`?act=season-date`, the switcher's `פתיחת השער`) sits beside it for the
 * same reason, and is handed the same season list the switcher is.
 */
export async function Sidebar() {
  const { seasons } = await resolveSeason(db);
  const options: SwitchSeason[] = seasons.map((season, index) => ({
    id: season.id,
    name: season.name,
    state: stateOf(index, season.flatRate),
    startsOn: season.startsOn,
  }));
  const admin = await requireAdmin();

  return (
    <aside className={styles.side}>
      <div className={styles.brandrow}>
        <Image src="/logo.png" alt="" width={30} height={30} className={styles.markLight} />
        <Image src="/logo-dark.png" alt="" width={30} height={30} className={styles.markDark} />
        <span className={styles.wordmark}>קופת שליף</span>
      </div>
      <SeasonSwitch seasons={options} />
      <NewSeasonDrawer />
      <SeasonDateDrawer seasons={options} />
      <CommandPalette />
      <NavList />
      <div className={styles.sidefoot}>
        {admin.ok && (
          <UserBlock email={admin.email} onSignOut={signOutAction}>
            <ThemeToggle />
          </UserBlock>
        )}
      </div>
    </aside>
  );
}
