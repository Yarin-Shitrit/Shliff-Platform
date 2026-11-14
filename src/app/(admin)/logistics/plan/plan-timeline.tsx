import type { CSSProperties } from 'react';
import Link from 'next/link';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { Avatar } from '@/components/ui/avatar';
import {
  isOverdue, type Timeline, type TimelineBar, type TimelineDay,
} from '@/lib/logistics/plan';
import {
  itemHref, scaleHref, topicHref, TIMELINE_SCALES, type RawParams, type TimelineScale,
} from '@/lib/logistics/plan-views';
import { TimelineScroll } from './timeline-scroll';
import styles from './plan.module.css';

/**
 * The scheduled items on their days, a lane per topic. A CSS grid of days
 * rather than a chart library (R1), and rather than an SVG: every bar is a
 * link, and a reader with a screen reader gets a list of links that each
 * say what they are and when.
 *
 * Three resolutions, each a URL, all over the whole plan: a column a day,
 * a column a week, a column a month. The scale changes how wide a day is
 * drawn and what the header counts in — never which days are shown — so
 * at ״חודשים״ a season's preparation fits one screen and reads as a plan,
 * and at ״ימים״ a bar has room for its words. A bar always starts and ends
 * on its own days, whatever the header counts in.
 *
 * Each lane wears its topic's colour — on the label, on the general item's
 * solid bar, as the tint of its parts — so the eye can tell the kitchen's
 * bars from the lounge's across the page without reading the labels. The
 * colour is never alone: the name is on the lane (R3).
 *
 * A general item and its parts are one block: the summary bar, then the
 * parts packed under it with a guide line down from the summary's first
 * day, so the eye reads "the kitchen container, made of these five". Bars
 * that overlap in time share a block but not a row — `packBars` gives each
 * one the first row it fits in.
 */

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

export const TIMELINE_WRAP_ID = 'plan-timeline-wrap';
export const TODAY_CELL_ID = 'plan-timeline-today';

export const SCALE_LABELS: Record<TimelineScale, string> = {
  day: 'ימים',
  week: 'שבועות',
  month: 'חודשים',
};

/**
 * How many day-columns a bar needs before it has room for more than its
 * title, per scale: a day is drawn narrower at ״שבועות״ and narrower again
 * at ״חודשים״, so the same icon needs more days under it.
 */
const ROOM: Record<TimelineScale, number> = { day: 1, week: 3, month: 8 };

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

export interface LaneBlock {
  /** The general item's own bar, when it has days inside the span. */
  parent: TimelineBar | null;
  /** The id the parts share; null for the block of items with no parts. */
  parentId: string | null;
  /** The parts, packed into rows. Empty for a general item drawn alone. */
  parts: TimelineBar[][];
}

/**
 * The lane's blocks: first every general item that has no part on the
 * lane, packed together into as few rows as they fit; then one block per
 * general item with parts — its summary bar, its parts under it. A part
 * whose parent is not drawn (undated) still gets a block of its own,
 * headed by nothing, so the parts of one item stay together.
 */
export function laneBlocks(bars: readonly TimelineBar[]): LaneBlock[] {
  const parents = new Map<string, TimelineBar>();
  const parts = new Map<string, TimelineBar[]>();
  const order: string[] = [];
  for (const bar of bars) {
    if (bar.item.parentId === null) {
      parents.set(bar.item.id, bar);
      if (!order.includes(bar.item.id)) order.push(bar.item.id);
    } else {
      const list = parts.get(bar.item.parentId) ?? [];
      list.push(bar);
      parts.set(bar.item.parentId, list);
      if (!order.includes(bar.item.parentId)) order.push(bar.item.parentId);
    }
  }
  const alone = order.filter((id) => parents.has(id) && !parts.has(id)).map((id) => parents.get(id)!);
  const blocks: LaneBlock[] = [];
  if (alone.length > 0) blocks.push({ parent: null, parentId: null, parts: packBars(alone) });
  for (const id of order) {
    if (!parts.has(id)) continue;
    blocks.push({ parent: parents.get(id) ?? null, parentId: id, parts: packBars(parts.get(id)!) });
  }
  return blocks;
}

