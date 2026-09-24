import { describe, it, expect } from 'vitest';
import { EMPTY_HISTORY, record, redo, undo, type HistoryEntry } from './history';

function step(n: number): HistoryEntry {
  return {
    label: `הזזה ${n}`,
    ops: [{ type: 'update', id: 't1', patch: { xCm: n * 100 } }],
    inverse: [{ type: 'update', id: 't1', patch: { xCm: (n - 1) * 100 } }],
  };
}

describe('history', () => {
  it('undoes with the inverse ops and redoes with the ops, naming the step', () => {
    const history = record(record(EMPTY_HISTORY, step(1)), step(2));
    const undone = undo(history);
    expect(undone).toEqual({
      history: { past: [step(1)], future: [step(2)] },
      ops: step(2).inverse,
      label: 'הזזה 2',
    });
    expect(redo(undone!.history)).toEqual({
      history: { past: [step(1), step(2)], future: [] },
      ops: step(2).ops,
      label: 'הזזה 2',
    });
  });

  it('has nothing to undo or redo when empty', () => {
    expect(undo(EMPTY_HISTORY)).toBeNull();
    expect(redo(EMPTY_HISTORY)).toBeNull();
  });

  it('ends the redo when a new step is recorded', () => {
    const undone = undo(record(record(EMPTY_HISTORY, step(1)), step(2)))!.history;
    expect(record(undone, step(3))).toEqual({ past: [step(1), step(3)], future: [] });
  });

  it('does not record a step that changed nothing, and keeps the redo', () => {
    const undone = undo(record(EMPTY_HISTORY, step(1)))!.history;
    const nothing: HistoryEntry = { label: 'הזזה', ops: [], inverse: [] };
    expect(record(undone, nothing)).toBe(undone);
  });

  it('forgets the oldest step past the limit', () => {
    let history = EMPTY_HISTORY;
    for (let n = 1; n <= 5; n += 1) history = record(history, step(n), 3);
    expect(history.past.map((entry) => entry.label)).toEqual(['הזזה 3', 'הזזה 4', 'הזזה 5']);
  });

  it('never changes the history it was given', () => {
    const history = record(EMPTY_HISTORY, step(1));
    undo(history);
    record(history, step(2));
    expect(history).toEqual({ past: [step(1)], future: [] });
    expect(EMPTY_HISTORY).toEqual({ past: [], future: [] });
  });
});
