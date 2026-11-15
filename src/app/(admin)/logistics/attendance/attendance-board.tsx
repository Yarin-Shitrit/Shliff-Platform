import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { Pill } from '@/components/ui/pill';
import { cx } from '@/components/ui/cx';
import { DateText } from '@/components/format';
import { formatDateShort } from '@/lib/dates';
import {
  civilDate, eventLabel, weekdayOf, type Board, type AttendanceEvent,
} from '@/lib/logistics/attendance';
import { ATTENDANCE_KIND_LABELS } from '@/lib/logistics/labels';
import { eventHref, personHref, type RawParams } from '@/lib/logistics/attendance-views';
import { MarkToggle } from './mark-toggle';
import styles from './attendance.module.css';

/**
 * R7: no `'use client'`. The board is a table of links and toggles and holds
 * no state of its own; each cell's `MarkToggle` is the one client piece.
 *
 * A row per member, a column per day, a check where the two met, a count
 * of the things they did on their own, and the count at the end of the
 * row — which is the figure the whole screen is for. The last row counts
 * the other way: how many came each day.
 *
 * Laptop only. Forty names by twenty days does not fit a phone at any
 * density a thumb can hit, so below 767.98px the sheet hides the table and
 * the page draws `EventList` instead — each day a card that opens the
 * drawer, where the names are a checklist. Two drawings of one fact, but
 * not two copies: the table's cells and the cards' counts both come from
 * the same `Board`.
 */

/** `יום שלישי` → `שלישי`: the header has twenty of these across. */
function shortWeekday(weekday: string): string {
  return weekday.replace(/^יום /, '');
}

/** What a column — or a toast — calls a day: its words and its date. */
export function eventName(event: AttendanceEvent): string {
  return `${eventLabel(event)} ${formatDateShort(civilDate(event.heldOn))}`;
}

export function AttendanceBoard({
  board, params, currentEventId,
}: {
  board: Board;
  params: RawParams;
  /** The day whose drawer is open, so its column is marked. */
  currentEventId: string | null;
}) {
  const grand = board.rows.reduce((sum, row) => sum + row.total, 0);

  return (
    <div className={styles.boardWrap}>
      <table className={styles.board}>
        <caption className="sr-only">לוח הנוכחות, לפי חבר ויום</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.corner}>שם</th>
            {board.events.map((event) => (
              <th
                scope="col"
                key={event.id}
                className={styles.dayHead}
                aria-current={currentEventId === event.id ? 'true' : undefined}
              >
                <Link href={eventHref(params, event.id)} className={styles.dayLink}>
                  <span className={styles.dayTitle}>{eventLabel(event)}</span>
                  <span className={styles.dayWhen}>
                    <bdi>{shortWeekday(weekdayOf(event.heldOn))}</bdi>
                    {' '}
                    <DateText at={civilDate(event.heldOn)} />
                  </span>
                  {event.title === null ? null : (
                    <span className={styles.dayKind}>{ATTENDANCE_KIND_LABELS[event.kind]}</span>
                  )}
                </Link>
              </th>
            ))}
            <th scope="col" className={styles.personalHead}>
              <span className={styles.dayTitle}>סימונים אישיים</span>
              <span className={styles.dayKind}>משימות שחבר עשה לבד</span>
            </th>
            <th scope="col" className={cx(styles.totalHead, 'num')}>סה״כ</th>
          </tr>
        </thead>
        <tbody>
          {board.rows.map((row) => (
            <tr key={row.personId} className={row.onRoster ? undefined : styles.rowOff}>
              <th scope="row" className={styles.nameCell}>
                <Link href={`/members/${row.personId}`} className={styles.nameLink}>{row.displayName}</Link>
                {row.onRoster ? null : (
                  /* A mark is a fact somebody recorded; the person leaving the
                     roster since does not unrecord it. The row stays and says
                     why it is here, and the cells are read-only because
                     marking is for the roster (`setMark` refuses otherwise). */
                  <Pill tone="outline">לא ברשימת השנה</Pill>
                )}
              </th>
              {board.events.map((event) => (
                <td key={event.id} className={styles.cell}>
                  {row.onRoster ? (
                    <MarkToggle
                      eventId={event.id}
                      personId={row.personId}
                      personName={row.displayName}
                      eventName={eventName(event)}
                      present={row.present.has(event.id)}
                    />
                  ) : row.present.has(event.id) ? (
                    <span className={cx(styles.check, styles.checkOn, styles.checkStill)}>
                      <Icon name="check" size={14} label={`${row.displayName} · ${eventName(event)} · סומן/ה`} />
                    </span>
                  ) : null}
                </td>
              ))}
              <td className={cx(styles.cell, styles.personalCell, 'num')}>
                {row.onRoster ? (
                  /* The count opens the person's drawer, where the marks are
                     listed and the next one is added. Plus on zero, so a row
                     with nothing says how to get something. */
                  <Link
                    href={personHref(params, row.personId)}
                    className={styles.personalLink}
                    aria-label={`סימונים אישיים · ${row.displayName} · ${row.personal.length}`}
                  >
                    {row.personal.length === 0 ? <Icon name="plus" size={14} /> : row.personal.length}
                  </Link>
                ) : row.personal.length === 0 ? null : row.personal.length}
              </td>
              <td className={cx(styles.totalCell, 'num')}>{row.total}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className={styles.nameCell}>נוכחים</th>
            {board.events.map((event) => (
              <td key={event.id} className={cx(styles.cell, 'num')}>
                {board.perEvent.get(event.id) ?? 0}
              </td>
            ))}
            <td className={cx(styles.cell, styles.personalCell, 'num')}>{board.personalTotal}</td>
            <td className={cx(styles.totalCell, 'num')}>{grand}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Phone only: the days as cards, newest first, each opening its drawer. The
 * count on a card is the board's `perEvent`, the same figure the table's
 * last row shows on a laptop.
 */
export function EventList({
  board, params, currentEventId,
}: {
  board: Board;
  params: RawParams;
  currentEventId: string | null;
}) {
  const newestFirst = [...board.events].reverse();
  return (
    <ul className={styles.eventList} aria-label="ימים בלוח הנוכחות">
      {newestFirst.map((event) => (
        <li key={event.id}>
          <Link
            href={eventHref(params, event.id)}
            className={styles.eventCard}
            aria-current={currentEventId === event.id ? 'true' : undefined}
          >
            <span className={styles.eventCardHead}>
              <span className={styles.eventCardTitle}>{eventLabel(event)}</span>
              {event.title === null ? null : (
                <span className={styles.eventCardKind}>{ATTENDANCE_KIND_LABELS[event.kind]}</span>
              )}
            </span>
            <span className={styles.eventCardWhen}>
              <bdi>{weekdayOf(event.heldOn)}</bdi>
              {' '}
              <DateText at={civilDate(event.heldOn)} form="full" />
            </span>
            <span className={styles.eventCardCount}>
              <Icon name="users" size={14} />
              <bdi>{`${board.perEvent.get(event.id) ?? 0} נוכחים`}</bdi>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
