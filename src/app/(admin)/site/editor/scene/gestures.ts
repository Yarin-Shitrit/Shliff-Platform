import type { ScreenBox, ViewMode } from '@/lib/site/editor/camera';
import type { Handle } from '@/lib/site/geometry';

/**
 * The pointer half of spec §8's mouse table, as a state machine with no
 * `three`, no DOM and no store: pointer events in, intents out. `SceneView`
 * answers the world's questions (what is under this pixel, where is the
 * ground) and carries the intents out — snapping, previews, commits.
 *
 * Coordinates are CSS pixels from the canvas's top-left; ground points are
 * map centimetres. Wheel, double-click and the library's drag are not pointer
 * drags on the canvas and are handled by `SceneView` itself.
 */

export interface PointerInput { x: number; y: number; button: number; shift: boolean; meta: boolean; ctrl: boolean; alt: boolean }

export interface GestureWorld {
  tool(): 'select' | 'measure';
  mode(): ViewMode;
  handleAt(x: number, y: number): Handle | null;
  labelAt(x: number, y: number): { ids: string[]; group: boolean } | null;
  itemAt(x: number, y: number): { id: string; isNet: boolean; locked: boolean } | null;
  groundAt(x: number, y: number): [number, number] | null;
  selection(): readonly string[];
}

export type GestureIntent =
  | { type: 'select'; ids: string[] } | { type: 'toggleSelect'; id: string } | { type: 'clearSelection' }
  | { type: 'panBy'; dxCm: number; dyCm: number } | { type: 'orbitBy'; dYaw: number; dPitch: number }
  | { type: 'movePreview'; ids: string[]; dxCm: number; dyCm: number; free: boolean }
  | { type: 'moveCommit'; ids: string[]; dxCm: number; dyCm: number; free: boolean }
  | { type: 'resizePreview'; id: string; handle: Handle; dxCm: number; dyCm: number; free: boolean }
  | { type: 'resizeCommit'; id: string; handle: Handle; dxCm: number; dyCm: number; free: boolean }
  | { type: 'marquee'; box: ScreenBox; base: string[] } | { type: 'marqueeEnd' }
  | { type: 'measure'; from: [number, number]; to: [number, number] }
  | { type: 'zoomToIds'; ids: string[] } | { type: 'lockedNotice' }
  | { type: 'hover'; id: string | null; cursor: string };

/** How far a press may wander and still be a click. */
const CLICK_SLOP_PX = 4;
/** A locked item has to be really dragged before the notice appears. */
const LOCKED_SLOP_PX = 6;
/** Degrees of turn per pixel dragged, as in the mock. */
const YAW_PER_PX = 0.35;
const PITCH_PER_PX = 0.3;

const HANDLE_CURSORS: Record<Handle, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};

type Point = { x: number; y: number };
type ClickAction = { type: 'clear' } | { type: 'select'; id: string } | { type: 'none' };

type Drag =
  | { type: 'pan'; start: Point; grab: [number, number] | null; moved: boolean; click: ClickAction }
  | { type: 'orbit'; last: Point }
  | { type: 'move'; ids: string[]; start: Point; grab: [number, number]; moved: boolean; last: [number, number] }
  | { type: 'resize'; id: string; handle: Handle; start: Point; grab: [number, number]; moved: boolean; last: [number, number] }
  | { type: 'marquee'; start: Point; base: string[]; moved: boolean }
  | { type: 'measure'; from: [number, number] }
  | { type: 'locked'; start: Point; warned: boolean };

function far(a: Point, b: Point, slop: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) >= slop;
}

export class Gestures {
  private drag: Drag | null = null;
  private lastHover: { id: string | null; cursor: string } = { id: null, cursor: 'default' };

  constructor(private readonly world: GestureWorld) {}

  /** Whether a drag is under way — the view reports itself as moving meanwhile. */
  get active(): boolean {
    return this.drag !== null;
  }

