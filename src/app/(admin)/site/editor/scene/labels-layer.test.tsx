/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import type { PlacedLabel } from '@/lib/site/editor/label-layout';
import { LabelsLayer, type LabelsLayerHandle } from './labels-layer';

const TENT: PlacedLabel = {
  key: 'a', ids: ['a'], text: 'אוהל 1', rect: { l: 10, t: 20, r: 90, b: 42 },
  anchor: [50, 31], leader: false, group: false, slot: 'in', tier: 'regular', issue: false,
};
const TOILETS: PlacedLabel = {
  key: 'group:toilet', ids: ['w1', 'w2', 'w3', 'w4'], text: '4 תאי שירותים', rect: { l: 200, t: 100, r: 310, b: 122 },
  anchor: [255, 150], leader: true, group: true, slot: 'n', tier: 'regular', issue: false,
};
/** A caravan outside the plot: named large, in the problem colour (spec §9.8). */
const CARAVAN_OUT: PlacedLabel = {
  key: 'c', ids: ['c'], text: 'קראוון 1', rect: { l: 400, t: 20, r: 520, b: 44 },
  anchor: [460, 32], leader: false, group: false, slot: 'in', tier: 'large', issue: true,
};

function setup() {
  const ref = createRef<LabelsLayerHandle>();
  const view = render(<LabelsLayer ref={ref} />);
  const update = (placed: PlacedLabel[], selection: string[] = []) => {
    act(() => { ref.current?.update(placed, new Set(selection)); });
  };
  return { ...view, update };
}

describe('the labels layer', () => {
  it('puts each label in the rectangle the layout gave it', () => {
    const { update } = setup();
    update([TENT, TOILETS], ['a']);

    const tent = screen.getByText('אוהל 1');
    expect(tent.style.transform).toBe('translate(10px, 20px)');
    expect(tent.style.width).toBe('80px');
    expect(tent.style.height).toBe('22px');
    expect(tent.dataset.selected).toBe('true');

    const group = screen.getByText('4 תאי שירותים');
    expect(group.dataset.group).toBe('true');
    expect(group.dataset.selected).toBe('false');
  });

  /* The stylesheet draws the size and the colour from these two attributes;
     without them every name is regular and ink-coloured. */
  it('marks each label with its size tier and whether its item has a problem', () => {
    const { update } = setup();
    update([TENT, CARAVAN_OUT]);
    expect(screen.getByText('אוהל 1').dataset).toMatchObject({ tier: 'regular', issue: 'false' });
    expect(screen.getByText('קראוון 1').dataset).toMatchObject({ tier: 'large', issue: 'true' });
  });

  it('draws a leader from the item to the nearest edge of a label that sits outside it', () => {
    const { container, update } = setup();
    update([TENT, TOILETS]);
    const lines = container.querySelectorAll('line');
    expect(lines).toHaveLength(1);
    expect([...['x1', 'y1', 'x2', 'y2']].map((name) => lines[0].getAttribute(name))).toEqual(['255', '150', '255', '122']);
  });

  it('moves a label that stays and removes one that went, without recreating the first', () => {
    const { container, update } = setup();
    update([TENT, TOILETS]);
    const tent = screen.getByText('אוהל 1');

    update([{ ...TENT, rect: { l: 30, t: 40, r: 110, b: 62 } }]);

    expect(screen.getByText('אוהל 1')).toBe(tent);
    expect(tent.style.transform).toBe('translate(30px, 40px)');
    expect(screen.queryByText('4 תאי שירותים')).toBeNull();
    expect(container.querySelectorAll('line')).toHaveLength(0);
  });

  it('changes the text in place when the selection adds a size', () => {
    const { update } = setup();
    update([TENT]);
    const tent = screen.getByText('אוהל 1');
    update([{ ...TENT, text: 'אוהל 1 · 3 × 3 מ׳' }], ['a']);
    expect(screen.getByText('אוהל 1 · 3 × 3 מ׳')).toBe(tent);
  });

  it('empties when there is nothing to label', () => {
    const { container, update } = setup();
    update([TENT, TOILETS]);
    update([]);
    expect(container.textContent).toBe('');
  });
});
