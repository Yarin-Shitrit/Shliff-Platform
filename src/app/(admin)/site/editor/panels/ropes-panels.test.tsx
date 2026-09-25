/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KindDefaults, KindSize } from '@/lib/site/defaults';
import { derive } from '@/lib/site/derive';
import { ROPE_ANGLE_OUT_OF_RANGE } from '@/lib/site/editor/degrees';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { applyOps, type SiteOp } from '@/lib/site/editor/ops';
import { siteFailureMessage } from '../../failure-messages';
import type { EditorFlags } from '../use-editor-store';
import { ItemInspector } from './inspector-item';
import { MultiInspector } from './inspector-multi';

/*
 * The panels with a shade net's ropes in them (spec §15). This file's own
 * fixture: a net is the spec's example — 8 × 8 m on the kind's 3 m height,
 * a 50 cm strip — and the camp's default for nets is 6 × 6 m with ropes at
 * 45°, so a net's own size and the camp's differ, and a footprint exists.
 * A net at (500, 500) keeps its footprint (200…1600) inside the 26 × 24 m plot.
 */
function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'shade', label: 'רשת צל 1', xCm: 500, yCm: 500, widthCm: 800, depthCm: 800,
    heightCm: null, insetCm: 50, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

const CAMP_NETS: KindSize = { widthCm: 600, depthCm: 600, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 };

function doc(items: EditorItem[], defaults: KindDefaults = { shade: CAMP_NETS }): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, lines: [], defaults };
}

/** The flags, worked out with `derive.ts` — the server's rule — not with the store. */
function flagsOf(map: EditorDoc): EditorFlags {
  const { items, pairs, ropePairs } = derive(map.plot, map.items, map.defaults);
  return {
    outside: new Set(items.filter((entry) => entry.outside).map((entry) => entry.id)),
    overlapping: new Set(items.filter((entry) => entry.overlapping).map((entry) => entry.id)),
    partly: new Set(items.filter((entry) => entry.shade === 'partly').map((entry) => entry.id)),
    pairs,
    onRopes: new Set(ropePairs.map(([, id]) => id)),
    ropePairs,
  };
}

type OnRun = Mock<(label: string, ops: SiteOp[]) => void>;

/** The ops of the last edit a panel ran. */
function lastOps(onRun: OnRun): SiteOp[] {
  const call = onRun.mock.lastCall;
  if (call === undefined) throw new Error('nothing was run');
  return call[1];
}

function renderItem(shown: EditorItem, defaults: KindDefaults = { shade: CAMP_NETS }, others: EditorItem[] = []) {
  const map = doc([shown, ...others], defaults);
  const onRun = vi.fn<(label: string, ops: SiteOp[]) => void>();
  const onPickIds = vi.fn();
  render(<ItemInspector doc={map} item={shown} flags={flagsOf(map)} buildTasks={[]} onRun={onRun} onPickIds={onPickIds} />);
  /** What the store would hold after the last edit — `applyOps`, the rule the store uses. */
  const after = () => applyOps(map, lastOps(onRun)).doc;
  return { onRun, onPickIds, after };
}

describe('the camp’s rope angle is not a size (Review Focus #2)', () => {
  it('stays when one net’s sizes are saved as the nets’ default', () => {
    const { after } = renderItem(item({ id: 'n1' }));
    fireEvent.click(screen.getByRole('button', { name: 'שמירת המידות כברירת המחדל של רשת צל' }));
    expect(after().defaults.shade).toEqual({ widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 });
  });

  it('stays when the nets of a selection store the sizes they agree on', () => {
    const map = doc([item({ id: 'n1' }), item({ id: 'n2', label: 'רשת צל 2', xCm: 1500 })]);
    const onRun = vi.fn<(label: string, ops: SiteOp[]) => void>();
    render(<MultiInspector doc={map} ids={['n1', 'n2']} onRun={onRun} onPickIds={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'לשמור גם כברירת המחדל של רשת צל' }));
    expect(applyOps(map, lastOps(onRun)).doc.defaults.shade)
      .toEqual({ widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 });
  });
});

describe('a refused rope angle', () => {
  it('reads the same in Hebrew whether the box or the server refused it', () => {
    expect(siteFailureMessage(new Error('a rope angle must be a whole number of degrees from 20 to 80')))
      .toBe(ROPE_ANGLE_OUT_OF_RANGE);
  });
});
