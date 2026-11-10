import type { CSSProperties } from 'react';
import Link from 'next/link';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { Avatar } from '@/components/ui/avatar';
import { isOverdue, type Timeline, type TimelineBar, type TimelineDay } from '@/lib/logistics/plan';
import { itemHref, topicHref, type RawParams } from '@/lib/logistics/plan-views';
import { TimelineScroll } from './timeline-scroll';
import styles from './plan.module.css';

/**
 * The scheduled items on their days, a lane per topic. A CSS grid of days
 * rather than a chart library (R1), and rather than an SVG: every bar is a
 * link, and a reader with a screen reader gets a list of links that each
 * say what they are and when.
 *
 * Bars that overlap in time share a lane but not a row — `packBars` gives
 * each one the first row it fits in, so two parts of one item running the
 * same week sit one under the other instead of on top of each other. A
 * general item is drawn as a summary bar, its parts under it in the same
 * lane, so the eye reads "the kitchen container, made of these five".
 */

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

export const TIMELINE_WRAP_ID = 'plan-timeline-wrap';
export const TODAY_CELL_ID = 'plan-timeline-today';

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

/**
 * The lane's rows: the general items first, each a summary bar, then the
 * parts packed under them. A lane with parts of two items shows both
 * summaries at the top and the parts below — the alternative, one block
 * per item, would make the lanes tall and the summaries hard to compare.
 */
export function laneRows(bars: readonly TimelineBar[]): TimelineBar[][] {
  const parents = bars.filter((bar) => bar.item.parentId === null);
  const parts = bars.filter((bar) => bar.item.parentId !== null);
  return [...packBars(parents), ...packBars(parts)];
}

export interface MonthBand { label: string; span: number; key: string }

/** Consecutive days of one month, for the band above the day numbers. */
export function monthBands(days: readonly TimelineDay[]): MonthBand[] {
  const bands: MonthBand[] = [];
  for (const day of days) {
    const key = day.day.slice(0, 7);
    const last = bands[bands.length - 1];
    if (last && last.key === key) last.span += 1;
    else bands.push({ key, label: MONTHS[Number(day.day.slice(5, 7)) - 1], span: 1 });
  }
  return bands;
}

/** `14/05`, the short day a bar's link reads out. */
function shortDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function barLabel(bar: TimelineBar, today: string): string {
  const { item } = bar;
  const last = item.endsOn ?? item.startsOn!;
  const when = last === item.startsOn ? shortDay(item.startsOn!) : `${shortDay(item.startsOn!)}–${shortDay(last)}`;
  const who = item.assignee === null ? '' : ` · ${item.assignee.displayName}`;
  const state = item.status === 'done' ? ' · הושלמה' : isOverdue(item, today) ? ' · עבר התאריך' : '';
  return `${item.title} · ${when}${who}${state}`;
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
  const todayIndex = timeline.days.find((day) => day.day === today)?.index ?? -1;
  const vars = { '--days': timeline.days.length, '--today': todayIndex } as CSSProperties;

  return (
    <>
      <div className={styles.timelineTools}>
        {todayIndex >= 0 ? <TimelineScroll wrapperId={TIMELINE_WRAP_ID} todayId={TODAY_CELL_ID} /> : null}
        <span className={styles.legend} aria-hidden="true">
          <span className={cx(styles.legendSwatch, styles.legendParent)} /> משימה כללית
          <span className={cx(styles.legendSwatch, styles.legendPart)} /> חלק
          <span className={cx(styles.legendSwatch, styles.legendDone)} /> הושלמה
          <span className={cx(styles.legendSwatch, styles.legendConflict)} /> סותרת סדר
        </span>
      </div>
      <div className={styles.timelineWrap} id={TIMELINE_WRAP_ID}>
        <div className={cx(styles.timeline, todayIndex >= 0 && styles.hasToday)} style={vars}>
          <div className={styles.timelineHead}>
            <div className={cx(styles.laneLabel, styles.cornerLabel)}>נושא</div>
            <div className={styles.headCols}>
              <div className={styles.months} aria-hidden="true">
                {monthBands(timeline.days).map((band) => (
                  <span key={band.key} className={styles.month} style={{ gridColumn: `span ${band.span}` }}>
                    {band.label}
                  </span>
                ))}
              </div>
              <div className={styles.days} role="list" aria-label="ימים">
                {timeline.days.map((day) => (
                  <div
                    key={day.day}
                    id={day.day === today ? TODAY_CELL_ID : undefined}
                    role="listitem"
                    className={styles.dayHead}
                    aria-current={day.day === today ? 'date' : undefined}
                    aria-label={`${WEEKDAYS[day.weekday]}׳ ${shortDay(day.day)}`}
                  >
                    <span className={styles.weekday} aria-hidden="true">{WEEKDAYS[day.weekday]}</span>
                    <span className={styles.dayNumber} aria-hidden="true">{day.dayOfMonth}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {timeline.lanes.map((lane) => {
            const key = lane.topic?.id ?? 'none';
            const name = lane.topic?.name ?? 'בלי נושא';
            return (
              <div key={key} className={styles.lane}>
                <div className={styles.laneLabel}>
                  {lane.topic === null ? name : <Link href={topicHref(params, lane.topic.id)}>{name}</Link>}
                  <span className={styles.laneCount}>{lane.bars.length === 1 ? 'משימה אחת' : `${lane.bars.length} משימות`}</span>
                </div>
                <div className={styles.barRows}>
                  {laneRows(lane.bars).map((row, index) => (
                    <div key={index} className={styles.barRow}>
                      {row.map((bar) => {
                        const { item } = bar;
                        const done = item.status === 'done';
                        const conflict = item.waitsFor.some((dep) => dep.conflict);
                        const overdue = isOverdue(item, today);
                        return (
                          <Link
                            key={item.id}
                            href={itemHref(params, item.id)}
                            className={cx(
                              styles.bar,
                              item.parentId === null ? styles.barParent : styles.barPart,
                              done && styles.barDone,
                              conflict && styles.barConflict,
                              overdue && styles.barOverdue,
                            )}
                            style={{ gridColumn: `${bar.start + 1} / span ${bar.span}` }}
                            aria-current={item.id === currentItemId ? 'true' : undefined}
                            aria-label={barLabel(bar, today)}
                            title={barLabel(bar, today)}
                          >
                            {done ? <Icon name="check" size={14} /> : null}
                            {!done && overdue ? <Icon name="alert" size={14} /> : null}
                            <span className={styles.barTitle}>{item.title}</span>
                            {item.assignee === null || bar.span < 3 ? null : (
                              <span className={styles.barWho}>
                                <Avatar name={item.assignee.displayName} size="sm" decorative />
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
