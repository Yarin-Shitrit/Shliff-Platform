'use client';

/**
 * Client component: it opens a menu, and it reads `?season=` — which a
 * layout is not given (Ruling S2). The list of seasons is server data,
 * handed down as a prop; the *choice* is the URL's, read here with the same
 * `pickSeason` every page's `resolveSeason` uses, so the button can never
 * name a season the page below it is not showing.
 *
 * "שנה חדשה" (B4) was deferred by the plan's own Ruling S4: the mock's
 * affordance pointed at a settings screen no plan in that wave built, and
 * that wave's spec forbade writing a new `seasons` row. Both are now false —
 * it opens `NewSeasonDrawer` (rendered alongside this component in
 * `sidebar.tsx`) via `?act=season`. There is no record id to carry, so this
 * is an `act` with no `peek` (R6), built through `openActHref` — the same
 * shape plan 10's create drawer uses for `?act=task`.
 *
 * The active season's gate date sits under the list, as a link to
 * `?act=season-date` (`SeasonDateDrawer`, also rendered in `sidebar.tsx`):
 * every figure links to what changes it. A season with no date shows an
 * invitation to set one instead of a blank.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { openActHref } from '@/components/ui/drawer-url';
import { DateText } from '@/components/format';
import { pickSeason } from '@/lib/seasons/pick';
import { seasonDateHref, seasonHref } from './season-href';
import styles from './sidebar.module.css';

export interface SwitchSeason {
  id: string;
  name: string;
  /** The word under the name in the menu: פעילה / הסתיימה / בלי דמי קאמפ. */
  state: string;
  /**
   * `seasons.starts_on` as stored — an instant, read in the camp's timezone
   * wherever it is shown. `null` when nobody has set it: the menu then
   * invites setting one rather than implying a date.
   */
  startsOn: Date | null;
}

export function SeasonSwitch({ seasons }: { seasons: SwitchSeason[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const current = pickSeason(seasons, searchParams.get('season'));
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.code === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // A9: whatever closes the popover — esc, the scrim, or picking a season —
  // hands focus back to the button that opened it, so a keyboard user is
  // never dropped onto the page with nothing focused.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!current) {
    return <div className={styles.seasonEmpty}>עדיין אין שנים</div>;
  }

  return (
    <div className={styles.seasonWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.seasonSwitch}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={styles.seasonNames}>
          <span className={styles.seasonKicker}>שנה</span>
          <span className={styles.seasonName}>{current.name}</span>
        </span>
        <span className={styles.seasonMeta}>
          <span className={styles.seasonState}>{current.state}</span>
          <Icon name="updown" size={14} />
        </span>
      </button>

      {open && (
        <>
          <button
            type="button"
            className={styles.scrim}
            aria-label="סגירה"
            onClick={() => setOpen(false)}
          />
          {/*
            No `role="menu"`/`"menuitem"` here: every row is a real link that
            navigates (via `seasonHref`), not a command, so overriding the
            anchor's implicit link role would take away the one role a
            keyboard or screen-reader user actually needs to act on it.
          */}
          <div className={styles.seasonPop}>
            <div className={styles.menusect}>שנות פעילות</div>
            {seasons.map((season) => (
              <Link
                key={season.id}
                className={styles.menuitem}
                href={seasonHref(pathname, search, season.id)}
                aria-current={season.id === current.id ? 'true' : undefined}
                onClick={() => setOpen(false)}
              >
                {season.id === current.id
                  ? <Icon name="check" size={16} />
                  : <span className={styles.menuGutter} />}
                <span>{season.name}</span>
                <span className={styles.menumeta}>{season.state}</span>
              </Link>
            ))}
            <div className={styles.divider} />
            <Link
              className={styles.menuitem}
              href={seasonDateHref(pathname, searchParams)}
              onClick={() => setOpen(false)}
            >
              <Icon name="calendar" size={16} />
              {current.startsOn === null ? (
                <>
                  <span>תאריך הפתיחה לא נרשם</span>
                  <span className={styles.menuInvite}>קביעה</span>
                </>
              ) : (
                <>
                  <span>פתיחת השער</span>
                  <span className={styles.menumeta}>
                    <DateText at={current.startsOn} form="prose" />
                  </span>
                </>
              )}
            </Link>
            <div className={styles.divider} />
            <Link
              className={styles.menuitem}
              href={openActHref(pathname, searchParams, 'season')}
              onClick={() => setOpen(false)}
            >
              <Icon name="plus" size={16} />
              <span>שנה חדשה</span>
            </Link>
            <div className={styles.divider} />
            <p className={styles.menunote}>
              חשבונות, אנשים וחובות בלי שנה נשארים גלויים בכל שנה.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
