import { resize, snap, wholeCm, type Handle, type Plot, type Rect } from '../geometry';

/**
 * Where a dragged selection lands (spec §8). The selection's box snaps to
 * the grid first; then, if an edge or middle of the box passes within
 * `thresholdCm` of an edge or middle of another item or of the plot, it
 * takes that line instead, and a guide is drawn along it. The caller turns
 * the threshold from pixels into centimetres (`pxPerCm`), so the pull feels
 * the same at every zoom. Alt-drag is `free`: no grid, no lines, whole
 * centimetres only.
 */

export interface GuideLine {
  from: [number, number];
  to: [number, number];
}

export interface SnapInput {
  moving: Rect;
  others: readonly Rect[];
  plot: Plot;
  dxCm: number;
  dyCm: number;
  gridCm: number;
  thresholdCm: number;
  free: boolean;
}

export interface SnapResult {
  dxCm: number;
  dyCm: number;
  guides: GuideLine[];
}

/** How far a guide runs past the two things it lines up, so it reads as a line and not a tick. */
const GUIDE_OVERSHOOT_CM = 60;

/** A line something could snap to, and the stretch of the other axis its owner covers. */
interface Line {
  at: number;
  from: number;
  to: number;
}

/** The nearest line to any of the box's two edges or its middle, within the threshold. Ties go to the first found. */
function nearest(lines: readonly Line[], start: number, size: number, threshold: number): { shift: number; line: Line } | null {
  let found: { shift: number; line: Line } | null = null;
  for (const offset of [0, size / 2, size]) {
    for (const line of lines) {
      const shift = line.at - (start + offset);
      if (Math.abs(shift) < threshold && (found === null || Math.abs(shift) < Math.abs(found.shift))) {
        found = { shift, line };
      }
    }
  }
  return found;
}

export function snapMove(input: SnapInput): SnapResult {
  const { moving, others, plot, dxCm, dyCm, gridCm, thresholdCm, free } = input;
  if (free) return { dxCm: wholeCm(dxCm), dyCm: wholeCm(dyCm), guides: [] };

  let x = snap(moving.x + dxCm, gridCm);
  let y = snap(moving.y + dyCm, gridCm);

  const columns: Line[] = [0, plot.widthCm / 2, plot.widthCm].map((at) => ({ at, from: 0, to: plot.depthCm }));
  const rows: Line[] = [0, plot.depthCm / 2, plot.depthCm].map((at) => ({ at, from: 0, to: plot.widthCm }));
  for (const other of others) {
    for (const at of [other.x, other.x + other.width / 2, other.x + other.width]) {
      columns.push({ at, from: other.y, to: other.y + other.depth });
    }
    for (const at of [other.y, other.y + other.depth / 2, other.y + other.depth]) {
      rows.push({ at, from: other.x, to: other.x + other.width });
    }
  }

  const column = nearest(columns, x, moving.width, thresholdCm);
  const row = nearest(rows, y, moving.depth, thresholdCm);
  if (column !== null) x += column.shift;
  if (row !== null) y += row.shift;

  const guides: GuideLine[] = [];
  if (column !== null) {
    guides.push({
      from: [column.line.at, Math.min(y, column.line.from) - GUIDE_OVERSHOOT_CM],
      to: [column.line.at, Math.max(y + moving.depth, column.line.to) + GUIDE_OVERSHOOT_CM],
    });
  }
  if (row !== null) {
    guides.push({
      from: [Math.min(x, row.line.from) - GUIDE_OVERSHOOT_CM, row.line.at],
      to: [Math.max(x + moving.width, row.line.to) + GUIDE_OVERSHOOT_CM, row.line.at],
    });
  }
  return { dxCm: wholeCm(x - moving.x), dyCm: wholeCm(y - moving.y), guides };
}

/** A handle drag: the opposite edge stays, the dragged edge snaps to the grid (or to whole centimetres when free), never under 10 cm. */
export function snapResize(rect: Rect, handle: Handle, dxCm: number, dyCm: number, gridCm: number, free: boolean): Rect {
  return resize(rect, handle, dxCm, dyCm, free ? 0 : gridCm);
}
