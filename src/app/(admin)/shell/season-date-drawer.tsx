'use client';

/**
 * `?act=season-date`: sets, changes or clears the gate date of the season
 * `?season=` names. The switcher's `פתיחת השער` row links here, and so can
 * any page showing a figure worked out from that date (`seasonDateHref`).
 *
 * Client component, rendered once in `sidebar.tsx` beside `NewSeasonDrawer`
 * and for the same reasons: a layout is never given `searchParams` (Ruling
 * S2), and a drawer is a URL that must open from any admin page (R6). The
 * season list comes down from the rail as a prop, and the choice is resolved
 * with the same `pickSeason` the switcher and every page use, so the drawer
 * cannot edit a season other than the one on screen.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { ACT_PARAM, closePeekHref, openActHref } from '@/components/ui/drawer-url';
import { formatDateFull } from '@/lib/dates';
import { pickSeason } from '@/lib/seasons/pick';
import { setSeasonStartsOnAction } from './actions';
import { SEASON_DATE_ACT } from './season-href';
import type { SwitchSeason } from './season-switch';
import styles from './season-date-drawer.module.css';

export type DatedSeason = Pick<SwitchSeason, 'id' | 'name' | 'startsOn'>;

/**
 * `2026-06-04`, the only form `<input type="date">` takes, for the day the
 * stored instant falls on in Israel. Built from `formatDateFull`, as
 * `src/lib/work/gate.ts` builds its civil day, so the app keeps one opinion
 * of what a camp day is. The UTC day would be wrong for any instant stored
 * between 21:00 and 24:00 UTC.
 */
function campDay(at: Date): string {
  const [day, month, year] = formatDateFull(at).split('/');
  return `${year}-${month}-${day}`;
}

export function SeasonDateDrawer({ seasons }: { seasons: DatedSeason[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (searchParams.get(ACT_PARAM) !== SEASON_DATE_ACT) return null;

  const closeHref = closePeekHref(pathname, searchParams);
  const season = pickSeason(seasons, searchParams.get('season'));

  if (season === null) {
    return (
      <Drawer title="פתיחת השער" closeHref={closeHref}>
        <p className={styles.empty}>
          עדיין אין שנים.{' '}
          <Link href={openActHref(pathname, searchParams, 'season')}>שנה חדשה</Link>
        </p>
      </Drawer>
    );
  }

  return (
    <Drawer title="פתיחת השער" subtitle={season.name} closeHref={closeHref}>
      {/* Keyed so a different season, or a reopened drawer, starts from its
          own stored date rather than from what was last typed. */}
      <SeasonDateForm key={season.id} season={season} closeHref={closeHref} />
    </Drawer>
  );
}

function SeasonDateForm({ season, closeHref }: { season: DatedSeason; closeHref: string }) {
  const router = useRouter();
  const [value, setValue] = useState(season.startsOn === null ? '' : campDay(season.startsOn));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(startsOn: string) {
    setError(null);
    setPending(true);
    try {
      const result = await setSeasonStartsOnAction(season.id, startsOn);
      if (result.ok) {
        // The action revalidated the layout, so the switcher behind this
        // drawer already carries the new date when it closes.
        router.replace(closeHref);
      } else {
        setError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void save(value);
  }

  return (
    <form onSubmit={submit} className={styles.form}>
      <Field
        id="season-date-starts-on"
        label="תאריך הפתיחה"
        hint="הצל לפי שעה במפת הקאמפ מחושב ליום הזה."
      >
        <input
          type="date"
          id="season-date-starts-on"
          className={styles.date}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>

      {error !== null ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.actions}>
        {season.startsOn === null ? null : (
          <Button tone="ghost" disabled={pending} onClick={() => { void save(''); }}>
            הסרת התאריך
          </Button>
        )}
        <Button type="submit" tone="primary" disabled={pending}>שמירה</Button>
      </div>
    </form>
  );
}