  down(p: PointerInput): GestureIntent[] {
    const world = this.world;
    const at = { x: p.x, y: p.y };
    this.drag = null;

    if (p.button === 2 || (p.button === 0 && p.ctrl)) {
      this.drag = world.mode() === '3d'
        ? { type: 'orbit', last: at }
        : { type: 'pan', start: at, grab: world.groundAt(p.x, p.y), moved: false, click: { type: 'none' } };
      return [];
    }
    if (p.button === 1) {
      this.drag = { type: 'pan', start: at, grab: world.groundAt(p.x, p.y), moved: false, click: { type: 'none' } };
      return [];
    }
    if (p.button !== 0) return [];

    if (world.tool() === 'measure') {
      const from = world.groundAt(p.x, p.y);
      if (from === null) return [];
      this.drag = { type: 'measure', from };
      return [{ type: 'measure', from, to: from }];
    }

    const handle = world.handleAt(p.x, p.y);
    const selected = world.selection();
    if (handle !== null && selected.length === 1) {
      const grab = world.groundAt(p.x, p.y);
      if (grab === null) return [];
      this.drag = { type: 'resize', id: selected[0], handle, start: at, grab, moved: false, last: [0, 0] };
      return [];
    }

    const label = world.labelAt(p.x, p.y);
    if (label !== null && label.group) return [{ type: 'zoomToIds', ids: [...label.ids] }];
    if (label !== null) {
      const id = label.ids[0];
      if (p.shift || p.meta) return [{ type: 'toggleSelect', id }];
      // A label selects on click; dragged, it moves the view like the ground under it.
      this.drag = { type: 'pan', start: at, grab: world.groundAt(p.x, p.y), moved: false, click: { type: 'select', id } };
      return [];
    }

    const item = world.itemAt(p.x, p.y);
    if (item !== null) {
      const already = selected.includes(item.id);
      if (p.shift || p.meta) return [{ type: 'toggleSelect', id: item.id }];
      // A net nobody chose is ground to pan across; a click still selects it (spec §8).
      if (item.isNet && !already) {
        this.drag = { type: 'pan', start: at, grab: world.groundAt(p.x, p.y), moved: false, click: { type: 'select', id: item.id } };
        return [];
      }
      const intents: GestureIntent[] = already ? [] : [{ type: 'select', ids: [item.id] }];
      if (item.locked) {
        this.drag = { type: 'locked', start: at, warned: false };
        return intents;
      }
      const grab = world.groundAt(p.x, p.y);
      if (grab !== null) {
        this.drag = { type: 'move', ids: already ? [...selected] : [item.id], start: at, grab, moved: false, last: [0, 0] };
      }
      return intents;
    }

    if (p.shift) {
      this.drag = { type: 'marquee', start: at, base: [...selected], moved: false };
      return [];
    }
    this.drag = { type: 'pan', start: at, grab: world.groundAt(p.x, p.y), moved: false, click: { type: 'clear' } };
    return [];
  }

  move(p: PointerInput): GestureIntent[] {
    const drag = this.drag;
    const at = { x: p.x, y: p.y };
    if (drag === null) return this.hover(p);

    switch (drag.type) {
      case 'orbit': {
        const intent: GestureIntent = { type: 'orbitBy', dYaw: (p.x - drag.last.x) * YAW_PER_PX, dPitch: (p.y - drag.last.y) * PITCH_PER_PX };
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
        if (ground !== null) drag.last = [ground[0] - drag.grab[0], ground[1] - drag.grab[1]];
        return [{ type: 'movePreview', ids: drag.ids, dxCm: drag.last[0], dyCm: drag.last[1], free: p.alt }];
      }
      case 'resize': {
        if (!drag.moved && !far(drag.start, at, 1)) return [];
        drag.moved = true;
        const ground = this.world.groundAt(p.x, p.y);
        if (ground !== null) drag.last = [ground[0] - drag.grab[0], ground[1] - drag.grab[1]];
        return [{ type: 'resizePreview', id: drag.id, handle: drag.handle, dxCm: drag.last[0], dyCm: drag.last[1], free: p.alt }];
      }
      case 'marquee': {
        if (!drag.moved && !far(drag.start, at, CLICK_SLOP_PX)) return [];
        drag.moved = true;
        const box: ScreenBox = {
          l: Math.min(drag.start.x, p.x), t: Math.min(drag.start.y, p.y),
          r: Math.max(drag.start.x, p.x), b: Math.max(drag.start.y, p.y),
        };
        return [{ type: 'marquee', box, base: drag.base }];
      }
      case 'measure': {
        const to = this.world.groundAt(p.x, p.y);
        return to === null ? [] : [{ type: 'measure', from: drag.from, to }];
      }
      case 'locked': {
        if (drag.warned || !far(drag.start, at, LOCKED_SLOP_PX)) return [];
        drag.warned = true;
        return [{ type: 'lockedNotice' }];
      }
    }
  }

