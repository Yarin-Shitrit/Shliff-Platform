'use client';

/**
 * Shade by hour (spec §11): the hour, in quarter hours from the day's first
 * to its last with the sun up, and what is really in shade then — counted by
 * `shadeAtHour` over the Midburn pin. Without a gate day the card invites one
 * — a link to the season's opening date — and the scene lights no sun: the
 * map does not guess a day (§13). With a day, the date itself links there
 * too, since a figure links to what changes it (ruling SD4). It says which
 * way north is, and links to the plot settings where that is set.
 *
 * Ruling SIM2 adds the burn's days as chips, and the chosen day's shade as a
 * strip — the share of what stands under the nets in full and in part shade,
 * a column a quarter hour, with a playhead at the hour on screen — and says
 * in words when most of it is shaded. Clicking the strip sets the hour; the
 * slider stays the accessible control, and the strip is a picture beside it.
 *
 * And it plays: through the day from sunrise to sunset, or through every day
 * of the burn with the nights skipped, at one of three speeds, stopping at
 * the end (`sun-playback.ts`). Any hour or day set by hand pauses it.
 */

import Link from 'next/link';
import { Fragment, useId, useMemo, useState, type ReactElement } from 'react';
import { cx } from '@/components/ui/cx';
import { shadeWindows, type ShadeSample, type ShadeWindow } from '@/lib/site/editor/shade-timeline';
import type { ShadeAtHour } from '@/lib/site/editor/sun';
import { burnDays } from '@/lib/site/views';
import { EditorIcon } from './editor-icons';
import { northText } from './north';
import {
  daySpan, SPEEDS, usePlayback, useReducedMotion, type DaySpan, type Moment, type SpeedId,
} from './sun-playback';
import chrome from './panel.module.css';
import styles from './sun-card.module.css';

/**
 * 14.25 → "14:15". Valid over a day, 00:00–24:00. Rounded from the total
 * minute count — not truncated hour-then-minute — so a value a hair under a
 * whole hour (7.999999, from float drift) reads "08:00", never "07:60".
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

/* A day as `sunDateOf` writes it, and `readSunDate` has already accepted: the
   three parts are there, so these split it and never re-check its shape (P15). */

/** "2026-06-04" → "4.6.2026". */
function dayText(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(day)}.${Number(month)}.${year}`;
}

/** "2026-11-02" → "2.11", for a chip beside its weekday. */
function shortDayText(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(day)}.${Number(month)}`;
}

const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const;

