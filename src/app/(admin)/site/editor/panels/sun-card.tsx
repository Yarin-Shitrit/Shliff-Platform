'use client';

/**
 * Shade by hour (spec §11): the hour, 07:00 to 18:00 in quarter hours, and
 * what is really in shade then — counted by `shadeAtHour` for the gate day
 * over the Midburn pin. Without a gate day the card says so and the scene
 * lights no sun: the map does not guess a day (§13). It says which way north
 * is, and links to the plot settings where that is set.
 */

import Link from 'next/link';
import type { ReactElement } from 'react';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import type { ShadeAtHour } from '@/lib/site/editor/sun';
import { northText } from './north';
import styles from './sun-card.module.css';

/** 14.25 → "14:15". */
export function hourText(hour: number): string {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function summaryText(hour: number, summary: ShadeAtHour | null): string {
  const at = hourText(hour);
  if (summary === null) return `בשעה ${at} השמש מתחת לאופק, ואין צל להראות.`;
  if (summary.under === 0) return `בשעה ${at} אין פריטים מתחת לרשתות הצל.`;
  return `בשעה ${at}, מתוך ${summary.under} פריטים מתחת לרשתות: ${summary.full} בצל מלא, ${summary.partial} בצל חלקי, ${summary.sun} בשמש`;
}

/** "2026-06-04" → "4.6.2026". */
function dayText(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(day)}.${Number(month)}.${year}`;
}

export function SunCard({ hour, onHour, summary, northDeg, plotHref, sunDate }: {
  hour: number;
  onHour: (hour: number) => void;
  /** Null while the sun is down — or when there is no day to ask about. */
  summary: ShadeAtHour | null;
  northDeg: number;
  plotHref: string;
  sunDate: string | null;
}): ReactElement {
  return (
    <div className={cx(styles.card, styles.sunCard)} role="group" aria-label="צל לפי שעה" data-panel="true">
      {sunDate === null ? (
        <p className={styles.hint}>
          צל לפי שעה מחושב ליום פתיחת השער, ולשנה הזו עוד לא נרשם תאריך כזה. בלי תאריך המפה לא מנחשת יום; כשייקבע תאריך, הצל יחושב לפיו.
        </p>
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
          <p className={styles.meta}><bdi>{`ביום פתיחת השער, ${dayText(sunDate)}, במיקום של מידברן.`}</bdi></p>
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
