import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { Pill } from '@/components/ui/pill';
import { cx } from '@/components/ui/cx';
import { formatWindow, type EventDay } from '@/lib/logistics/shift-time';
import type { Board, ScheduleSlot } from '@/lib/logistics/shifts';
import {
  dayAnchorId, scheduleHref, slotHref, typeHref, type RawParams,
} from '@/lib/logistics/shifts-views';
import styles from './shifts.module.css';

/**
 * R7: no `'use client'`. The board is links — every slot opens its drawer by
 * URL, every empty cell links to the scheduling drawer with the type and the
 * day already chosen — and holds no state of its own.
 *
 * Overlap is allowed by construction: two shifts of one kind on one day are
 * two cards in one cell, and two kinds at once are two rows. Nothing here
 * has to detect a clash, because the camp runs the bar and the gate at the
 * same hour on purpose.
 *
 * One DOM at every width. On a laptop it is the table a lead knows from the
 * kitchen wall — a row per kind, a column per day. On a phone the same table
 * is laid out by CSS as a list of days, each day's shifts under its own
 * heading, because the question a lead asks standing in the camp is "what is
 * on tonight" and not "where is the bar on the grid". The regrouping is pure
 * CSS (`shifts.module.css`): every day header and every cell says which day
 * it belongs to in `data-day`, and the sheet orders them by it. Rendering a
 * second, phone-shaped board and hiding one would double every accessible
 * name; the table's roles are written out so that the reflow — which drops
 * the implicit ones — cannot take them with it.
 */

function SlotCard({ slot, params, current }: { slot: ScheduleSlot; params: RawParams; current: boolean }) {
  const placed = slot.assignees.filter((one) => one.status === 'accepted' || one.status === 'done');
  const open = Math.max(0, slot.peopleNeeded - placed.length);
  return (
    <Link
      href={slotHref(params, slot.taskId)}
      className={cx(styles.slot, slot.uncovered && styles.slotShort)}
      aria-current={current ? 'true' : undefined}
      aria-label={`${slot.title} ${formatWindow(slot.startsAt, slot.endsAt)}`}
    >
      <span className={styles.slotHead}>
        {/* The row header names the kind on a laptop; on a phone the row is
            scattered across six days, so the card names itself. */}
        <span className={styles.slotTitle}>{slot.title}</span>
        <bdi className={styles.when} dir="ltr">{formatWindow(slot.startsAt, slot.endsAt)}</bdi>
      </span>
      <ul className={styles.names}>
        {placed.map((one) => <li key={one.assignmentId}>{one.displayName}</li>)}
        {open > 0 ? (
          <li className={styles.open}>
            <bdi>{open === 1 ? 'מקום אחד פנוי' : `${open} מקומות פנויים`}</bdi>
          </li>
        ) : null}
      </ul>
    </Link>
  );
}

/** `יום שלישי` → `שלישי`: the strip has six chips across a phone's width. */
function shortWeekday(weekday: string): string {
  return weekday.replace(/^יום /, '');
}

export function ScheduleGrid({
  board, days, params, currentTaskId, today = null,
}: {
  board: Board;
  days: EventDay[];
  params: RawParams;
  /** The slot whose drawer is open, so its card is marked. */
  currentTaskId: string | null;
  /** The camp's civil day right now, `YYYY-MM-DD`, so the board can say
   *  which of its days is today. Null — or a day outside the event — marks
   *  nothing. */
  today?: string | null;
}) {
  const isToday = (day: EventDay) => day.day === today;

  return (
    <div className={styles.boardWrap}>
      {/*
        Phone only (`.dayNav`): the six days as chips, each a jump to that
        day's heading below. A thumb lands on "חמישי" instead of scrolling
        through four days of cards. Today's chip is marked, because that is
        the one the lead is looking for.
      */}
      <nav className={styles.dayNav} aria-label="מעבר ליום">
        {days.map((day) => (
          <a
            key={day.day}
            className={styles.dayLink}
            href={`#${dayAnchorId(day.index)}`}
            aria-current={isToday(day) ? 'date' : undefined}
          >
            <span className={styles.weekday}>{shortWeekday(day.weekday)}</span>
            <bdi className={styles.dayMonth} dir="ltr">{day.dayMonth}</bdi>
          </a>
        ))}
      </nav>

      <table role="table" className={styles.board}>
        <caption className="sr-only">לוח המשמרות, לפי סוג משמרת ויום</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">סוג משמרת</th>
            {days.map((day) => (
              <th
                role="columnheader"
                scope="col"
                key={day.day}
                id={dayAnchorId(day.index)}
                data-day={day.index}
                aria-current={isToday(day) ? 'date' : undefined}
              >
                <span className={styles.weekday}>
                  {day.weekday}
                  {isToday(day) ? <> <Pill tone="brand">היום</Pill></> : null}
                </span>
                <bdi className={styles.dayMonth} dir="ltr">{day.dayMonth}</bdi>
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {board.rows.map((row) => {
            const key = row.type?.id ?? 'untyped';
            const active = row.type !== null && !row.type.retired;
            return (
              <tr key={key} role="row" className={row.type?.retired ? styles.rowRetired : undefined}>
                <th role="rowheader" scope="row">
                  {row.type === null ? 'ללא סוג' : (
                    <Link href={typeHref(params, row.type.id)}>
                      {row.type.name}
                      {row.type.retired ? ' · יצא משימוש' : ''}
                    </Link>
                  )}
                </th>
                {row.cells.map((cell, index) => (
                  <td role="cell" key={days[index].day} data-day={days[index].index}>
                    <div className={styles.cell}>
                      {cell.map((slot) => (
                        <SlotCard key={slot.taskId} slot={slot} params={params} current={slot.taskId === currentTaskId} />
                      ))}
                      {active ? (
                        <Link
                          className={styles.addSlot}
                          href={scheduleHref(params, { typeId: row.type!.id, day: days[index].day })}
                          aria-label={`שיבוץ ${row.type!.name} ב${days[index].weekday}`}
                        >
                          <Icon name="plus" size={14} />
                          שיבוץ
                          {/* On a phone the link stands under a day, not
                              beside its row, so it says which kind. */}
                          <span className={styles.addType}>{` ${row.type!.name}`}</span>
                        </Link>
                      ) : null}
                    </div>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
