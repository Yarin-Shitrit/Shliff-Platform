/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EditorDoc, EditorItem, EditorLine } from '@/lib/site/editor/model';
import { lineLengthCm } from '@/lib/site/lines';
import type { EditorFlags } from '../use-editor-store';
import type { ViewInfo } from '../scene/scene-view';
import { ItemInspector } from './inspector-item';
import { PlotInspector } from './inspector-plot';
import { Minimap } from './minimap';
import { ObjectsPanel } from './objects-panel';

/**
 * Where the pipes and cables show up in the panels (`site_lines`): the item
 * inspector's connections, the plot inspector's totals, the list's rows and
 * the minimap's runs. Each figure selects what it names (§13).
 */

beforeAll(() => {
  Element.prototype.setPointerCapture = () => {};
});

function item(over: Partial<EditorItem> & { id: string; kind: EditorItem['kind']; label: string }): EditorItem {
  return {
    xCm: 0, yCm: 0, widthCm: 100, depthCm: 100, heightCm: null, insetCm: null, ropeAngleDeg: null,
    sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}
const TANK = item({ id: 'tank', kind: 'water', label: 'מי שתייה 1' });
const SHOWER = item({ id: 'shower', kind: 'shower', label: 'מקלחת 1', xCm: 500 });
const SINK = item({ id: 'sink', kind: 'sink', label: 'כיור 1', xCm: 500, yCm: 300, depthCm: 50 });
const GEN = item({ id: 'gen', kind: 'generator', label: 'גנרטור 1', yCm: 1000 });
const FRIDGE = item({ id: 'fridge', kind: 'fridge', label: 'מקרר 1', xCm: 1000, yCm: 1000 });
const TENT = item({ id: 'tent', kind: 'tent', label: 'אוהל 1', xCm: 1500, yCm: 1500, widthCm: 300, depthCm: 300 });
const PIPE: EditorLine = { id: 'pipe', kind: 'water', label: 'צינור מים 1', fromId: 'tank', toId: 'shower', points: [], sort: 0, notes: null };

function doc(lines: EditorLine[] = [PIPE]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items: [TANK, SHOWER, SINK, GEN, FRIDGE, TENT], lines, defaults: {} };
}

const NO_FLAGS: EditorFlags = { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: [] };

describe('the item inspector’s connections', () => {
  function renderItem(shown: EditorItem, lines: EditorLine[] = [PIPE]) {
    const map = doc(lines);
    const onRun = vi.fn();
    const onPickIds = vi.fn();
    const onAddLine = vi.fn();
    render(<ItemInspector doc={map} item={shown} flags={NO_FLAGS} buildTasks={[]} onRun={onRun} onPickIds={onPickIds} onAddLine={onAddLine} />);
    return { onPickIds, onAddLine };
  }

  it('lists the lines at the tank, each a button to the line, and offers a new pipe only to what is not yet joined', () => {
    const { onPickIds, onAddLine } = renderItem(TANK);
    fireEvent.click(screen.getByRole('button', { name: 'צינור מים 1 · אל מקלחת 1 4 מ׳' }));
    expect(onPickIds).toHaveBeenCalledWith(['pipe']);
    const select = screen.getByLabelText('צינור מים חדש אל') as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual(['בחירת פריט…', 'כיור 1']);
    fireEvent.change(select, { target: { value: 'sink' } });
    expect(onAddLine).toHaveBeenCalledWith('water', 'tank', 'sink');
  });

  it('says a consumer no run reaches has no connection, and says nothing of it for a tent', () => {
    renderItem(SINK);
    expect(screen.getByText('בלי חיבור למים')).toBeTruthy();
    screen.getByText('חיבורים');
  });

  it('offers a fridge a cable to the generator, not to a shower', () => {
    const { onAddLine } = renderItem(FRIDGE);
    expect(screen.getByText('בלי חיבור לחשמל')).toBeTruthy();
    const select = screen.getByLabelText('כבל חשמל חדש אל') as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual(['בחירת פריט…', 'גנרטור 1']);
    fireEvent.change(select, { target: { value: 'gen' } });
    expect(onAddLine).toHaveBeenCalledWith('power', 'fridge', 'gen');
  });

  it('has no connections section for a tent', () => {
    renderItem(TENT);
    expect(screen.queryByText('חיבורים')).toBeNull();
  });
});

describe('the plot inspector’s totals', () => {
  it('counts runs and metres per utility, and the consumers not yet reached, each selecting what it counts', () => {
    const onPickIds = vi.fn();
    render(<PlotInspector doc={doc()} flags={NO_FLAGS} plotHref="/site?act=plot" onPickIds={onPickIds} />);
    fireEvent.click(screen.getByRole('button', { name: 'צינורות מים 1 · 4 מ׳' }));
    expect(onPickIds).toHaveBeenCalledWith(['pipe']);
    fireEvent.click(screen.getByRole('button', { name: 'בלי חיבור למים 1' }));
    expect(onPickIds).toHaveBeenCalledWith(['sink']);
    fireEvent.click(screen.getByRole('button', { name: 'בלי חיבור לחשמל 1' }));
    expect(onPickIds).toHaveBeenCalledWith(['fridge']);
    expect(screen.getByText(/בלי רזרבה/)).toBeTruthy();
  });

  it('invites the first line when the map has none and nothing to connect', () => {
    const empty: EditorDoc = { ...doc([]), items: [TENT] };
    render(<PlotInspector doc={empty} flags={NO_FLAGS} plotHref="/site?act=plot" onPickIds={vi.fn()} />);
    expect(screen.getByText(/אין עדיין צינורות או כבלים/)).toBeTruthy();
  });
});

describe('the list’s line rows', () => {
  it('names each line with its kind and length, and a row selects it', () => {
    const map = doc();
    const onPick = vi.fn();
    const onPickIds = vi.fn();
    render(
      <ObjectsPanel
        items={map.items}
        lines={map.lines.map((line) => ({ id: line.id, kind: line.kind, label: line.label, lengthCm: lineLengthCm(map, line) }))}
        selection={['pipe']}
        flags={NO_FLAGS}
        hiddenGroups={[]}
        netsHidden={false}
        onPick={onPick}
        onPickIds={onPickIds}
        onToggleGroup={vi.fn()}
      />,
    );
    const row = screen.getByRole('button', { name: 'צינור מים 1, צינור מים, 4 מ׳' });
    expect(row.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith('pipe', false);
    fireEvent.click(screen.getByRole('button', { name: 'בחירת הקווים בקבוצה צנרת וכבלים (1)' }));
    expect(onPickIds).toHaveBeenCalledWith(['pipe']);
  });
});

describe('the minimap’s runs', () => {
  it('draws each line along its path, marking the selected one', () => {
    const still: ViewInfo = { yaw: 0, zoomPct: 100, pxPerM: 20, groundCorners: [], selectionBox: null, moving: false };
    const { container } = render(<Minimap doc={doc()} flags={NO_FLAGS} selection={['pipe']} info={still} onJump={vi.fn()} />);
    const run = container.querySelector('polyline[data-id="pipe"]');
    expect(run?.getAttribute('points')).toBe('100,50 500,50');
    expect(run?.getAttribute('data-selected')).toBe('true');
  });
});