/** The day of the week a calendar day falls on — the calendar's, not a clock's. */
function weekdayText(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/** The timeline's step (`shadeTimeline(doc, [day], 15)`), in hours. */
const STEP_HOURS = 0.25;

/** Before a day's daylight is known the slider keeps the spec's own range (§11). Never at the camp. */
const FALLBACK_SPAN = { from: 7, to: 18 };

/** Nothing under a net at any sample: there is no shade to picture or to put in words. */
function nothingUnder(samples: readonly ShadeSample[]): boolean {
  return samples.every((sample) => sample.counts.under === 0);
}

/**
 * The chosen day's shade, a column a quarter hour: the share of what stands
 * under the nets in full shade from the bottom, then in part shade; the rest
 * of the column is sun. It runs the way the range input above it runs — this
 * page is right to left, so the morning is on the right — and it is a picture
 * of the day, hidden from assistive technology: the slider is the control
 * and the sentences below say what it shows. A click on a column is a click
 * on that quarter hour.
 */
function ShadeStrip({ samples, hour, onPick }: {
  samples: readonly ShadeSample[];
  hour: number;
  onPick: (hour: number) => void;
}): ReactElement | null {
  if (samples.length === 0 || nothingUnder(samples)) return null;
  const columns = samples.length;
  const xOf = (index: number) => columns - 1 - index;
  const at = (hour - samples[0].hour) / STEP_HOURS;
  const playhead = at >= -0.5 && at <= columns - 0.5 ? columns - (at + 0.5) : null;
  return (
    <>
      <svg
        data-strip=""
        className={styles.strip}
        viewBox={`0 0 ${columns} 1`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {samples.map((sample, index) => {
          const { under, full, partial, sun } = sample.counts;
          const fullShare = under === 0 ? 0 : full / under;
          const partShare = under === 0 ? 0 : partial / under;
          const x = xOf(index);
          return (
            <g key={sample.hour} data-hour={sample.hour} className={styles.column} onClick={() => { onPick(sample.hour); }}>
              <title>{`${hourText(sample.hour)}: ${full} בצל מלא, ${partial} בצל חלקי, ${sun} בשמש`}</title>
              <rect data-shade="hit" className={styles.sunMark} x={x} y={0} width={1} height={1} />
              {fullShare > 0 ? (
                <rect data-shade="full" className={styles.fullMark} x={x} y={1 - fullShare} width={1} height={fullShare} />
              ) : null}
              {partShare > 0 ? (
                <rect
                  data-shade="partial"
                  className={styles.partialMark}
                  x={x}
                  y={1 - fullShare - partShare}
                  width={1}
                  height={partShare}
                />
              ) : null}
            </g>
          );
        })}
        {playhead === null ? null : (
          <>
            <line className={styles.playheadRing} x1={playhead} x2={playhead} y1={0} y2={1} vectorEffect="non-scaling-stroke" />
            <line data-playhead="" className={styles.playhead} x1={playhead} x2={playhead} y1={0} y2={1} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <p className={styles.legend} aria-hidden="true">
        <span className={styles.key}><span className={cx(styles.swatch, styles.fullKey)} />צל מלא</span>
        <span className={styles.key}><span className={cx(styles.swatch, styles.partialKey)} />צל חלקי</span>
        <span className={styles.key}><span className={cx(styles.swatch, styles.sunKey)} />שמש</span>
      </p>
    </>
  );
}

/** "10:15–14:30", or one time for a window of one sample (SIM1: a window's end is its last shaded sample). */
function windowText(window: ShadeWindow): string {
  return window.from === window.to ? hourText(window.from) : `${hourText(window.from)}–${hourText(window.to)}`;
}

function sameWindows(a: readonly ShadeWindow[], b: readonly ShadeWindow[]): boolean {
  return a.length === b.length && a.every((window, index) => window.from === b[index].from && window.to === b[index].to);
}

/** Each window a number of its own, isolated from the Hebrew around it. */
function Times({ windows }: { windows: readonly ShadeWindow[] }): ReactElement {
  return (
    <>
      {windows.map((window, index) => (
        <Fragment key={window.from}>
          {index > 0 ? ', ' : null}
          <bdi>{windowText(window)}</bdi>
        </Fragment>
      ))}
    </>
  );
}

/**
 * When most of what stands under the nets is in shade, through the chosen
 * day: full shade first, then full or part shade when that says something
 * more. With no nets, or nothing under them, an invitation instead — never an
 * empty line.
 */
function ShadeWords({ samples, hasNets, windows }: {
  samples: readonly ShadeSample[];
  hasNets: boolean;
  windows: { full: ShadeWindow[]; any: ShadeWindow[] };
}): ReactElement | null {
  if (!hasNets) {
    return <p className={chrome.invite}>אין עדיין רשתות צל במפה. גרירה של רשת צל מהספרייה תוסיף אחת, וכאן יופיע מתי יש צל.</p>;
  }
  if (samples.length === 0) return null;
  if (nothingUnder(samples)) {
    return <p className={chrome.invite}>אין עדיין פריטים מתחת לרשתות הצל. גרירה של פריט אל מתחת לרשת תראה כאן מתי הוא בצל.</p>;
  }
  const { full, any } = windows;
  return (
    <>
      {full.length > 0 ? (
        <p className={chrome.hint}>צל מלא לרוב הפריטים שמתחת לרשתות: <Times windows={full} />.</p>
      ) : (
        <p className={chrome.hint}>
          {any.length > 0
            ? 'באף שעה ביום הזה אין צל מלא לרוב הפריטים שמתחת לרשתות.'
            : 'באף שעה ביום הזה אין צל, מלא או חלקי, לרוב הפריטים שמתחת לרשתות.'}
        </p>
      )}
      {any.length > 0 && !sameWindows(full, any) ? (
        <p className={chrome.hint}>צל מלא או חלקי לרובם: <Times windows={any} />.</p>
      ) : null}
    </>
  );
}

/** One fixed name, whichever scope it plays; `aria-pressed` says whether it is playing. */
const PLAY_LABEL = 'הרצת הצל לאורך השעות';

type Scope = 'day' | 'burn';

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * A segmented choice: radios, so the browser gives the arrow keys and the
 * checked state for free. Not the kit's `Segmented`, which can only disable
 * the whole group, and one option here is disabled on its own.
 */
function Choice<T extends string>({ label, name, options, value, onChange }: {
  label: string;
  name: string;
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
}): ReactElement {
  return (
    <span className={styles.choice} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className={styles.option}>
          <input
            type="radio"
            className={styles.optionInput}
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={option.disabled}
            onChange={() => { onChange(option.value); }}
          />
          <span className={styles.optionFace}>{option.label}</span>
        </label>
      ))}
    </span>
  );
}

function isSpan(span: DaySpan | null): span is DaySpan {
  return span !== null;
}

export interface SunCardProps {
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
  /**
   * The burn's last day, read by `readSunDate` like `sunDate`. Seasons have
   * no end date yet (ruling SIM3), so today nothing passes it and the burn is
   * the gate day alone; once one exists, every day of the burn gets a chip.
   */
  endDay?: string | null;
  /** The day on screen, one of the burn's days — the gate day until a chip picks another. */
  day: string | null;
  onDay: (day: string) => void;
  /** `shadeTimeline(doc, [day], 15)` for the day on screen. */
  samples: readonly ShadeSample[];
  /** Whether the map has any shade net at all — the invitation differs. */
  hasNets: boolean;
}

export function SunCard(props: SunCardProps): ReactElement {
  const { hour, onHour, summary, northDeg, plotHref, dateHref, sunDate, endDay = null, onDay, samples, hasNets } = props;
  const shown = props.day ?? sunDate;
  const days = useMemo(() => burnDays(sunDate, endDay), [sunDate, endDay]);
  const span = useMemo(() => (shown === null ? null : daySpan(shown)) ?? FALLBACK_SPAN, [shown]);
  const windows = useMemo(() => ({ full: shadeWindows(samples, 'full'), any: shadeWindows(samples, 'any') }), [samples]);

  const id = useId();
  const [speed, setSpeed] = useState<SpeedId>('normal');
  const [scope, setScope] = useState<Scope>('day');
  const reduced = useReducedMotion();
  /* All the burn's days only with a real last day (SIM3): none recorded yet,
     or one before the first, and the choice is disabled with a way to set it
     — never a guessed length. */
  const endState: 'known' | 'missing' | 'early' = endDay === null
    ? 'missing'
    : sunDate !== null && endDay < sunDate ? 'early' : 'known';
  const playScope: Scope = endState === 'known' ? scope : 'day';
  /* The spans playback runs through, kept by their days: the burn's spans
     stay one array while playback moves from day to day, and any other scope
     is a new one — which stops playback (`usePlayback`). */
  const scopeKey = shown === null ? '' : (playScope === 'burn' ? days : [shown]).join(' ');
  const spans = useMemo(
    () => scopeKey.split(' ').filter((day) => day !== '').map((day) => daySpan(day)).filter(isSpan),
    [scopeKey],
  );
  const minutesPerSecond = SPEEDS.find((option) => option.id === speed)?.minutesPerSecond ?? SPEEDS[1].minutesPerSecond;
  const playback = usePlayback({
    spans,
    minutesPerSecond,
    reduced,
    onMoment: (moment: Moment) => {
      if (moment.day !== shown) onDay(moment.day);
      onHour(moment.hour);
    },
  });

  /** The slider or the strip: an hour set by hand stops playback. */
  function setHourByHand(next: number): void {
    playback.pause();
    onHour(next);
  }

  function chooseScope(next: Scope): void {
    playback.pause();
    setScope(next);
  }

  function togglePlay(): void {
    if (playback.playing) playback.pause();
    else if (shown !== null) playback.play({ day: shown, hour });
  }

  /** A day from its chip, the hour kept inside that day's daylight. Playback stops. */
  function pickDay(next: string): void {
    playback.pause();
    onDay(next);
    const nextSpan = daySpan(next);
    if (nextSpan !== null && (hour < nextSpan.from || hour > nextSpan.to)) {
      onHour(Math.min(nextSpan.to, Math.max(nextSpan.from, hour)));
    }
  }

  return (
    <div className={cx(chrome.card, styles.sunCard)} role="group" aria-label="צל לפי שעה" data-panel="true">
      {sunDate === null || shown === null ? (
        /* SD4 (replacing D1's interim statement): an empty state is an
           invitation. The opening date is the shell's to set, in its own
           drawer; the card links there. */
        <>
          <p className={chrome.hint}>
            לעונה הזו עוד לא נרשם תאריך פתיחה. עם תאריך, הצל לפי שעה יחושב ליום פתיחת השער.
          </p>
          <Link href={dateHref} className={chrome.link}>קביעת תאריך הפתיחה</Link>
        </>
      ) : (
        <>
          <div className={styles.sunRow}>
            <button
              type="button"
              className={chrome.iconButton}
              aria-pressed={playback.playing}
              aria-label={PLAY_LABEL}
              title={PLAY_LABEL}
              disabled={spans.length === 0}
              onClick={togglePlay}
            >
              <EditorIcon name={playback.playing ? 'pause' : 'play'} />
            </button>
            <b><bdi>{hourText(hour)}</bdi></b>
            <input
              type="range"
              className={styles.range}
              min={span.from}
              max={span.to}
              step={STEP_HOURS}
              value={hour}
              aria-label="שעה ביום"
              aria-valuetext={hourText(hour)}
              onChange={(event) => { setHourByHand(Number(event.target.value)); }}
            />
          </div>
          <ShadeStrip samples={samples} hour={hour} onPick={setHourByHand} />
          <div className={styles.controls}>
            <Choice<SpeedId>
              label="מהירות ההרצה"
              name={`${id}-speed`}
              options={SPEEDS.map((option) => ({ value: option.id, label: option.label }))}
              value={speed}
              onChange={setSpeed}
            />
            <Choice<Scope>
              label="טווח ההרצה"
              name={`${id}-scope`}
              options={[
                { value: 'day', label: 'יום אחד' },
                { value: 'burn', label: 'כל ימי הברן', disabled: endState !== 'known' },
              ]}
              value={playScope}
              onChange={chooseScope}
            />
          </div>
          {endState === 'known' ? null : (
            /* SIM3: the burn's last day is the season's, set in the shell's
               season-dates drawer; the card links there. */
            <p className={chrome.meta}>
              {endState === 'missing' ? 'תאריך הסיום של הברן לא נרשם' : 'תאריך הסיום של הברן קודם לתאריך הפתיחה'}
              {' · '}
              <Link
                href={dateHref}
                className={chrome.link}
                aria-label={endState === 'missing' ? 'קביעה של תאריך הסיום של הברן' : 'תיקון של תאריך הסיום של הברן'}
              >
                {endState === 'missing' ? 'קביעה' : 'תיקון'}
              </Link>
            </p>
          )}
          <div className={styles.days} role="group" aria-label="ימי הברן">
            {days.map((day) => (
              <button
                key={day}
                type="button"
                className={styles.chip}
                aria-pressed={day === shown}
                onClick={() => { pickDay(day); }}
              >
                {weekdayText(day)}{' '}<bdi>{shortDayText(day)}</bdi>
              </button>
            ))}
          </div>
          <p className={chrome.hint}><bdi>{summaryText(hour, summary)}</bdi></p>
          <ShadeWords samples={samples} hasNets={hasNets} windows={windows} />
          {shown === sunDate ? (
            <p className={chrome.meta}>
              {'ביום פתיחת השער, '}
              <Link
                href={dateHref}
                className={chrome.link}
                aria-label={`${dayText(sunDate)}, שינוי תאריך הפתיחה`}
              >
                <bdi>{dayText(sunDate)}</bdi>
              </Link>
              {' (תאריך הפתיחה של העונה), במיקום של מידברן.'}
            </p>
          ) : (
            <p className={chrome.meta}>
              {'ביום '}
              <bdi>{dayText(shown)}</bdi>
              {' של הברן, שמתחיל בתאריך הפתיחה '}
              <Link
                href={dateHref}
                className={chrome.link}
                aria-label={`${dayText(sunDate)}, שינוי תאריך הפתיחה`}
              >
                <bdi>{dayText(sunDate)}</bdi>
              </Link>
              {', במיקום של מידברן.'}
            </p>
          )}
        </>
      )}
      <p className={chrome.meta}>
        <bdi>{northText(northDeg)}</bdi>
        {' · '}
        <Link href={plotHref} className={chrome.link}>שינוי בהגדרות המגרש</Link>
      </p>
    </div>
  );
}
