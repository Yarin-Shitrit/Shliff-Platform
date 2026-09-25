/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { derive, toPlaced } from '@/lib/site/derive';
import { overlapPairs } from '@/lib/site/geometry';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import type { ViewInfo } from '../scene/scene-view';
import { Minimap, minimapPoint } from './minimap';

beforeAll(() => {
  Element.prototype.setPointerCapture = () => {};
});

/* This file's own fixture. */
function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function doc(items: EditorItem[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, lines: [], defaults: {} };
}

function flagsOf(map: EditorDoc): EditorFlags {
  const { items } = derive(map.plot, map.items);
  return {
    outside: new Set(items.filter((entry) => entry.outside).map((entry) => entry.id)),
    overlapping: new Set(items.filter((entry) => entry.overlapping).map((entry) => entry.id)),
    partly: new Set(items.filter((entry) => entry.shade === 'partly').map((entry) => entry.id)),
    pairs: overlapPairs(map.items.map(toPlaced)),
  };
}

const STILL: ViewInfo = { yaw: 0, zoomPct: 100, pxPerM: 20, groundCorners: [], selectionBox: null, moving: false };

function renderMap(items: EditorItem[], over: { selection?: string[]; info?: ViewInfo } = {}) {
  const map = doc(items);
  const onJump = vi.fn();
  const { container } = render(
    <Minimap doc={map} flags={flagsOf(map)} selection={over.selection ?? []} info={over.info ?? STILL} onJump={onJump} />,
  );
  const svg = screen.getByRole('img', { name: /מפה מוקטנת/ });
  const viewBox = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
  return { onJump, container, svg, viewBox };
}

/** jsdom lays nothing out: the minimap's own 168 × 154 box. */
function sized(svg: Element): void {
  svg.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 168, height: 154, right: 168, bottom: 154, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect;
}

describe('the minimap', () => {
  it('draws the plot alone on an empty map, with room around it', () => {
    const { container, viewBox } = renderMap([]);
    // 6% of the longer side (2600 cm) on every side.
    expect(viewBox).toEqual([-156, -156, 2912, 2712]);
    expect(container.querySelectorAll('rect[data-id]')).toHaveLength(0);
    expect(container.querySelector('polygon')).toBeNull();
  });

  it('grows to hold every item past the fence, and marks each one', () => {
    const { container, viewBox } = renderMap([
      item({ id: 'a', xCm: 3000, yCm: 0 }),
      item({ id: 'b', label: 'אוהל 2', xCm: -500 }),
      item({ id: 'c', label: 'אוהל 3', yCm: 2600 }),
    ]);
    const [x, y, width, height] = viewBox;
    expect(x).toBeLessThanOrEqual(-500);
    expect(x + width).toBeGreaterThanOrEqual(3300);
    expect(y + height).toBeGreaterThanOrEqual(2800);
    const drawn = [...container.querySelectorAll('rect[data-id]')];
    expect(drawn.map((rect) => rect.getAttribute('data-outside'))).toEqual(['true', 'true', 'true']);
  });

  it('outlines the ground the view can see, and marks the selection', () => {
    const { container } = renderMap([item({ id: 'a' })], {
      selection: ['a'],
      info: { ...STILL, groundCorners: [[0, 0], [1000, 0], [1000, 800], [0, 800]] },
    });
    expect(container.querySelector('polygon')?.getAttribute('points')).toBe('0,0 1000,0 1000,800 0,800');
    expect(container.querySelector('rect[data-id="a"]')?.getAttribute('data-selected')).toBe('true');
  });

  it('moves the view to the point clicked: the middle of the minimap is the middle of the plot', () => {
    const { onJump, svg } = renderMap([]);
    sized(svg);
    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 84, clientY: 77 });
    expect(onJump).toHaveBeenCalledWith(1300, 1200);
  });

  it('follows a drag, and stops when the pointer lifts', () => {
    const { onJump, svg } = renderMap([]);
    sized(svg);
    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 84, clientY: 77 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 90, clientY: 77 });
    expect(onJump).toHaveBeenCalledTimes(2);
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 90, clientY: 77 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 120, clientY: 77 });
    expect(onJump).toHaveBeenCalledTimes(2);
  });

  it('stops following when the pointer capture is lost', () => {
    const { onJump, svg } = renderMap([]);
    sized(svg);
    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 84, clientY: 77 });
    fireEvent.lostPointerCapture(svg, { pointerId: 1 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 120, clientY: 77 });
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('follows only the pointer that started the drag: a second one neither jumps nor ends it', () => {
    const { onJump, svg } = renderMap([]);
    sized(svg);
    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 84, clientY: 77 });
    fireEvent.pointerDown(svg, { pointerId: 2, button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 30, clientY: 20 });
    expect(onJump).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(svg, { pointerId: 2, clientX: 30, clientY: 20 });
    fireEvent.lostPointerCapture(svg, { pointerId: 2 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 90, clientY: 77 });
    expect(onJump).toHaveBeenCalledTimes(2);
    // The 2712 cm of height fill the 154 px box, so 6 px across is 6 × 2712 / 154 ≈ 105.7 cm east of the middle.
    expect(onJump).toHaveBeenLastCalledWith(1406, 1200);
  });

  it('lets the same pointer take its drag back when its release never arrived', () => {
    const { onJump, svg } = renderMap([]);
    sized(svg);
    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 84, clientY: 77 });
    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 90, clientY: 77 });
    expect(onJump).toHaveBeenCalledTimes(2);
  });

  it('moves nothing while it has no size — before layout, or hidden', () => {
    const { onJump, svg } = renderMap([]);
    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 84, clientY: 77 });
    expect(onJump).not.toHaveBeenCalled();
  });

  it('reads a point through the band the SVG leaves around ground wider than its box', () => {
    // One pixel per centimetre: the 100 cm of ground sit 50 px down a 200 px box.
    const box = { x: -100, y: -50, width: 200, height: 100 };
    const rect = { left: 10, top: 20, width: 200, height: 200 };
    expect(minimapPoint(rect, box, 10, 70)).toEqual([-100, -50]);
    expect(minimapPoint(rect, box, 210, 170)).toEqual([100, 50]);
    expect(minimapPoint({ ...rect, width: 0 }, box, 10, 70)).toBeNull();
  });
});
