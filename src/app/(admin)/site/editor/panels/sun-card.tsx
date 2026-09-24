'use client';

/**
 * Shade by hour (spec §11): the hour, 07:00 to 18:00 in quarter hours, and
 * what is really in shade then — counted by `shadeAtHour` for the gate day
 * over the Midburn pin. Without a gate day the card invites one — a link to
 * the season's opening date — and the scene lights no sun: the map does not
 * guess a day (§13). With a day, the date itself links there too, since a
 * figure links to what changes it (ruling SD4). It says which way north is,
 * and links to the plot settings where that is set.
 */

import Link from 'next/link';
import type { ReactElement } from 'react';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import type { ShadeAtHour } from '@/lib/site/editor/sun';
import { northText } from './north';
import styles from './sun-card.module.css';

/**
 * 14.25 → "14:15". Valid over the slider's own domain, 07:00–18:00 inclusive.
 * Rounded from the total minute count — not truncated hour-then-minute — so a
 * value a hair under a whole hour (7.999999, from float drift) reads "08:00",
 * never "07:60".
 */
export function hourText(hour: number): string {
  const totalMinutes = Math.round(hour * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(wholeHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function summaryText(hour: number, summary: ShadeAtHour | null): string {
  const at = hourText(hour);
  if (summary === null) return `בשעה ${at} השמש מתחת לאופק, ואין צל להראות.`;
  if (summary.under === 0) return `בשעה ${at} אין פריטים מתחת לרשתות הצל.`;
  const under = summary.under === 1 ? 'מתוך פריט אחד' : `מתוך ${summary.under} פריטים`;
  return `בשעה ${at}, ${under} מתחת לרשתות: ${summary.full} בצל מלא, ${summary.partial} בצל חלקי, ${summary.sun} בשמש.`;
}

/** "2026-06-04" → "4.6.2026". */
function dayText(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(day)}.${Number(month)}.${year}`;
}

export function SunCard({ hour, onHour, summary, northDeg, plotHref, dateHref, sunDate }: {
  hour: number;
  onHour: (hour: number) => void;
  /** Null while the sun is down — or when there is no day to ask about. */
  summary: ShadeAtHour | null;
  northDeg: number;
  plotHref: string;
  /** The shell's drawer for this season's opening date (`?act=season-date`, `seasonDateHref`). */
  dateHref: string;
  /**
   * The gate day, already read by `readSunDate` (`views.ts`, the one
   * `YYYY-MM-DD` check) — never raw text handed straight from a season row.
   * Null means the season has no opening date yet, not that the text failed
   * to parse; this component does not re-check the shape.
   */
  sunDate: string | null;
}): ReactElement {
  return (
    <div className={cx(styles.card, styles.sunCard)} role="group" aria-label="צל לפי שעה" data-panel="true">
      {sunDate === null ? (
        /* SD4 (replacing D1's interim statement): an empty state is an
           invitation. The opening date is the shell's to set, in its own
           drawer; the card links there. */
        <>
          <p className={styles.hint}>
            לעונה הזו עוד לא נרשם תאריך פתיחה. עם תאריך, הצל לפי שעה יחושב ליום פתיחת השער.
          </p>
          <Link href={dateHref} className={styles.link}>קביעת תאריך הפתיחה</Link>
        </>
      ) : (
        <>
          <div className={styles.sunRow}>
            <Icon name="sun" size={16} />
            <b><bdi>{hourText(hour)}</bdi></b>
            <input
              type="range"
              className={styles.range}
              min={7}
              max={18}
              step={0.25}
              value={hour}
              aria-label="שעה ביום"
              aria-valuetext={hourText(hour)}
              onChange={(event) => { onHour(Number(event.target.value)); }}
            />
          </div>
          <p className={styles.hint}><bdi>{summaryText(hour, summary)}</bdi></p>
          <p className={styles.meta}>
            {'ביום פתיחת השער, '}
            <Link
              href={dateHref}
              className={styles.link}
              aria-label={`${dayText(sunDate)}, שינוי תאריך הפתיחה`}
            >
              <bdi>{dayText(sunDate)}</bdi>
            </Link>
            {' (תאריך הפתיחה של העונה), במיקום של מידברן.'}
          </p>
        </>
      )}
      <p className={styles.meta}>
        <bdi>{northText(northDeg)}</bdi>
        {' · '}
        <Link href={plotHref} className={styles.link}>שינוי בהגדרות המגרש</Link>
      </p>
    </div>
  );
}
