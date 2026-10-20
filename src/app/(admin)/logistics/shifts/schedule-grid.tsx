import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { cx } from '@/components/ui/cx';
import { formatWindow, type EventDay } from '@/lib/logistics/shift-time';
import type { Board, ScheduleSlot } from '@/lib/logistics/shifts';
import {
  scheduleHref, slotHref, typeHref, type RawParams,
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
      <bdi className={styles.when} dir="ltr">{formatWindow(slot.startsAt, slot.endsAt)}</bdi>
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

export function ScheduleGrid({
  board, days, params, currentTaskId,
}: {
  board: Board;
  days: EventDay[];
  params: RawParams;
  /** The slot whose drawer is open, so its card is marked. */
  currentTaskId: string | null;
}) {
  return (
    <div className={styles.boardWrap}>
      <table className={styles.board}>
        <caption className="sr-only">לוח המשמרות, לפי סוג משמרת ויום</caption>
        <thead>
          <tr>
            <th scope="col">סוג משמרת</th>
            {days.map((day) => (
              <th scope="col" key={day.day}>
                <span className={styles.weekday}>{day.weekday}</span>
                <bdi className={styles.dayMonth} dir="ltr">{day.dayMonth}</bdi>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {board.rows.map((row) => {
            const key = row.type?.id ?? 'untyped';
            const active = row.type !== null && !row.type.retired;
            return (
              <tr key={key} className={row.type?.retired ? styles.rowRetired : undefined}>
                <th scope="row">
                  {row.type === null ? 'ללא סוג' : (
                    <Link href={typeHref(params, row.type.id)}>
                      {row.type.name}
                      {row.type.retired ? ' · יצא משימוש' : ''}
                    </Link>
                  )}
                </th>
                {row.cells.map((cell, index) => (
                  <td key={days[index].day}>
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
