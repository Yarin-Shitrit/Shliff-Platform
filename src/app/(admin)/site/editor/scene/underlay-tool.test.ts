import { describe, it, expect } from 'vitest';
import type { PointerInput } from './gestures';
import { CALIBRATION_MIN_PX, UnderlayGestures, classifyPick, type UnderlayWorld } from './underlay-tool';

/** Ten centimetres to a pixel; the picture covers the ground from 0 to 1000 cm each way. */
function world(tool: 'calibrate' | 'align' = 'calibrate', mode: 'plan' | '3d' = 'plan'): UnderlayWorld {
  return {
    tool: () => tool,
    mode: () => mode,
    groundAt: (x, y) => [x * 10, y * 10],
    onImage: ([x, y]) => x >= 0 && x <= 1000 && y >= 0 && y <= 1000,
  };
}

const at = (x: number, y: number, over: Partial<PointerInput> = {}): PointerInput =>
  ({ x, y, button: 0, shift: false, meta: false, ctrl: false, alt: false, ...over });

describe('the picture’s tools, pointer by pointer', () => {
  it('calibrating, a click marks where it was pressed', () => {
    const gestures = new UnderlayGestures(world());
    expect(gestures.down(at(50, 40))).toEqual([]);
    expect(gestures.active).toBe(true);
    expect(gestures.move(at(51, 41))).toEqual([]);
    const intents = gestures.up(at(51, 41));
    expect(intents).toContainEqual({ type: 'pick', x: 50, y: 40, ground: [500, 400] });
    expect(intents.some((intent) => intent.type === 'panBy')).toBe(false);
    expect(gestures.active).toBe(false);
  });

  it('calibrating, a drag moves the view and marks nothing', () => {
    const gestures = new UnderlayGestures(world());
    gestures.down(at(50, 40));
    expect(gestures.move(at(70, 40))).toEqual([{ type: 'panBy', dxCm: -200, dyCm: 0 }]);
    expect(gestures.up(at(70, 40)).some((intent) => intent.type === 'pick')).toBe(false);
  });

  it('aligning, a drag that starts on the picture moves it in whole centimetres, and saves once, on release', () => {
    const gestures = new UnderlayGestures(world('align'));
    gestures.down(at(50, 40));
    expect(gestures.move(at(60.44, 40))).toEqual([{ type: 'movePreview', dxCm: 104, dyCm: 0 }]);
    expect(gestures.move(at(80, 45))).toEqual([{ type: 'movePreview', dxCm: 300, dyCm: 50 }]);
    const intents = gestures.up(at(80, 45));
    expect(intents).toContainEqual({ type: 'moveCommit', dxCm: 300, dyCm: 50 });
    expect(intents.filter((intent) => intent.type === 'moveCommit')).toHaveLength(1);
  });

  it('aligning, a drag beside the picture moves the view, and a click on it does nothing', () => {
    const gestures = new UnderlayGestures(world('align'));
    gestures.down(at(150, 40));
    expect(gestures.move(at(170, 40))).toEqual([{ type: 'panBy', dxCm: -200, dyCm: 0 }]);
    expect(gestures.up(at(170, 40)).some((intent) => intent.type === 'moveCommit')).toBe(false);
    gestures.down(at(50, 40));
    const click = gestures.up(at(50, 40));
    expect(click.some((intent) => intent.type === 'moveCommit' || intent.type === 'pick')).toBe(false);
  });

  it('orbits on a right-drag in 3D, pans on one in plan, and pans on the middle button', () => {
    const in3d = new UnderlayGestures(world('calibrate', '3d'));
    in3d.down(at(50, 40, { button: 2 }));
    expect(in3d.move(at(60, 40, { button: 2 }))[0]).toMatchObject({ type: 'orbitBy' });
    const inPlan = new UnderlayGestures(world('align', 'plan'));
    inPlan.down(at(50, 40, { button: 2 }));
    expect(inPlan.move(at(70, 40, { button: 2 }))).toEqual([{ type: 'panBy', dxCm: -200, dyCm: 0 }]);
    inPlan.up(at(70, 40, { button: 2 }));
    inPlan.down(at(50, 40, { button: 1 }));
    expect(inPlan.move(at(70, 40, { button: 1 }))).toEqual([{ type: 'panBy', dxCm: -200, dyCm: 0 }]);
  });

  it('says with the cursor what a press would do, and only when that changes', () => {
    const aligning = new UnderlayGestures(world('align'));
    expect(aligning.move(at(50, 40))).toEqual([{ type: 'cursor', cursor: 'move' }]);
    expect(aligning.move(at(51, 40))).toEqual([]);
    expect(aligning.move(at(150, 40))).toEqual([{ type: 'cursor', cursor: 'default' }]);
    expect(new UnderlayGestures(world()).move(at(50, 40))).toEqual([{ type: 'cursor', cursor: 'crosshair' }]);
  });

  it('drops a drag it is told to, and saves nothing afterwards', () => {
    const gestures = new UnderlayGestures(world('align'));
    gestures.down(at(50, 40));
    gestures.move(at(80, 40));
    expect(gestures.cancel()).toEqual([]);
    expect(gestures.active).toBe(false);
    expect(gestures.up(at(80, 40))).toEqual([]);
  });

  it('refuses a click off the picture, or nearer the first point than 20 pixels', () => {
    expect(CALIBRATION_MIN_PX).toBe(20);
    expect(classifyPick([1.2, 0.5], { x: 0, y: 0 }, null)).toBe('offImage');
    expect(classifyPick([0.5, -0.01], { x: 0, y: 0 }, null)).toBe('offImage');
    expect(classifyPick([0.5, 0.5], { x: 119, y: 100 }, { x: 100, y: 100 })).toBe('tooClose');
    expect(classifyPick([0.5, 0.5], { x: 120, y: 100 }, { x: 100, y: 100 })).toBe('point');
    expect(classifyPick([0, 1], { x: 5, y: 5 }, null)).toBe('point');
  });
});
