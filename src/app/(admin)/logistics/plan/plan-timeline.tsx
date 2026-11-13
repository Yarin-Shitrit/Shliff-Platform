import type { CSSProperties } from 'react';
import Link from 'next/link';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { Avatar } from '@/components/ui/avatar';
import { ButtonLink } from '@/components/ui/button';
import {
  isOverdue, stepWindow, type Timeline, type TimelineBar, type TimelineDay, type TimelineWindow,
} from '@/lib/logistics/plan';
import {
  itemHref, scaleHref, topicHref, type RawParams, type TimelineScale,
} from '@/lib/logistics/plan-views';
import { TimelineScroll } from './timeline-scroll';
import styles from './plan.module.css';

/**
 * The scheduled items on their days, a lane per topic. A CSS grid of days
 * rather than a chart library (R1), and rather than an SVG: every bar is a
 * link, and a reader with a screen reader gets a list of links that each
 * say what they are and when.
 *
 * Three scales, each a URL: a week, a month, or everything. The week fills
 * the width it has, so a bar has room for its words; the month and the
 * whole span keep a narrow day and scroll sideways.
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
  week: 'שבוע',
  month: 'חודש',
  all: 'הכול',
};

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
 * whose parent is not drawn (undated, or on other days) still gets a block
 * of its own, headed by nothing, so the parts of one item stay together.
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

/** `14/05`, the short day a bar's link reads out. */
function shortDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** `7 במאי`, `2026` added when asked. */
function proseDay(day: string, withYear: boolean): string {
  const month = MONTHS[Number(day.slice(5, 7)) - 1];
  return `${Number(day.slice(8, 10))} ב${month}${withYear ? ` ${day.slice(0, 4)}` : ''}`;
}

