/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KindDefaults, KindSize } from '@/lib/site/defaults';
import { derive } from '@/lib/site/derive';
import { NOT_WHOLE_DEGREES, ROPE_ANGLE_OUT_OF_RANGE } from '@/lib/site/editor/degrees';
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

/** A 3 × 3 m tent, in this file's fixture. */
function tent(over: Partial<EditorItem> & { id: string }): EditorItem {
  return item({ kind: 'tent', label: 'אוהל 1', widthCm: 300, depthCm: 300, insetCm: null, ...over });
}

/** The first-strong isolate (U+2068…U+2069) a pill puts around a name (spec §20; FSI, as main's `isolate` in `notices.ts` since #31). */
const iso = (name: string) => `⁨${name}⁩`;

/* The box's label carries a decorative "°" after it, so match its start. */
const angleBox = () => screen.getByLabelText(/^זווית החבלים מהקרקע/) as HTMLInputElement;

function typeAngle(text: string): void {
  fireEvent.change(angleBox(), { target: { value: text } });
  fireEvent.keyDown(angleBox(), { key: 'Enter' });
}

describe('a net’s ropes, in its inspector', () => {
  it('shows the shaded ground, the cloth and the rope footprint, and where the footprint came from (spec §15)', () => {
    renderItem(item({ id: 'n1' }));
    expect(screen.getByRole('heading', { name: 'צל וחבלים' })).toBeTruthy();
    expect(screen.getByText('7 × 7 מ׳ · 49 מ״ר')).toBeTruthy();
    expect(screen.getByText('8 × 8 מ׳ · 64 מ״ר')).toBeTruthy();
    expect(screen.getByText('14 × 14 מ׳ · 196 מ״ר')).toBeTruthy();
    expect(screen.getByText('היתדות 3 מ׳ מהבד: גובה 3 מ׳ ÷ tan 45°')).toBeTruthy();
    expect(angleBox().value).toBe('');
    expect(angleBox().placeholder).toBe('45');
    expect(screen.getByText('ברירת המחדל של רשתות צל')).toBeTruthy();
  });

  it('invites an angle while none is set anywhere, and the net is checked by its cloth (D16)', () => {
    renderItem(item({ id: 'n1' }), {});
    expect(screen.getByText(/^עוד לא נקבעה זווית לחבלים, ולכן הרשת נבדקת לפי הבד בלבד/)).toBeTruthy();
    expect(screen.queryByText('עם החבלים')).toBeNull();
    expect(angleBox().placeholder).toBe('');
  });

  it('applies a typed angle, and typing the camp’s leaves the net on the camp’s (as ruling P13 does for a height)', () => {
    const { onRun, after } = renderItem(item({ id: 'n1' }));
    typeAngle('30');
    expect(after().items[0].ropeAngleDeg).toBe(30);
    onRun.mockClear();
    typeAngle(' 45° ');
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses an angle outside 20–80, or not whole, in Hebrew, and sends nothing', () => {
    const { onRun } = renderItem(item({ id: 'n1' }));
    typeAngle('81');
    expect(screen.getByRole('alert').textContent).toBe(ROPE_ANGLE_OUT_OF_RANGE);
    expect(angleBox().getAttribute('aria-invalid')).toBe('true');
    typeAngle('45.5');
    expect(screen.getByRole('alert').textContent).toBe(NOT_WHOLE_DEGREES);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('stores its own angle as every net’s, and then follows it', () => {
    const { after } = renderItem(item({ id: 'n1', ropeAngleDeg: 30 }));
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הזווית כברירת המחדל של רשתות צל' }));
    expect(after().defaults.shade).toEqual({ ...CAMP_NETS, ropeAngleDeg: 30 });
    expect(after().items[0].ropeAngleDeg).toBeNull();
  });

  it('writes the nets’ default at the preset size when the camp has none yet (spec §13)', () => {
    const { after } = renderItem(item({ id: 'n1', ropeAngleDeg: 30 }), {});
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הזווית כברירת המחדל של רשתות צל' }));
    expect(after().defaults.shade).toEqual({ widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 30 });
  });

  it('goes back to the camp’s angle', () => {
    const { after } = renderItem(item({ id: 'n1', ropeAngleDeg: 30 }));
    fireEvent.click(screen.getByRole('button', { name: 'חזרה לזווית ברירת המחדל' }));
    expect(after().items[0].ropeAngleDeg).toBeNull();
  });

  it('offers neither link to a net already on the camp’s angle', () => {
    renderItem(item({ id: 'n1' }));
    for (const name of ['שמירת הזווית כברירת המחדל של רשתות צל', 'חזרה לזווית ברירת המחדל']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('holds a locked net’s angle: the box and the way back', () => {
    renderItem(item({ id: 'n1', ropeAngleDeg: 30, locked: true }));
    expect(angleBox().disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'חזרה לזווית ברירת המחדל' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says when only the ropes cross the fence, and names what stands in the band', () => {
    // Flush with the east fence by its cloth (1800 + 800 = 2600); its 3 m ropes reach past it.
    const net = item({ id: 'n1', xCm: 1800, yCm: 800 });
    const t3 = tent({ id: 't3', label: 'אוהל 3', xCm: 1450, yCm: 1000 });
    const t4 = tent({ id: 't4', label: 'אוהל 4', xCm: 1450, yCm: 1400 });
    const { onPickIds } = renderItem(net, { shade: CAMP_NETS }, [t3, t4]);
    expect(screen.getByText('החבלים יוצאים מהגדר')).toBeTruthy();
    expect(screen.queryByText('מחוץ לגדר')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `בשטח החבלים: ${iso('אוהל 3')}, ${iso('אוהל 4')}` }));
    expect(onPickIds).toHaveBeenLastCalledWith(['t3', 't4']);
  });

  it('tells a tent in a band whose band it is, and the pill selects both', () => {
    const net = item({ id: 'n1', xCm: 1800, yCm: 800 });
    const t3 = tent({ id: 't3', label: 'אוהל 3', xCm: 1450, yCm: 1000 });
    const { onPickIds } = renderItem(t3, { shade: CAMP_NETS }, [net]);
    fireEvent.click(screen.getByRole('button', { name: `בשטח החבלים של ${iso('רשת צל 1')}` }));
    expect(onPickIds).toHaveBeenLastCalledWith(['t3', 'n1']);
  });
});
