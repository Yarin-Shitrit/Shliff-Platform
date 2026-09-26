import { describe, it, expect } from 'vitest';
import type { EditorDoc, EditorItem, EditorLine } from './model';
import { applyOps, invertOps, type SiteOp } from './ops';
import { restoreOps } from './restore';

/* This file's own fixture: a 26 × 24 m plot on a 50 cm grid. */
const tent = (over: Partial<EditorItem> & { id: string }): EditorItem => ({
  kind: 'tent', label: `אוהל ${over.id}`, xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
  heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, facing: 0, locked: false, groupId: null,
  ...over,
});

const line = (over: Partial<EditorLine> & { id: string; fromId: string; toId: string }): EditorLine => ({
  kind: 'water', label: `צינור מים ${over.id}`, points: [], sort: 0, notes: null, ...over,
});

const doc = (items: EditorItem[], lines: EditorLine[] = []): EditorDoc => ({
  plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, lines, defaults: {},
});

const NO_TASKS = new Set<string>();

/** The doc after the ops, as the store would hold it. */
const after = (from: EditorDoc, ops: SiteOp[]) => applyOps(from, ops).doc;

/** Items and lines by id, without draw order, so two docs compare by what is on them. */
const contents = (of: EditorDoc) => ({
  items: Object.fromEntries(of.items.map((entry) => [entry.id, { ...entry, sort: 0 }])),
  lines: Object.fromEntries(of.lines.map((entry) => [entry.id, { ...entry, sort: 0 }])),
});