/** The blocks flattened to rows, for a reader that only needs the order. */
export function laneRows(bars: readonly TimelineBar[]): TimelineBar[][] {
  return laneBlocks(bars).flatMap((block) => (block.parent === null ? block.parts : [[block.parent], ...block.parts]));
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

export interface WeekCell {
  /** The week's first day on the timeline — a Sunday, since the span starts on one. */
  from: string;
  /** Its last day drawn: the Saturday, or the span's last day. */
  to: string;
  /** Day-columns it covers; seven, except a last week the span cuts short. */
  span: number;
}

/** The days in sevens from the first column, for the header that counts in weeks. */
export function weekCells(days: readonly TimelineDay[]): WeekCell[] {
  const cells: WeekCell[] = [];
  for (let index = 0; index < days.length; index += 7) {
    const week = days.slice(index, index + 7);
    cells.push({ from: week[0].day, to: week[week.length - 1].day, span: week.length });
  }
  return cells;
}

/** `14/05`, the short day a bar's link reads out. */
function shortDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function barLabel(bar: TimelineBar, today: string): string {
  const { item } = bar;
  const last = item.endsOn ?? item.startsOn!;
  const when = last === item.startsOn ? shortDay(item.startsOn!) : `${shortDay(item.startsOn!)}–${shortDay(last)}`;
  const part = bar.parentTitle === undefined ? '' : ` · חלק של ${bar.parentTitle}`;
  const who = item.assignee === null ? '' : ` · ${item.assignee.displayName}`;
  const state = item.status === 'done' ? ' · הושלמה' : isOverdue(item, today) ? ' · עבר התאריך' : '';
  return `${item.title}${part} · ${when}${who}${state}`;
}

/**
 * What a general item's bar says about its parts: how many it has — the
 * same number the list writes beside it — and, when the timeline draws
 * fewer than that, how many. A part with no day or a cancelled one is not
 * a bar, and a count of the bars alone read as a different item from the
 * list's.
 */
function partsCount(total: number, placed: number): string {
  const all = total === 1 ? 'חלק אחד' : `${total} חלקים`;
  if (placed >= total) return all;
  return placed === 0 ? `${all} · אף אחד לא על הציר` : `${all} · ${placed} על הציר`;
}

export function PlanTimeline({
  timeline, scale, params, today, currentItemId,
}: {
  timeline: Timeline;
  /** What a column of the header is: a day, a week or a month. */
  scale: TimelineScale;
  params: RawParams;
  /** The camp's civil day now, marked when it falls inside the span. */
  today: string;
  currentItemId: string | null;
}) {
  const todayIndex = timeline.days.find((day) => day.day === today)?.index ?? -1;
  const vars = { '--days': timeline.days.length, '--today': todayIndex } as CSSProperties;
  const room = ROOM[scale];
  const thisMonth = today.slice(0, 7);
  /* The year, wherever the month alone would be ambiguous: at ״חודשים״ the
     band is the only header there is, and a plan can run over a new year. */
  const years = new Set(timeline.days.map((day) => day.day.slice(0, 4)));
  const withYear = scale === 'month' || years.size > 1;

  return (
    <>
      <div className={styles.timelineTools}>
        <span className={styles.scaleSwitch} role="group" aria-label="רזולוציה">
          {TIMELINE_SCALES.map((option) => (
            <Link
              key={option}
              href={scaleHref(params, option)}
              className={cx(styles.scaleOption, option === scale && styles.scaleCurrent)}
              aria-current={option === scale ? 'true' : undefined}
            >
              {SCALE_LABELS[option]}
            </Link>
          ))}
        </span>
        {/*
          Keyed by the scale: a scale link changes only the query string, so
          the page re-renders in place and this would stay mounted, its
          centring already spent — leaving the scroll offset of the old
          column width, and today off the screen. A new key centres again.
        */}
        {todayIndex >= 0 ? <TimelineScroll key={scale} wrapperId={TIMELINE_WRAP_ID} todayId={TODAY_CELL_ID} /> : null}
        <span className={styles.legend} aria-hidden="true">
          <span className={cx(styles.legendSwatch, styles.legendParent)} /> משימה כללית
          <span className={cx(styles.legendSwatch, styles.legendPart)} /> חלק
          <span className={cx(styles.legendSwatch, styles.legendDone)} /> הושלמה
          <span className={cx(styles.legendSwatch, styles.legendConflict)} /> סותרת סדר
        </span>
      </div>
      <div className={styles.timelineWrap} id={TIMELINE_WRAP_ID}>
        <div
          className={cx(
            styles.timeline,
            todayIndex >= 0 && styles.hasToday,
            scale === 'week' && styles.scaleWeek,
            scale === 'month' && styles.scaleMonth,
          )}
          style={vars}
        >
          <div className={styles.timelineHead}>
            <div className={cx(styles.laneLabel, styles.cornerLabel)}>נושא</div>
            <div className={styles.headCols}>
              {/*
                The months are the header's top band at every scale, and at
                ״חודשים״ they are all of it — a list then, since they are the
                columns, with this month marked.
              */}
              <div
                className={styles.months}
                role={scale === 'month' ? 'list' : undefined}
                aria-label={scale === 'month' ? 'חודשים' : undefined}
                aria-hidden={scale === 'month' ? undefined : 'true'}
              >
                {monthBands(timeline.days).map((band) => {
                  const label = withYear ? `${band.label} ${band.key.slice(0, 4)}` : band.label;
                  const current = scale === 'month' && todayIndex >= 0 && band.key === thisMonth;
                  return (
                    <span
                      key={band.key}
                      id={current ? TODAY_CELL_ID : undefined}
                      role={scale === 'month' ? 'listitem' : undefined}
                      aria-current={current ? 'date' : undefined}
                      className={cx(styles.month, scale === 'month' && styles.monthCell)}
                      style={{ gridColumn: `span ${band.span}` }}
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
              {scale === 'day' ? (
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
              ) : null}
              {scale === 'week' ? (
                <div className={styles.days} role="list" aria-label="שבועות">
                  {weekCells(timeline.days).map((week) => {
                    const current = today >= week.from && today <= week.to;
                    return (
                      <div
                        key={week.from}
                        id={current ? TODAY_CELL_ID : undefined}
                        role="listitem"
                        className={cx(styles.dayHead, styles.weekHead)}
                        style={{ gridColumn: `span ${week.span}` }}
                        aria-current={current ? 'date' : undefined}
                        aria-label={`שבוע ${shortDay(week.from)}–${shortDay(week.to)}`}
                      >
                        <span className={styles.dayNumber} aria-hidden="true">{shortDay(week.from)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
          {timeline.lanes.map((lane) => {
            const key = lane.topic?.id ?? 'none';
            const name = lane.topic?.name ?? 'בלי נושא';
            return (
              <div key={key} className={cx(styles.lane, lane.hue !== null && styles[`hue${lane.hue}`])}>
                <div className={styles.laneLabel}>
                  <span className={styles.laneName}>
                    <i className={styles.topicDot} aria-hidden="true" />
                    {lane.topic === null ? name : <Link href={topicHref(params, lane.topic.id)}>{name}</Link>}
                  </span>
                  <span className={styles.laneCount}>{lane.bars.length === 1 ? 'משימה אחת' : `${lane.bars.length} משימות`}</span>
                </div>
                <div className={styles.barRows}>
                  {laneBlocks(lane.bars).map((block, blockIndex) => {
                    const rows = block.parent === null ? block.parts : [[block.parent], ...block.parts];
                    const guideAt = block.parent?.start ?? null;
                    return (
                      <div key={block.parentId ?? `alone-${blockIndex}`} className={cx(styles.block, block.parentId !== null && styles.blockBranch)}>
                        {rows.map((row, rowIndex) => {
                          const partRow = block.parentId !== null && (block.parent === null || rowIndex > 0);
                          return (
                            <div key={rowIndex} className={cx(styles.barRow, partRow && styles.partRow)}>
                              {partRow && guideAt !== null ? (
                                <i className={styles.partGuide} aria-hidden="true" style={{ gridColumn: `${guideAt + 1} / span 1` }} />
                              ) : null}
                              {row.map((bar) => {
                                const { item } = bar;
                                const done = item.status === 'done';
                                const conflict = item.waitsFor.some((dep) => dep.conflict);
                                const overdue = isOverdue(item, today);
                                const isPart = item.parentId !== null;
                                const partsHere = isPart ? 0 : block.parentId === item.id ? block.parts.flat().length : 0;
                                const partsInAll = isPart ? 0 : Math.max(bar.parts ?? 0, partsHere);
                                return (
                                  <Link
                                    key={item.id}
                                    href={itemHref(params, item.id)}
                                    className={cx(
                                      styles.bar,
                                      isPart ? styles.barPart : styles.barParent,
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
                                    {isPart && bar.span >= 2 * room ? <Icon name="enter" size={14} /> : null}
                                    <span className={styles.barTitle}>{item.title}</span>
                                    {partsInAll > 0 && bar.span >= 2 * room ? (
                                      <span className={styles.barCount}>{partsCount(partsInAll, partsHere)}</span>
                                    ) : null}
                                    {item.assignee === null || bar.span < 3 * room ? null : (
                                      <span className={styles.barWho}>
                                        <Avatar name={item.assignee.displayName} size="sm" decorative />
                                      </span>
                                    )}
                                  </Link>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
