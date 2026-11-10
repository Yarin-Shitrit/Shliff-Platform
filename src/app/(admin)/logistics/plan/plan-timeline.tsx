import Link from 'next/link';
import { cx } from '@/components/ui/cx';
import type { Timeline, TimelineBar } from '@/lib/logistics/plan';
import { itemHref, topicHref, type RawParams } from '@/lib/logistics/plan-views';
import styles from './plan.module.css';

/**
 * The scheduled items on their days, a lane per topic. A CSS grid of days
 * rather than a chart library (R1), and rather than an SVG: every bar is a
 * link, and a reader with a screen reader gets a list of links that each
 * say what they are and when.
 *
 * Bars that overlap in time share a lane but not a row — `packBars` gives
 * each one the first row it fits in, so two parts of one item running the
 * same week sit one under the other instead of on top of each other.
 */

const MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

/** Bars into rows: each takes the first row whose last bar ends before it starts. */
export function packBars(bars: readonly TimelineBar[]): TimelineBar[][] {
  const rows: TimelineBar[][] = [];
  const ends: number[] = [];
  const sorted = [...bars].sort((a, b) => a.start - b.start || b.span - a.span);
  for (const bar of sorted) {
    let placed = false;
    for (let index = 0; index < rows.length; index += 1) {
      if (ends[index] < bar.start) {
        rows[index].push(bar);
        ends[index] = bar.start + bar.span - 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([bar]);
      ends.push(bar.start + bar.span - 1);
    }
  }
  return rows;
}

function monthOf(day: string): string {
  return MONTHS[Number(day.slice(5, 7)) - 1];
}

/** `14/05`, the short day a bar's link reads out. */
function shortDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function barLabel(bar: TimelineBar): string {
  const { item } = bar;
  const last = item.endsOn ?? item.startsOn!;
  const when = last === item.startsOn ? shortDay(item.startsOn!) : `${shortDay(item.startsOn!)}–${shortDay(last)}`;
  return `${item.title} · ${when}`;
}

export function PlanTimeline({
  timeline, params, today, currentItemId,
}: {
  timeline: Timeline;
  params: RawParams;
  /** The camp's civil day now, marked when it falls inside the span. */
  today: string;
  currentItemId: string | null;
}) {
  return (
    <div className={styles.timelineWrap}>
      <div className={styles.timeline} style={{ '--days': timeline.days.length } as React.CSSProperties}>
        <div className={styles.timelineHead}>
          <div className={styles.laneLabel}>נושא</div>
          <div className={styles.days} role="list" aria-label="ימים">
            {timeline.days.map((day) => (
              <div
                key={day.day}
                role="listitem"
                className={styles.dayHead}
                aria-current={day.day === today ? 'date' : undefined}
                aria-label={`${WEEKDAYS[day.weekday]}׳ ${shortDay(day.day)}`}
              >
                {day.monthStart ? <span className={styles.monthLabel}>{monthOf(day.day)}</span> : null}
                <span aria-hidden="true">{day.dayOfMonth}</span>
              </div>
            ))}
          </div>
        </div>
        {timeline.lanes.map((lane) => {
          const key = lane.topic?.id ?? 'none';
          const name = lane.topic?.name ?? 'בלי נושא';
          return (
            <div key={key} className={styles.lane}>
              <div className={styles.laneLabel}>
                {lane.topic === null ? name : <Link href={topicHref(params, lane.topic.id)}>{name}</Link>}
              </div>
              <div className={styles.barRows}>
                {packBars(lane.bars).map((row, index) => (
                  <div key={index} className={styles.barRow}>
                    {row.map((bar) => (
                      <Link
                        key={bar.item.id}
                        href={itemHref(params, bar.item.id)}
                        className={cx(
                          styles.bar,
                          bar.item.parentId !== null && styles.barSub,
                          bar.item.status === 'done' && styles.barDone,
                          bar.item.waitsFor.some((dep) => dep.conflict) && styles.barConflict,
                        )}
                        style={{ gridColumn: `${bar.start + 1} / span ${bar.span}` }}
                        aria-current={bar.item.id === currentItemId ? 'true' : undefined}
                        aria-label={barLabel(bar)}
                        title={barLabel(bar)}
                      >
                        {bar.item.title}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