describe('loading a saved plan over the map', () => {
  it('does nothing when the map already is the plan', () => {
    const map = doc([tent({ id: 'a' }), tent({ id: 'b', xCm: 1000 })]);
    const result = restoreOps(map, { items: map.items, lines: [] }, NO_TASKS);
    expect(result).toEqual({ ops: [], lockedNames: [], droppedLineNames: [], tasksCleared: 0 });
  });

  it('moves an item back with only what differs, brings back one that went, and removes one that came since', () => {
    const plan = { items: [tent({ id: 'a' }), tent({ id: 'gone', xCm: 1500, label: 'אוהל שהוסר' })], lines: [] };
    const map = doc([tent({ id: 'a', xCm: 900, label: 'אוהל א׳ מוזז' }), tent({ id: 'new', xCm: 2000 })]);
    const result = restoreOps(map, plan, NO_TASKS);
    expect(result.ops).toEqual([
      { type: 'remove', id: 'new' },
      { type: 'update', id: 'a', patch: { label: 'אוהל a', xCm: 500 } },
      { type: 'add', item: plan.items[1] },
    ]);
    expect(contents(after(map, result.ops))).toEqual(contents(doc(plan.items)));
    // One edit, undone whole: the inverse takes the map back to where it was.
    expect(contents(after(after(map, result.ops), invertOps(map, result.ops)))).toEqual(contents(map));
  });

  it('leaves a locked item exactly as it is, and names it only when the plan would have changed it', () => {
    const plan = { items: [tent({ id: 'a' }), tent({ id: 'b', xCm: 1000 })], lines: [] };
    const map = doc([
      tent({ id: 'a', xCm: 900, locked: true, label: 'המטבח' }),
      // Locked since the plan was saved, and otherwise as the plan has it: it stays locked, and is not named.
      tent({ id: 'b', xCm: 1000, locked: true }),
      tent({ id: 'c', locked: true, label: 'נעול ולא בתוכנית' }),
    ]);
    const result = restoreOps(map, plan, NO_TASKS);
    expect(result.ops).toEqual([]);
    expect(result.lockedNames).toEqual(['נעול ולא בתוכנית', 'המטבח']);
    expect(after(map, result.ops).items.find((entry) => entry.id === 'b')?.locked).toBe(true);
  });

  it('carries the plan’s lock, group, notes, task and facing onto an unlocked item', () => {
    const plan = { items: [tent({ id: 'a', locked: true, groupId: '11111111-1111-4111-8111-111111111111', notes: 'ליד הכניסה', taskId: 't1', facing: 2 })], lines: [] };
    const map = doc([tent({ id: 'a' })]);
    const result = restoreOps(map, plan, new Set(['t1']));
    expect(result.ops).toEqual([{
      type: 'update', id: 'a',
      patch: { taskId: 't1', notes: 'ליד הכניסה', facing: 2, locked: true, groupId: '11111111-1111-4111-8111-111111111111' },
    }]);
    expect(result.tasksCleared).toBe(0);
  });

  it('drops a task link this season no longer has, on a kept item and on one brought back, and counts each', () => {
    const plan = { items: [tent({ id: 'a', taskId: 'old' }), tent({ id: 'b', taskId: 'old' }), tent({ id: 'c', taskId: 'still' })], lines: [] };
    const map = doc([tent({ id: 'a' })]);
    const result = restoreOps(map, plan, new Set(['still']));
    expect(result.tasksCleared).toBe(2);
    const loaded = after(map, result.ops);
    expect(loaded.items.map((entry) => [entry.id, entry.taskId])).toEqual([['a', null], ['b', null], ['c', 'still']]);
  });

  it('keeps a line in place that the plan has with the same ends, patching only its bends, and redraws the rest', () => {
    const tank = tent({ id: 'tank', kind: 'water', xCm: 0 });
    const shower = tent({ id: 'shower', kind: 'shower', xCm: 1000 });
    const sink = tent({ id: 'sink', kind: 'sink', xCm: 2000 });
    const plan = {
      items: [tank, shower, sink],
      lines: [
        line({ id: 'l1', fromId: 'tank', toId: 'shower', points: [[500, 300]] }),
        line({ id: 'l2', fromId: 'tank', toId: 'sink' }),
      ],
    };
    const map = doc([tank, shower, sink], [
      line({ id: 'l1', fromId: 'tank', toId: 'shower' }),
      line({ id: 'l2', fromId: 'tank', toId: 'shower' }), // the plan runs it to the sink instead
      line({ id: 'l3', fromId: 'tank', toId: 'sink' }), // not in the plan
    ]);
    const result = restoreOps(map, plan, NO_TASKS);
    expect(result.ops).toEqual([
      { type: 'removeLine', id: 'l2' },
      { type: 'removeLine', id: 'l3' },
      { type: 'updateLine', id: 'l1', patch: { points: [[500, 300]] } },
      { type: 'addLine', line: plan.lines[1] },
    ]);
    expect(contents(after(map, result.ops))).toEqual(contents(doc(plan.items, plan.lines)));
  });

  it('takes a line off before its end goes, so nothing hangs from an item that is removed', () => {
    const tank = tent({ id: 'tank', kind: 'water' });
    const shower = tent({ id: 'shower', kind: 'shower', xCm: 1000 });
    const plan = { items: [tank], lines: [] };
    const map = doc([tank, shower], [line({ id: 'l1', fromId: 'tank', toId: 'shower' })]);
    const result = restoreOps(map, plan, NO_TASKS);
    expect(result.ops).toEqual([{ type: 'removeLine', id: 'l1' }, { type: 'remove', id: 'shower' }]);
  });

  it('does not draw a line whose end stayed locked as a kind the line cannot reach, and names it', () => {
    // On the map the item is a locked tent; the plan has it as a shower with a pipe to it.
    const tank = tent({ id: 'tank', kind: 'water' });
    const plan = {
      items: [tank, tent({ id: 'x', kind: 'shower', xCm: 1000 })],
      lines: [line({ id: 'l1', fromId: 'tank', toId: 'x', label: 'צינור למקלחת' })],
    };
    const map = doc([tank, tent({ id: 'x', kind: 'tent', xCm: 1000, locked: true, label: 'אוהל נעול' })]);
    const result = restoreOps(map, plan, NO_TASKS);
    expect(result.ops).toEqual([]);
    expect(result.lockedNames).toEqual(['אוהל נעול']);
    expect(result.droppedLineNames).toEqual(['צינור למקלחת']);
  });

  it('redraws a line whose end changes kind in the load, rather than leaving it attached through the change', () => {
    // The map has a splitter fed by the tank; the plan has that item as a sink, still fed by the tank.
    const tank = tent({ id: 'tank', kind: 'water' });
    const plan = {
      items: [tank, tent({ id: 'x', kind: 'sink', xCm: 1000 })],
      lines: [line({ id: 'l1', fromId: 'tank', toId: 'x' })],
    };
    const map = doc([tank, tent({ id: 'x', kind: 'splitter', xCm: 1000 })], [line({ id: 'l1', fromId: 'tank', toId: 'x' })]);
    const result = restoreOps(map, plan, NO_TASKS);
    expect(result.ops.map((op) => op.type)).toEqual(['removeLine', 'update', 'addLine']);
    expect(contents(after(map, result.ops))).toEqual(contents(doc(plan.items, plan.lines)));
  });

  it('reads an item from a page older than groups as in no group', () => {
    const older = tent({ id: 'a' });
    delete older.groupId;
    const map = doc([tent({ id: 'a', groupId: '11111111-1111-4111-8111-111111111111' })]);
    const result = restoreOps(map, { items: [older], lines: [] }, NO_TASKS);
    expect(result.ops).toEqual([{ type: 'update', id: 'a', patch: { groupId: null } }]);
  });
});
