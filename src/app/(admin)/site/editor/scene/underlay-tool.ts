import type { ViewMode } from '@/lib/site/editor/camera';
import { isOnImage, type ImagePoint } from '@/lib/site/underlay';
import type { PointerInput } from './gestures';

/**
 * The picture's two tools as a pointer machine (spec §18.3–18.4), with no
 * `three`, no DOM and no store: pointer events in, intents out, as
 * `gestures.ts` is for items. The engine hands it the canvas's events while
 * the tool is 'calibrate' or 'align', and `Gestures` none of them.
 *
 * - Calibrating: a click is a point to mark (`pick`), a drag moves the view.
 *   Which clicks count is `classifyPick`'s, in the engine, which knows the
 *   picture and the screen.
 * - Aligning: a drag that starts on the picture moves it, freely, in whole
 *   centimetres, and saves once on release. A drag beside it moves the view.
 * - Either way the right button orbits in 3D and pans in plan, and the middle
 *   button pans, as they do for items.
 */

/** Two points marked nearer than this on screen are too close to measure a scale by (spec §18.3). */
export const CALIBRATION_MIN_PX = 20;
/** How far a press may wander and still be a click, as in `gestures.ts`. */
const CLICK_SLOP_PX = 4;
const YAW_PER_PX = 0.35;
const PITCH_PER_PX = 0.3;

export interface UnderlayWorld {
  tool(): 'calibrate' | 'align';
  mode(): ViewMode;
  groundAt(x: number, y: number): [number, number] | null;
  /** Whether the picture is drawn at this ground point. */
  onImage(ground: [number, number]): boolean;
}

export type UnderlayIntent =
  | { type: 'panBy'; dxCm: number; dyCm: number }
  | { type: 'orbitBy'; dYaw: number; dPitch: number }
  /** Calibrating: a click, where it was pressed on screen and on the ground. */
  | { type: 'pick'; x: number; y: number; ground: [number, number] }
  | { type: 'movePreview'; dxCm: number; dyCm: number }
  | { type: 'moveCommit'; dxCm: number; dyCm: number }
  | { type: 'cursor'; cursor: string };

type Point = { x: number; y: number };
type Drag =
  | { type: 'pan'; start: Point; grab: [number, number] | null; moved: boolean; pick: boolean }
  | { type: 'orbit'; last: Point }
  | { type: 'move'; start: Point; grab: [number, number]; moved: boolean; last: [number, number] };

function far(a: Point, b: Point, slop: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) >= slop;
}

export class UnderlayGestures {
  private drag: Drag | null = null;
  private cursor = '';

  constructor(private readonly world: UnderlayWorld) {}

  /** A drag is under way: the view counts as moving until it ends. */
  get active(): boolean {
    return this.drag !== null;
  }

  down(p: PointerInput): UnderlayIntent[] {
    const at = { x: p.x, y: p.y };
    this.drag = null;
    if (p.button === 2 || (p.button === 0 && p.ctrl)) {
      this.drag = this.world.mode() === '3d'
        ? { type: 'orbit', last: at }
        : { type: 'pan', start: at, grab: this.world.groundAt(p.x, p.y), moved: false, pick: false };
      return [];
    }
    if (p.button === 1) {
      this.drag = { type: 'pan', start: at, grab: this.world.groundAt(p.x, p.y), moved: false, pick: false };
      return [];
    }
    if (p.button !== 0) return [];
    const ground = this.world.groundAt(p.x, p.y);
    if (this.world.tool() === 'align' && ground !== null && this.world.onImage(ground)) {
      this.drag = { type: 'move', start: at, grab: ground, moved: false, last: [0, 0] };
      return [];
    }
    this.drag = { type: 'pan', start: at, grab: ground, moved: false, pick: this.world.tool() === 'calibrate' };
    return [];
  }

  move(p: PointerInput): UnderlayIntent[] {
    const drag = this.drag;
    const at = { x: p.x, y: p.y };
    if (drag === null) return this.hover(p);
    switch (drag.type) {
      case 'orbit': {
        const intent: UnderlayIntent = { type: 'orbitBy', dYaw: (p.x - drag.last.x) * YAW_PER_PX, dPitch: (p.y - drag.last.y) * PITCH_PER_PX };
        drag.last = at;
        return [intent];
      }
      case 'pan': {
        if (!drag.moved && !far(drag.start, at, CLICK_SLOP_PX)) return [];
        drag.moved = true;
        const ground = this.world.groundAt(p.x, p.y);
        if (drag.grab === null || ground === null) return [];
        // Keep the grabbed ground point under the pointer.
        return [{ type: 'panBy', dxCm: drag.grab[0] - ground[0], dyCm: drag.grab[1] - ground[1] }];
      }
      case 'move': {
        if (!drag.moved && !far(drag.start, at, CLICK_SLOP_PX)) return [];
        drag.moved = true;
        const ground = this.world.groundAt(p.x, p.y);
        if (ground !== null) drag.last = [Math.round(ground[0] - drag.grab[0]), Math.round(ground[1] - drag.grab[1])];
        return [{ type: 'movePreview', dxCm: drag.last[0], dyCm: drag.last[1] }];
      }
    }
  }

  up(p: PointerInput): UnderlayIntent[] {
    const drag = this.drag;
    this.drag = null;
    if (drag === null) return [];
    const settle = this.hover(p);
    if (drag.type === 'pan' && !drag.moved && drag.pick && drag.grab !== null) {
      return [{ type: 'pick', x: drag.start.x, y: drag.start.y, ground: drag.grab }, ...settle];
    }
    if (drag.type === 'move' && drag.moved) {
      const ground = this.world.groundAt(p.x, p.y);
      const [dxCm, dyCm] = ground === null
        ? drag.last
        : [Math.round(ground[0] - drag.grab[0]), Math.round(ground[1] - drag.grab[1])];
      return [{ type: 'moveCommit', dxCm, dyCm }, ...settle];
    }
    return settle;
  }

  /** The pointer was taken, the window lost focus, or the tool changed: nothing is saved, and the cursor is asked again. */
  cancel(): UnderlayIntent[] {
    this.drag = null;
    this.cursor = '';
    return [];
  }

  private hover(p: PointerInput): UnderlayIntent[] {
    let cursor = 'crosshair';
    if (this.world.tool() === 'align') {
      const ground = this.world.groundAt(p.x, p.y);
      cursor = ground !== null && this.world.onImage(ground) ? 'move' : 'default';
    }
    if (cursor === this.cursor) return [];
    this.cursor = cursor;
    return [{ type: 'cursor', cursor }];
  }
}

/**
 * A click while calibrating (spec §18.3): a point on the picture, a point
 * off it, or one nearer the first than `CALIBRATION_MIN_PX`, too close to
 * measure a scale by. `at` and `first` are in screen pixels.
 */
export function classifyPick(
  point: ImagePoint, at: { x: number; y: number }, first: { x: number; y: number } | null,
): 'point' | 'offImage' | 'tooClose' {
  if (!isOnImage(point)) return 'offImage';
  if (first !== null && Math.hypot(at.x - first.x, at.y - first.y) < CALIBRATION_MIN_PX) return 'tooClose';
  return 'point';
}
