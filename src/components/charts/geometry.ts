/**
 * Direction-aware chart geometry.
 *
 * The rest of this codebase banned `left`/`right` in CSS and moved to logical
 * properties (`margin-inline`, `text-align: start/end`) so RTL and LTR mirror
 * for free. SVG has no such thing: `<rect x="0">` is on the left in every
 * locale, and `text-anchor="start"` means left regardless of `dir`. Every
 * function below does by arithmetic what CSS does automatically, which is
 * exactly why a direction bug here compiles, type-checks, and passes a
 * careless test while still drawing a bar growing the wrong way in the
 * browser. These functions take no DOM and no database input on purpose, so
 * that mirroring bug is something a unit test can actually catch.
 *
 * Inputs are agorot (integer money), but the outputs are pixel geometry, not
 * money — the division below is presentation math (a fraction of a track
 * width), not currency arithmetic, so routing it through src/lib/money.ts
 * would be the wrong tool for the job.
 */

export type Direction = 'rtl' | 'ltr';

export interface BarInput {
  valueAgorot: number;
  maxAgorot: number;
  width: number;
  direction: Direction;
}

export interface Box {
  x: number;
  width: number;
}

/**
 * A single bar's box within a `width`-px track.
 *
 * In `rtl` the bar hangs off the right edge and grows leftward (the
 * inline-start edge in Hebrew is the right), so `x` is `width - barWidth`
 * rather than `0`. Getting this backwards draws every bar growing away from
 * the axis instead of toward it — a chart that reads correctly at a glance
 * only in LTR screenshots.
 *
 * Two guards:
 * - `maxAgorot > 0` avoids `value / 0`, which is `NaN` in JS and would send
 *   `NaN` into an SVG `x`/`width` attribute — a category with no budget yet
 *   allocated must render as an empty track, not a broken one.
 * - The ratio is clamped to `[0, 1]` so a value that overshoots its maximum
 *   (over-budget spending, a debt bigger than the plan) draws a full-width
 *   bar instead of overflowing past the edge of its own track.
 */
export function barGeometry(input: BarInput): Box {
  const ratio = input.maxAgorot > 0
    ? Math.min(1, Math.max(0, input.valueAgorot / input.maxAgorot))
    : 0;
  const width = ratio * input.width;
  return {
    x: input.direction === 'rtl' ? input.width - width : 0,
    width,
  };
}

export interface StackInput {
  segmentsAgorot: number[];
  totalAgorot: number;
  width: number;
  direction: Direction;
  /** Surface-coloured gap, in px, painted between adjacent segments. */
  gap: number;
}

/**
 * Boxes for a horizontally stacked bar (e.g. paid / owed / overdue as one
 * bar), laid out from the start edge with a gap between neighbours.
 *
 * The gap is subtracted from each segment's own width rather than inserted
 * as extra spacing, so the stack's total footprint still equals `width`
 * instead of overflowing past the track by `gap * segmentCount`. Skipping
 * the subtraction makes adjacent segments touch with no visible seam — two
 * different amounts read as one solid block, which is the exact failure a
 * stacked bar exists to prevent.
 *
 * Each ratio is clamped to `[0, 1]` on its own below, but the segments can
 * still sum past `totalAgorot` — `money/page.tsx` passes exactly
 * `[duesCoverAgorot, fundingTargetAgorot]` against `budgetTotalAgorot`, and a
 * funding target set before a budget cut makes that sum exceed the budget in
 * ordinary operation, not as an edge case. Clamping only the per-segment
 * ratio still let the *cumulative* offset run past `width`, drawing a later
 * segment's `x` negative (in `rtl`) — outside the track it is meant to be
 * drawn on. `roomLeft` below clamps what track remains instead, so a segment
 * that would spill over shrinks to fit rather than escaping the track.
 *
 * A segment whose share is narrower than the gap renders at zero width (the
 * pre-existing `Math.max(0, ...)` on the line below) — but `offset` still
 * advances by that segment's full, un-gapped share. This is deliberate, not
 * an oversight the room-clamp happened to leave standing: `offset` tracks
 * each segment's true proportional territory on the track, and the gap is a
 * rendering-only inset. Making a zero-width sliver also consume zero offset
 * would shift every later segment left by the sliver's true share, which is
 * a layout lie in the opposite direction — later segments would then start
 * as if the sliver's amount did not exist at all.
 */
export function stackGeometry(input: StackInput): Box[] {
  const boxes: Box[] = [];
  let offset = 0;

  for (const segment of input.segmentsAgorot) {
    const ratio = input.totalAgorot > 0
      ? Math.min(1, Math.max(0, segment / input.totalAgorot))
      : 0;
    const rawWidth = Math.max(0, ratio * input.width - input.gap);
    const roomLeft = Math.max(0, input.width - offset);
    const width = Math.min(rawWidth, roomLeft);
    boxes.push({
      x: input.direction === 'rtl' ? input.width - offset - width : offset,
      width,
    });
    offset = Math.min(input.width, offset + ratio * input.width);
  }

  return boxes;
}

export interface LineInput {
  values: number[];
  width: number;
  height: number;
  direction: Direction;
}

/**
 * Points for a polyline chart (e.g. balance over time).
 *
 * `x` mirrors like the bar: in `rtl` the first (earliest) value sits on the
 * right and later values run leftward, matching how a Hebrew reader scans a
 * timeline. `y` is inverted regardless of direction — SVG's y-axis grows
 * downward, so plotting a value directly would put the largest number at the
 * bottom of the chart, upside down from every other chart on the page.
 */
export function linePoints(input: LineInput): Array<{ x: number; y: number }> {
  const count = input.values.length;
  if (count === 0) return [];

  const max = Math.max(...input.values);
  const min = Math.min(...input.values);
  const span = max - min || 1;
  const step = count > 1 ? input.width / (count - 1) : 0;

  return input.values.map((value, index) => {
    const progress = index * step;
    return {
      x: input.direction === 'rtl' ? input.width - progress : progress,
      y: input.height - ((value - min) / span) * input.height,
    };
  });
}

/**
 * `text-anchor` for a label glued to a chart's start edge (an axis label, a
 * bar's value). `'start'` is left in SVG no matter the page's direction, so
 * using it unconditionally in Hebrew right-aligns nothing — labels drift off
 * the right edge of the chart instead of hugging it.
 */
export function textAnchorFor(direction: Direction): 'start' | 'end' {
  return direction === 'rtl' ? 'end' : 'start';
}
