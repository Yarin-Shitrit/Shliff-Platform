import type { SiteOp } from './ops';

/**
 * Undo and redo for one editing session (spec §6.2). An entry is one thing a
 * lead did — a drag, a nudge, a row of six tents — with the ops that did it
 * and the ops that undo it. Undoing hands back the inverse ops; the store
 * applies them and queues them like any other edit, so an undo is saved the
 * way the edit was. Nothing here survives a reload (spec §16).
 */

export interface HistoryEntry {
  label: string;
  ops: SiteOp[];
  inverse: SiteOp[];
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

/**
 * A new step, which ends any redo. An entry with no ops is not a step — a
 * click that changed nothing — and leaves the history, redo included, as it
 * was. Past `limit` steps the oldest is forgotten.
 */
export function record(history: History, entry: HistoryEntry, limit = 100): History {
  if (entry.ops.length === 0) return history;
  const past = [...history.past, entry];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

export function undo(history: History): { history: History; ops: SiteOp[]; label: string } | null {
  const entry = history.past[history.past.length - 1];
  if (entry === undefined) return null;
  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, entry] },
    ops: entry.inverse,
    label: entry.label,
  };
}

export function redo(history: History): { history: History; ops: SiteOp[]; label: string } | null {
  const entry = history.future[history.future.length - 1];
  if (entry === undefined) return null;
  return {
    history: { past: [...history.past, entry], future: history.future.slice(0, -1) },
    ops: entry.ops,
    label: entry.label,
  };
}
