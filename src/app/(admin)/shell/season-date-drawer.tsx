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
 *
 * Rendered through `BodyPortal`, like `NewSeasonDrawer`: this drawer opens
 * from page links (/tasks, the camp map) while a phone's rail is closed and
 * off-screen, and a drawer left inside that rail would go with it.
 */
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { ACT_PARAM, closePeekHref, openActHref } from '@/components/ui/drawer-url';
import { DateText } from '@/components/format';
import { formatDateFull, parseDateInput } from '@/lib/dates';
import { pickSeason } from '@/lib/seasons/pick';
import { setSeasonStartsOnAction } from './actions';
import { BodyPortal } from './body-portal';
import { SEASON_DATE_ACT } from './season-href';
import type { SwitchSeason } from './season-switch';
import styles from './season-date-drawer.module.css';

export type DatedSeason = Pick<SwitchSeason, 'id' | 'name' | 'startsOn'>;

/** How long the saved day stays on screen before the drawer closes itself. */
export const SAVED_DWELL_MS = 1_500;

const INVALID = 'תאריך פתיחת השער אינו תקין.';

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
      <BodyPortal>
        <Drawer title="פתיחת השער" closeHref={closeHref}>
          <p className={styles.empty}>
            עדיין אין שנים.{' '}
            <Link href={openActHref(pathname, searchParams, 'season')}>שנה חדשה</Link>
          </p>
        </Drawer>
      </BodyPortal>
    );
  }

  return (
    <BodyPortal>
      <Drawer title="פתיחת השער" subtitle={season.name} closeHref={closeHref}>
        {/* Keyed so a different season, or a reopened drawer, starts from its
            own stored date rather than from what was last typed. */}
        <SeasonDateForm key={season.id} season={season} closeHref={closeHref} />
      </Drawer>
    </BodyPortal>
  );
}

/** What the drawer says between a successful save and closing. */
type Saved = { kind: 'set'; day: Date } | { kind: 'cleared' };

function SeasonDateForm({ season, closeHref }: { season: DatedSeason; closeHref: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(season.startsOn === null ? '' : campDay(season.startsOn));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  // Closes a moment after the saved day is on screen. The timer belongs to
  // this mount: a drawer closed by hand (or navigated away from) meanwhile
  // must not pull the lead back to `closeHref` a second later.
  useEffect(() => {
    if (saved === null) return;
    const timer = setTimeout(() => router.replace(closeHref), SAVED_DWELL_MS);
    return () => clearTimeout(timer);
  }, [saved, router, closeHref]);

  async function save(startsOn: string) {
    setError(null);
    setPending(true);
    try {
      const result = await setSeasonStartsOnAction(season.id, startsOn);
      if (result.ok) {
        // The action already read `startsOn` with the same `parseDateInput`,
        // so a date it accepted parses here too; blank is the clear button.
        const day = parseDateInput(startsOn);
        setSaved(day === null ? { kind: 'cleared' } : { kind: 'set', day });
      } else {
        setError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    // A half-typed or impossible date (31/02, a year still being typed)
    // leaves the control's value empty and sets `badInput`. Sending that
    // empty value would be read as "clear" and delete the stored date.
    if (inputRef.current?.validity.badInput === true) {
      setError(INVALID);
      return;
    }
    // Save never clears. Only `הסרת התאריך` sends blank, so an emptied field
    // is a question to answer, not an instruction to delete.
    if (value === '') {
      setError(season.startsOn === null
        ? 'יש לבחור תאריך.'
        : 'יש לבחור תאריך, או ללחוץ על "הסרת התאריך".');
      return;
    }
    void save(value);
  }

  const busy = pending || saved !== null;

  return (
    <form onSubmit={submit} className={styles.form}>
      <Field
        id="season-date-starts-on"
        label="תאריך הפתיחה"
        hint="הספירה לאחור במשימות והצל לפי שעה במפת הקאמפ מחושבים לפי היום הזה."
      >
        <input
          ref={inputRef}
          type="date"
          id="season-date-starts-on"
          className={styles.date}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>

      {error !== null ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.actions}>
        {/* Mounted empty from the start: a live region inserted together
            with its sentence is not reliably announced. */}
        <p className={styles.saved} role="status">
          {saved === null ? null : saved.kind === 'cleared'
            ? 'התאריך הוסר.'
            : <>נשמר: <DateText at={saved.day} form="prose" /></>}
        </p>
        {season.startsOn === null ? null : (
          <Button tone="ghost" disabled={busy} onClick={() => { void save(''); }}>
            הסרת התאריך
          </Button>
        )}
        <Button type="submit" tone="primary" disabled={busy}>שמירה</Button>
      </div>
    </form>
  );
}
