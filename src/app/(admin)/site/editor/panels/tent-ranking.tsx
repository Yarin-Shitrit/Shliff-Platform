'use client';

/**
 * The most shaded tents (MST — the camp lead: "the tent with most shadow
 * during the day hours from sunrise to afternoon"), a section of the sun
 * card, folded until asked for. For the day on screen, or every day of the
 * burn when the burn is what plays: each tent's minutes in shade from sunrise
 * to the hour chosen (15:00 unless another is), part shade counted as half —
 * `shadeRanking`, worked out only while the section is open. A row selects
 * its tent (a figure links to what changes it). No tents, or no nets, is an
 * invitation.
 */

import { useId, useMemo, useState, type ReactElement } from 'react';
import { Icon } from '@/components/ui/icon';
import { RANKING_END_HOUR, type TentShade } from '@/lib/site/editor/shade-timeline';
import { Choice } from './choice';
import { shortDayText } from './sun-text';
import chrome from './panel.module.css';
import styles from './sun-card.module.css';

const TITLE = 'האוהלים המוצלים ביותר';

/** Where the ranking may stop counting: the camp lead's "afternoon", and an hour either side of it. */
const END_HOURS = [13, 15, 17] as const;

/** Rows shown before the lead asks for all of them. */
const SHOWN = 5;

/**
 * 270 → "4 שעות ו־30 דקות בצל": whole hours and minutes, to the nearest
 * minute (part shade counts half, so half minutes happen), one of each in the
 * singular. None at all is "אין צל"; some, but under half a minute — a
 * sample cut short at sunset can leave seconds — is "פחות מדקה בצל", never none.
 */
export function shadeDurationText(minutes: number): string {
  if (minutes <= 0) return 'אין צל';
  const total = Math.round(minutes);
  if (total === 0) return 'פחות מדקה בצל';
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const hoursText = hours === 0 ? '' : hours === 1 ? 'שעה' : `${hours} שעות`;
  if (rest === 0) return `${hoursText} בצל`;
  if (hoursText === '') return `${rest === 1 ? 'דקה' : `${rest} דקות`} בצל`;
  return `${hoursText} ${rest === 1 ? 'ודקה' : `ו־${rest} דקות`} בצל`;
}

/** "13:00": the choices are whole hours. */
function wholeHourText(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function TentRanking({ days, scope, rankTents, hasNets, onPickIds }: {
  /** The days ranked over: the day on screen, or every day of the burn. */
  days: readonly string[];
  scope: 'day' | 'burn';
  /** `shadeRanking` over the map on screen, for these days, to this hour. */
  rankTents: (dates: readonly string[], endHour: number) => TentShade[];
  hasNets: boolean;
  /** The editor's `pickIds`: shown, selected and flown to. */
  onPickIds?: (ids: string[]) => void;
}): ReactElement {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [endHour, setEndHour] = useState<number>(RANKING_END_HOUR);
  const [showAll, setShowAll] = useState(false);
  const daysKey = days.join(' ');
  /* Worked out only while the section is open. With no nets too: whether
     there are tents at all decides which invitation to give. */
  const ranking = useMemo(
    () => (open && daysKey !== '' ? rankTents(daysKey.split(' '), endHour) : null),
    [open, daysKey, endHour, rankTents],
  );

  function body(): ReactElement {
    if (ranking === null) return <></>;
    if (ranking.length === 0) {
      return <p className={chrome.invite}>אין עדיין אוהלים במפה. גרירה של אוהל מהספרייה תוסיף אחד, וכאן יופיע כמה זמן הוא בצל.</p>;
    }
    if (!hasNets) {
      /* The card's own sentence already says the map has no nets; this says
         only what a net would show here. */
      return <p className={chrome.invite}>רשת צל מעל האוהלים תראה כאן כמה זמן כל אחד מהם בצל.</p>;
    }
    const rows = showAll ? ranking : ranking.slice(0, SHOWN);
    /* Where every day's count stopped at sunset, before the hour chosen, the
       line says so — the ranking's own word for it (`untilSunset`), never
       the card's reckoning of the sun. */
    const pastSunset = ranking[0].days.length > 0 && ranking[0].days.every((day) => day.untilSunset);
    const until = pastSunset ? 'השקיעה' : <bdi>{wholeHourText(endHour)}</bdi>;
    return (
      <>
        <Choice<string>
          label="סוף הספירה"
          name={`${id}-until`}
          options={END_HOURS.map((hour) => ({ value: String(hour), label: wholeHourText(hour) }))}
          value={String(endHour)}
          onChange={(value) => { setEndHour(Number(value)); }}
        />
        {/* `role="list"` outright: WebKit drops the list role of a list drawn without markers. */}
        <ol className={styles.tentList} role="list" aria-label={TITLE}>
          {rows.map((tent) => (
            <li key={tent.id}>
              <button type="button" className={styles.tentRow} onClick={() => { onPickIds?.([tent.id]); }}>
                <bdi className={styles.tentName}>{tent.label}</bdi>
                {' '}
                <bdi className={styles.tentTime}>{shadeDurationText(tent.shadedMinutes)}</bdi>
              </button>
            </li>
          ))}
        </ol>
        {ranking.length > SHOWN ? (
          <button type="button" className={chrome.link} onClick={() => { setShowAll((all) => !all); }}>
            {showAll ? 'חמשת הראשונים בלבד' : `כל ${ranking.length} האוהלים`}
          </button>
        ) : null}
        {ranking.every((tent) => tent.shadedMinutes === 0) ? (
          <p className={chrome.invite}>הזזה של רשת צל מעל אוהל תוסיף לו צל.</p>
        ) : null}
        <p className={chrome.meta}>
          {scope === 'burn' ? (
            <>{'בכל '}<bdi>{days.length}</bdi>{' ימי הברן, מהזריחה עד '}{until}{' בכל יום.'}</>
          ) : (
            <>{'ביום '}<bdi>{shortDayText(days[0])}</bdi>{', מהזריחה עד '}{until}{'.'}</>
          )}
          {' צל חלקי נספר כחצי.'}
        </p>
      </>
    );
  }

  return (
    <div className={styles.tents}>
      <button
        type="button"
        className={styles.disclosure}
        aria-expanded={open}
        aria-controls={`${id}-tents`}
        onClick={() => { setOpen((was) => !was); }}
      >
        {TITLE}
        <Icon name={open ? 'up' : 'down'} size={14} />
      </button>
      {open ? <div id={`${id}-tents`} className={styles.tentsBody}>{body()}</div> : null}
    </div>
  );
}