/** What the window is called: `מאי 2026`, or `10–16 במאי 2026`, or `31 במאי – 6 ביוני 2026`. */
export function windowLabel(window: TimelineWindow): string {
  if (window.scale === 'month') {
    return `${MONTHS[Number(window.month!.slice(5, 7)) - 1]} ${window.month!.slice(0, 4)}`;
  }
  const { from, to } = window;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8, 10))}–${proseDay(to, true)}`;
  return `${proseDay(from, from.slice(0, 4) !== to.slice(0, 4))} – ${proseDay(to, true)}`;
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

function partsCount(count: number): string {
  return count === 1 ? 'חלק אחד' : `${count} חלקים`;
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
  const { window } = timeline;
  const scale: TimelineScale = window?.scale ?? 'all';
  const todayIndex = timeline.days.find((day) => day.day === today)?.index ?? -1;
  const vars = { '--days': timeline.days.length, '--today': todayIndex } as CSSProperties;
  const roomy = scale === 'week';
  /* A month's padding days — the end of the month before, the start of the
     one after — are drawn dimmer, so the month reads as the month. */
  const monthKey = window?.month ?? null;

  return (
    <>
      <div className={styles.timelineTools}>
        <span className={styles.scaleSwitch} role="group" aria-label="קנה מידה">
          {(['week', 'month', 'all'] as const).map((option) => (
            <Link
              key={option}
              href={scaleHref(params, option, option === 'all' ? null : window?.at ?? today)}
              className={cx(styles.scaleOption, option === scale && styles.scaleCurrent)}
              aria-current={option === scale ? 'true' : undefined}
            >
              {SCALE_LABELS[option]}
            </Link>
          ))}
        </span>
        {window === null ? (
          todayIndex >= 0 ? <TimelineScroll wrapperId={TIMELINE_WRAP_ID} todayId={TODAY_CELL_ID} /> : null
        ) : (
          <span className={styles.windowNav}>
            <ButtonLink
              size="sm"
              tone="ghost"
              href={scaleHref(params, window.scale, stepWindow(window, -1))}
              iconLabel={window.scale === 'week' ? 'השבוע הקודם' : 'החודש הקודם'}
            >
              <Icon name="right" size={16} />
            </ButtonLink>
            <span className={styles.windowLabel}><bdi>{windowLabel(window)}</bdi></span>
            <ButtonLink
              size="sm"
              tone="ghost"
              href={scaleHref(params, window.scale, stepWindow(window, 1))}
              iconLabel={window.scale === 'week' ? 'השבוע הבא' : 'החודש הבא'}
            >
              <Icon name="left" size={16} />
            </ButtonLink>
            {todayIndex >= 0 ? null : (
              <ButtonLink size="sm" tone="ghost" href={scaleHref(params, window.scale, today)}>
                <Icon name="calendar" size={14} />
                היום
              </ButtonLink>
            )}
          </span>
        )}
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
              <div className={styles.months} aria-hidden="true">
                {monthBands(timeline.days).map((band) => (
                  <span key={band.key} className={styles.month} style={{ gridColumn: `span ${band.span}` }}>
                    {band.label}
                  </span>
                ))}
              </div>
              <div className={styles.days} role="list" aria-label="ימים">
                {timeline.days.map((day) => {
                  const outside = monthKey !== null && day.day.slice(0, 7) !== monthKey;
                  return (
                    <div
                      key={day.day}
                      id={day.day === today ? TODAY_CELL_ID : undefined}
                      role="listitem"
                      className={cx(styles.dayHead, outside && styles.dayOutside)}
                      aria-current={day.day === today ? 'date' : undefined}
                      aria-label={`${WEEKDAYS[day.weekday]}׳ ${shortDay(day.day)}`}
                    >
                      <span className={styles.weekday} aria-hidden="true">{WEEKDAYS[day.weekday]}</span>
                      <span className={styles.dayNumber} aria-hidden="true">{day.dayOfMonth}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {timeline.lanes.length === 0 && window !== null ? (
            <p className={styles.windowEmpty}>
              <bdi>
                {window.scale === 'week' ? 'אין משימה על הימים של השבוע הזה. ' : 'אין משימה על הימים של החודש הזה. '}
                {timeline.scheduled === 1
                  ? 'המשימה היחידה שיש לה יום נמצאת על ימים אחרים'
                  : `${timeline.scheduled} המשימות שיש להן יום נמצאות על ימים אחרים`}
              </bdi>
              {' · '}
              <Link href={scaleHref(params, 'all')}>לתצוגה של הכול</Link>
            </p>
          ) : null}
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
                                      bar.clippedStart && styles.barClipStart,
                                      bar.clippedEnd && styles.barClipEnd,
                                    )}
                                    style={{ gridColumn: `${bar.start + 1} / span ${bar.span}` }}
                                    aria-current={item.id === currentItemId ? 'true' : undefined}
                                    aria-label={barLabel(bar, today)}
                                    title={barLabel(bar, today)}
                                  >
                                    {bar.clippedStart ? <Icon name="more" size={14} /> : null}
                                    {done ? <Icon name="check" size={14} /> : null}
                                    {!done && overdue ? <Icon name="alert" size={14} /> : null}
                                    {isPart && (roomy || bar.span >= 2) ? <Icon name="enter" size={14} /> : null}
                                    <span className={styles.barTitle}>
                                      {item.title}
                                      {isPart && roomy && bar.parentTitle !== undefined ? (
                                        <span className={styles.barMeta}>{` · ${bar.parentTitle}`}</span>
                                      ) : null}
                                    </span>
                                    {partsHere > 0 && (roomy || bar.span >= 2) ? (
                                      <span className={styles.barCount}>{partsCount(partsHere)}</span>
                                    ) : null}
                                    {item.assignee === null || (!roomy && bar.span < 3) ? null : (
                                      <span className={styles.barWho}>
                                        <Avatar name={item.assignee.displayName} size="sm" decorative />
                                        {roomy ? <span className={styles.barWhoName}>{item.assignee.displayName}</span> : null}
                                      </span>
                                    )}
                                    {bar.clippedEnd ? <Icon name="more" size={14} /> : null}
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