  up(p: PointerInput): GestureIntent[] {
    const drag = this.drag;
    this.drag = null;
    if (drag === null) return [];
    const settle = this.hover(p);

    switch (drag.type) {
      case 'pan': {
        if (drag.moved) return settle;
        if (drag.click.type === 'clear') return [{ type: 'clearSelection' }, ...settle];
        if (drag.click.type === 'select') return [{ type: 'select', ids: [drag.click.id] }, ...settle];
        return settle;
      }
      case 'move': {
        if (!drag.moved) return settle;
        const ground = this.world.groundAt(p.x, p.y);
        const [dxCm, dyCm] = ground === null ? drag.last : [ground[0] - drag.grab[0], ground[1] - drag.grab[1]];
        return [{ type: 'moveCommit', ids: drag.ids, dxCm, dyCm, free: p.alt }, ...settle];
      }
      case 'resize': {
        if (!drag.moved) return settle;
        const ground = this.world.groundAt(p.x, p.y);
        const [dxCm, dyCm] = ground === null ? drag.last : [ground[0] - drag.grab[0], ground[1] - drag.grab[1]];
        return [{ type: 'resizeCommit', id: drag.id, handle: drag.handle, dxCm, dyCm, free: p.alt }, ...settle];
      }
      case 'marquee':
        return drag.moved ? [{ type: 'marqueeEnd' }, ...settle] : settle;
      default:
        return settle;
    }
  }

  /** The pointer left, the window lost focus, or the browser took the pointer: nothing commits. */
  cancel(): GestureIntent[] {
    const drag = this.drag;
    this.drag = null;
    return drag !== null && drag.type === 'marquee' && drag.moved ? [{ type: 'marqueeEnd' }] : [];
  }

  /** What is under the pointer and how the cursor says so — reported only when it changes. */
  private hover(p: PointerInput): GestureIntent[] {
    const world = this.world;
    let next: { id: string | null; cursor: string };
    if (world.tool() === 'measure') {
      next = { id: null, cursor: 'crosshair' };
    } else {
      const handle = world.selection().length === 1 ? world.handleAt(p.x, p.y) : null;
      const label = handle === null ? world.labelAt(p.x, p.y) : null;
      const item = handle === null && label === null ? world.itemAt(p.x, p.y) : null;
      if (handle !== null) next = { id: null, cursor: HANDLE_CURSORS[handle] };
      else if (label !== null && label.group) next = { id: null, cursor: 'zoom-in' };
      else if (label !== null) next = { id: label.ids[0], cursor: 'pointer' };
      else if (item === null) next = { id: null, cursor: 'default' };
      else if (item.locked) next = { id: item.id, cursor: 'not-allowed' };
      else if (item.isNet && !world.selection().includes(item.id)) next = { id: item.id, cursor: 'pointer' };
      else next = { id: item.id, cursor: 'grab' };
    }
    if (next.id === this.lastHover.id && next.cursor === this.lastHover.cursor) return [];
    this.lastHover = next;
    return [{ type: 'hover', ...next }];
  }
}
