import { changedLineUpdate, changedUpdate } from './commands';
import { findItem, groupIdOf, linesAt, type EditorDoc, type EditorItem, type EditorLine } from './model';
import { applyOps, lineEndsRefusal, type ItemPatch, type SiteOp } from './ops';

/**
 * Loading a saved plan back (`src/lib/site/snapshots.ts`): the ops that take
 * the map on screen to the kept arrangement, as one edit. The store applies
 * them, records their inverse as the undo, and queues them for saving like
 * any other edit — so a load is one undo step (ביטול in its toast), it is
 * saved against the map's version, and another lead's edit in between is a
 * conflict on screen rather than an overwrite.
 *
 * A difference, not a replacement: an item in both the map and the plan is
 * patched with only what differs, so an item the plan never moved is not
 * rewritten and its undo is empty. An item the map has and the plan does not
 * is removed; one the plan has and the map does not is added back under its
 * old id, which the server has freed. The lines follow the same rule.
 *
 * Three things the plan cannot do, each counted and named so the toast can
 * say so:
 * - A locked item stays exactly as it is — where it stands, what it is, what
 *   it is called — the rule every command keeps (spec §5). The lock is the
 *   lead's statement that the thing is where it goes, and a plan saved before
 *   the lock is not a newer statement. Named only when the plan would have
 *   changed it.
 * - A line whose end the plan cannot reach — an end that stayed locked as a
 *   kind the line's utility does not join — is not drawn: the server would
 *   refuse the whole batch for it, and a cable to nothing measures nothing.
 * - A task link to a task this season no longer has is dropped, and counted:
 *   the server refuses a link to a task that is not a build task of this
 *   season, and there is no other task to guess.
 *
 * A line is kept in place only when the plan has it with the same kind and
 * the same two ends, and neither end changes kind in this load; any other
 * line is taken off and drawn again from the plan, checked against the map
 * as it will then stand. Two ops on one id, a removal and an addition, keep
 * their order through the queue and undo in reverse, so this is safe and
 * simple where a patch of an end would not be.
 */

export interface RestoreSource {
  items: readonly EditorItem[];
  lines: readonly EditorLine[];
}

export interface RestoreResult {
  ops: SiteOp[];
  /** Locked items the plan would have changed, by name, each once. They stay as they are. */
  lockedNames: string[];
  /** Lines the plan holds that cannot be drawn on the map as it will stand, by name. */
  droppedLineNames: string[];
  /** Items whose task link named a task this season no longer has; the link is dropped. */
  tasksCleared: number;
}

/** Every patchable field of a kept item, as a patch. `sort` is not patchable and stays the map's. */
function fullPatch(target: EditorItem, taskId: string | null): ItemPatch {
  return {
    label: target.label, kind: target.kind, xCm: target.xCm, yCm: target.yCm,
    widthCm: target.widthCm, depthCm: target.depthCm, heightCm: target.heightCm,
    insetCm: target.insetCm, ropeAngleDeg: target.ropeAngleDeg ?? null, taskId, notes: target.notes,
    // A plan saved before facings has none: that is the drawn orientation, as the server reads it.
    facing: target.facing ?? 0,
    locked: target.locked, groupId: groupIdOf(target),
  };
}

/**
 * The ops that load `plan` over `doc`. `taskIds` are the build tasks this
 * season has, the only ones the server lets an item link to.
 */
export function restoreOps(doc: EditorDoc, plan: RestoreSource, taskIds: ReadonlySet<string>): RestoreResult {
  const targets = new Map(plan.items.map((entry) => [entry.id, entry]));
  const targetLines = new Map(plan.lines.map((entry) => [entry.id, entry]));
  const ops: SiteOp[] = [];
  const lockedNames: string[] = [];
  const droppedLineNames: string[] = [];
  let tasksCleared = 0;
  let working = doc;

  /* Applied one at a time to a working copy, so a later op is built against
     the map as the earlier ones leave it — the way the server checks a batch. */
  const push = (op: SiteOp): void => {
    const applied = applyOps(working, [op]);
    if (applied.skipped.length > 0) return;
    working = applied.doc;
    ops.push(op);
  };

  const taskOf = (target: EditorItem): string | null => {
    if (target.taskId === null || target.taskId === undefined) return null;
    if (taskIds.has(target.taskId)) return target.taskId;
    tasksCleared += 1;
    return null;
  };

  /** The kind an item will have once this load is done: the plan's, unless a lock keeps the map's. */
  const kindAfter = (id: string): EditorItem['kind'] | undefined => {
    const current = findItem(doc, id);
    const target = targets.get(id);
    if (current?.locked === true) return current.kind;
    return target?.kind ?? current?.kind;
  };

  // 1. Lines the map has that the plan does not keep in place come off first, so nothing hangs from an item that goes or changes.
  for (const line of doc.lines) {
    const target = targetLines.get(line.id);
    const keptInPlace = target !== undefined
      && target.kind === line.kind && target.fromId === line.fromId && target.toId === line.toId
      && kindAfter(line.fromId) === findItem(doc, line.fromId)?.kind
      && kindAfter(line.toId) === findItem(doc, line.toId)?.kind;
    if (!keptInPlace) push({ type: 'removeLine', id: line.id });
  }

  // 2. Items the plan does not have go; a locked one stays, and is named.
  for (const item of doc.items) {
    if (targets.has(item.id)) continue;
    if (item.locked) {
      lockedNames.push(item.label);
      continue;
    }
    for (const line of linesAt(working, item.id)) push({ type: 'removeLine', id: line.id });
    push({ type: 'remove', id: item.id });
  }

  // 3. Items in both take the plan's fields — only what differs. A locked one stays, named if the plan would have changed it.
  for (const item of doc.items) {
    const target = targets.get(item.id);
    if (target === undefined) continue;
    if (item.locked) {
      /* Named when the plan holds it otherwise — moved, resized, renamed,
         regrouped. Not for the lock itself: a lock made since the plan was
         saved is the lead's later word, not a difference the plan refused.
         Read against the plan's own task link, so a stale link alone does
         not count either. */
      const held = fullPatch(target, target.taskId ?? null);
      delete held.locked;
      if (changedUpdate(item, held) !== null) lockedNames.push(item.label);
      continue;
    }
    const patch = changedUpdate(item, fullPatch(target, taskOf(target)));
    if (patch !== null) push(patch);
  }

  // 4. Items the map lacks come back under their old ids, in the plan's draw order.
  for (const target of plan.items) {
    if (findItem(doc, target.id) !== undefined) continue;
    push({
      type: 'add',
      item: {
        ...target, taskId: taskOf(target), ropeAngleDeg: target.ropeAngleDeg ?? null, facing: target.facing ?? 0,
        groupId: groupIdOf(target),
      },
    });
  }

  // 5. The plan's lines: a kept one takes its label, bends and notes; any other is drawn, if its ends can take it.
  for (const target of plan.lines) {
    const kept = working.lines.find((line) => line.id === target.id);
    if (kept !== undefined) {
      const patch = changedLineUpdate(kept, { label: target.label, points: target.points, notes: target.notes });
      if (patch !== null) push(patch);
      continue;
    }
    const from = findItem(working, target.fromId);
    const to = findItem(working, target.toId);
    if (lineEndsRefusal(target.kind, from, to) !== null) {
      droppedLineNames.push(target.label);
      continue;
    }
    push({ type: 'addLine', line: { ...target, points: target.points.map((p) => [p[0], p[1]]) } });
  }

  return {
    ops,
    lockedNames: [...new Set(lockedNames)],
    droppedLineNames: [...new Set(droppedLineNames)],
    tasksCleared,
  };
}
