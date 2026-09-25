import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionResult } from '@/lib/action-result';
import { derive } from '@/lib/site/derive';
import { changedLineUpdate, changedUpdate } from '@/lib/site/editor/commands';
import { EMPTY_HISTORY, record, redo as redoStep, undo as undoStep, type History } from '@/lib/site/editor/history';
import { findItem, findLine, type EditorDoc, type EditorItem, type EditorLine } from '@/lib/site/editor/model';
import {
  applyOps, invertOps, lineEndsRefusal, lockRefusal, type ItemPatch, type LinePatch, type SiteOp,
} from '@/lib/site/editor/ops';
import { SaveQueue, type QueueSnapshot, type SaveFn } from './save-queue';
import { isolate } from './notices';

/**
 * The editor's single source of truth once the page has loaded (spec §6.1).
 * Every edit is applied here first — the screen changes the moment the lead
 * lets go — and then handed to the save queue, which gets it to the server
 * in the background. There is no `router.refresh()` anywhere in this path:
 * reloading rows mid-edit is what made the old board jump.
 */

export interface EditorFlags {
  outside: Set<string>;
  overlapping: Set<string>;
  /** Touching a net but not inside what it shades — the sofa in the sag strip. */
  partly: Set<string>;
  pairs: Array<[string, string]>;
}

export interface EditorStoreInit {
  doc: EditorDoc;
  version: number;
  selection?: string[];
  save: SaveFn;
  load: () => Promise<ActionResult<{ doc: EditorDoc; version: number }>>;
  /**
   * Edits an earlier page of this map left unsaved — its build was replaced
   * by a deploy (review I2). Replayed once the store is up, through 'mine':
   * the latest map, with what still applies on top and the rest named.
   */
  pending?: SiteOp[];
}

export interface EditorStore {
  doc: EditorDoc;
  selection: string[];
  flags: EditorFlags;
  canUndo: boolean;
  canRedo: boolean;
  save: QueueSnapshot;
  conflict: { version: number } | null;
  notice: string | null;
  /** Applies, records and enqueues; true when a step was recorded (review minor, additive). */
  run(label: string, ops: SiteOp[], selection?: string[]): boolean;
  undo(): string | null;
  redo(): string | null;
  select(ids: string[]): void;
  resolveConflict(choice: 'theirs' | 'mine'): Promise<void>;
  retrySave(): void;
  dismissNotice(): void;
  /** What is not yet confirmed saved, in order — for keeping it across a page refresh (review I2). */
  pendingOps(): SiteOp[];
}

interface StoreState {
  doc: EditorDoc;
  selection: string[];
  history: History;
  notice: string | null;
}

/** When the map could not be read back after a conflict and the server said nothing usable — including when the reload itself threw (offline). */
const LOAD_FAILED = 'לא הצלחנו לטעון את המפה העדכנית. אפשר לנסות שוב.';
/**
 * When an undo or redo names items the map no longer has, or would refuse
 * because another lead locked them meanwhile (Review Focus #3; controller
 * ruling S1 folds a lock refusal into the same "partly applied" notice).
 * Neither case names an item: what an undo touches can be several things at
 * once, so this stays generic on purpose.
 */
const PARTLY_APPLIED = 'חלק מהפעולה לא בוצע, כי פריטים שהיא נוגעת בהם כבר לא במפה.';

/** Said once the edits an earlier page left unsaved (a deploy replaced its build) are saved (#25 fix round, Minor 7). */
const REPLAYED = 'השינויים שלא נשמרו לפני רענון הדף שוחזרו ונשמרו.';

/** Changes to items another lead removed: not saved, named by what this lead called them. */
const goneSentence = (names: readonly string[]) =>
  `לא נשמרו שינויים בפריטים שכבר לא במפה: ${names.map(isolate).join(', ')}.`;

/** Only ids the map still has — items and lines — each once, in the order given. */
function existing(doc: EditorDoc, ids: readonly string[]): string[] {
  const present = new Set([...doc.items.map((item) => item.id), ...doc.lines.map((line) => line.id)]);
  return [...new Set(ids)].filter((id) => present.has(id));
}

/**
 * Applies what can be applied, one op at a time, and returns which ops
 * landed. Three things drop an op instead of throwing:
 * - it names an item that is gone;
 * - reduced to only the fields that actually differ from the item
 *   (`changedUpdate`, the same helper `commands.ts` builds every op with —
 *   ruling 6), an update turns out to change nothing at all: dropped
 *   silently, neither a skip nor a step, so it is never recorded or sent;
 * - `lockRefusal` would refuse it against the doc as it stands right now
 *   (controller ruling S1) — an update whose *reduced* patch still touches a
 *   locked field, or a remove of a locked item outright. Another lead may
 *   have locked the item since this lead's history entry was recorded.
 */
function applyEach(doc: EditorDoc, ops: readonly SiteOp[]): { doc: EditorDoc; applied: SiteOp[]; skipped: number } {
  let next = doc;
  const applied: SiteOp[] = [];
  let skipped = 0;
  for (const raw of ops) {
    let op: SiteOp = raw;
    if (raw.type === 'update') {
      const entry = findItem(next, raw.id);
      if (entry !== undefined) {
        const reduced = changedUpdate(entry, raw.patch);
        if (reduced === null) continue; // nothing actually changes: not a skip, not a step
        if (lockRefusal(entry.locked, reduced.patch) !== null) {
          skipped += 1;
          continue;
        }
        op = reduced;
      }
    } else if (raw.type === 'remove' && findItem(next, raw.id)?.locked === true) {
      skipped += 1;
      continue;
    } else if (raw.type === 'updateLine') {
      // The same reduction for a line; a line has no lock.
      const entry = findLine(next, raw.id);
      if (entry !== undefined) {
        const reduced = changedLineUpdate(entry, raw.patch);
        if (reduced === null) continue;
        op = reduced;
      }
    }
    const result = applyOps(next, [op]);
    if (result.skipped.length > 0) {
      skipped += 1;
      continue;
    }
    next = result.doc;
    applied.push(op);
  }
  return { doc: next, applied, skipped };
}

/**
 * A full item's fields as a patch — used when 'mine' finds a pending add
 * whose id the server already has (controller ruling S2): the add becomes an
 * update of that item instead of being dropped, then reduced by
 * `changedUpdate` (ruling 6) to only what actually differs — nothing at all
 * when the add had already landed and only the reply was lost. `locked` is
 * left out on purpose, so replaying this lead's add can never silently
 * unlock an item the other lead locked — it goes through `lockRefusal` like
 * any other update.
 */
function itemPatch(item: EditorItem): ItemPatch {
  return {
    label: item.label, kind: item.kind, xCm: item.xCm, yCm: item.yCm,
    widthCm: item.widthCm, depthCm: item.depthCm, heightCm: item.heightCm,
    insetCm: item.insetCm, taskId: item.taskId, notes: item.notes,
  };
}

/** A full line's fields as a patch, for the same replay of an add the server already has. Its kind is not patchable. */
function linePatch(line: EditorLine): LinePatch {
  return { label: line.label, fromId: line.fromId, toId: line.toId, points: line.points, notes: line.notes };
}

function computeFlags(doc: EditorDoc): EditorFlags {
  const derived = derive(doc.plot, doc.items);
  const flags: EditorFlags = { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: derived.pairs };
  for (const item of derived.items) {
    if (item.outside) flags.outside.add(item.id);
    if (item.overlapping) flags.overlapping.add(item.id);
    if (item.shade === 'partly') flags.partly.add(item.id);
  }
  return flags;
}

export function useEditorStore(init: EditorStoreInit): EditorStore {
  /* The first `init` is the store's; a later one is ignored, the way a
     `useState` initial value is. The page loads once (spec §6.1). */
  const [initial] = useState(init);
  const [state, setState] = useState<StoreState>(() => ({
    doc: initial.doc,
    selection: existing(initial.doc, initial.selection ?? []),
    history: EMPTY_HISTORY,
    notice: null,
  }));
  const [save, setSave] = useState<QueueSnapshot>(
    () => ({ status: 'saved', version: initial.version, pending: 0, error: null, errorKind: null }),
  );

  /* The latest state, for commands that run twice before React re-renders
     (a drag's commit followed at once by a keyboard nudge). Written only in
     event handlers and effects, never during render. */
  const latest = useRef(state);
  const queueRef = useRef<SaveQueue | null>(null);
  const versionRef = useRef(initial.version);
  /** Guards `resolveConflict` against a second call while the first is still
   *  awaiting its `load()` — two reloads racing would both build a merge off
   *  a stale `latest.current` and one would clobber the other's result. */
  const resolvingRef = useRef(false);
  /** An earlier page's edits are being replayed through 'mine' (review I2). */
  const replaying = useRef(false);
  /** The replayed edits are to be announced once the queue reports them saved. */
  const announceReplay = useRef(false);

  const commit = useCallback((next: StoreState) => {
    latest.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    const queue = new SaveQueue({
      send: initial.save,
      version: versionRef.current,
      onChange: (snapshot) => {
        versionRef.current = snapshot.version;
        setSave(snapshot);
        // The earlier page's edits, replayed, are now on the server: say so, before anything 'mine' named.
        if (announceReplay.current && snapshot.status === 'saved' && snapshot.pending === 0) {
          announceReplay.current = false;
          const current = latest.current;
          commit({ ...current, notice: current.notice === null ? REPLAYED : `${REPLAYED} ${current.notice}` });
        }
      },
      /* The server skipped changes to items another lead removed (review
         C2). They leave this map too — the server has no such item — named
         by what this lead called them. A removal already gone here says
         nothing: it did what it was asked. */
      onSkipped: (ids) => {
        const current = latest.current;
        const gone = new Set(ids.filter((id) => findItem(current.doc, id) !== undefined));
        if (gone.size === 0) return;
        const names = current.doc.items.filter((entry) => gone.has(entry.id)).map((entry) => entry.label);
        const doc = { ...current.doc, items: current.doc.items.filter((entry) => !gone.has(entry.id)) };
        commit({ ...current, doc, selection: existing(doc, current.selection), notice: goneSentence(names) });
      },
    });
    queueRef.current = queue;

    /* The spec's two moments to stop waiting: the tab is going to the
       background, or the page is going away. */
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void queue.flush();
    };
    const onPageHide = () => { void queue.flush(); };
    /* Warn before the tab closes while anything is unsent — pending, in
       flight, refused or waiting on a conflict. */
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (queue.snapshot.pending > 0) event.preventDefault();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Whatever is waiting goes out now; its answer has nobody to tell.
      void queue.flush();
      queue.dispose();
      if (queueRef.current === queue) queueRef.current = null;
    };
  }, [initial, commit]); // `commit` is stable: the queue is still made once per `initial`

  /* True when a step was recorded. The ops are checked against the map as it
     is now, which can be newer than the one the caller built them from (a
     conflict answer landing between two renders): a caller that says what
     its edit did says so only when there was one (review minor, P6). */
  const run = useCallback((label: string, ops: SiteOp[], selection?: string[]): boolean => {
    const current = latest.current;
    const { doc, applied } = applyEach(current.doc, ops);
    const nextSelection = existing(doc, selection ?? current.selection);
    if (applied.length === 0) {
      if (selection !== undefined) commit({ ...current, selection: nextSelection });
      return false;
    }
    const inverse = invertOps(current.doc, applied);
    commit({
      ...current,
      doc,
      selection: nextSelection,
      history: record(current.history, { label, ops: applied, inverse }),
    });
    queueRef.current?.enqueue(applied);
    return true;
  }, [commit]);

  const step = useCallback((direction: 'undo' | 'redo'): string | null => {
    const current = latest.current;
    const taken = direction === 'undo' ? undoStep(current.history) : redoStep(current.history);
    if (taken === null) return null;
    const { doc, applied, skipped } = applyEach(current.doc, taken.ops);
    commit({
      ...current,
      doc,
      selection: existing(doc, current.selection),
      history: taken.history,
      notice: skipped > 0 ? PARTLY_APPLIED : current.notice,
    });
    queueRef.current?.enqueue(applied);
    return taken.label;
  }, [commit]);

  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);

  /* A marquee asks for the same selection on every pointer move: an
     unchanged one commits nothing, so nothing re-renders (review minor). */
  const select = useCallback((ids: string[]) => {
    const current = latest.current;
    const next = existing(current.doc, ids);
    if (next.length === current.selection.length && next.every((id, index) => id === current.selection[index])) return;
    commit({ ...current, selection: next });
  }, [commit]);

  /**
   * The conflict banner's two answers (spec §6.4). Both start from the map
   * as the server has it now. 'theirs' takes it as it is; 'mine' replays what
   * is unsent on top of theirs, every op checked against the doc it is about
   * to touch, same as `run`. Both clear undo/redo: every entry's inverse was
   * computed against a document that no longer exists, so an undo replayed
   * on the server's map could silently overwrite the other lead's newer
   * values (a ruling that overrides the plan's original test for 'theirs';
   * review I5 extends it to 'mine', which used to keep history).
   * Either way, a dropped op says which items those were, by the names the
   * lead knew them by, never by id (controller ruling S2) — a lock refusal
   * and a missing item get their own sentence (Review Focus #4), so "locked"
   * is never reported as "no longer on the map".
   *
   * 'theirs' is also the reload a refused batch offers. A second call while
   * one is already awaiting `load()` is ignored outright (`resolvingRef`),
   * and a `load()` that throws — offline — is caught rather than left to
   * reject unhandled: the conflict stays open, with a Hebrew notice, so the
   * lead can try again.
   */
  const resolveConflict = useCallback(async (choice: 'theirs' | 'mine') => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    try {
      let loaded: ActionResult<{ doc: EditorDoc; version: number }>;
      try {
        loaded = await initial.load();
      } catch {
        commit({ ...latest.current, notice: LOAD_FAILED });
        return;
      }
      const current = latest.current;
      if (!loaded.ok || loaded.value === undefined) {
        commit({ ...current, notice: loaded.ok ? LOAD_FAILED : loaded.error });
        return;
      }
      const { doc: serverDoc, version } = loaded.value;
      const queue = queueRef.current;

      if (choice === 'theirs') {
        queue?.reset(version);
        commit({
          ...current,
          doc: serverDoc,
          selection: existing(serverDoc, current.selection),
          history: EMPTY_HISTORY,
          notice: null,
        });
        return;
      }

      // Replayed one op at a time against a doc that carries every kept op
      // before it, the way the server itself checks a batch (`plan.ts`) — so
      // a second op about an item the first op just touched sees it as it
      // now is.
      let merging = serverDoc;
      const kept: SiteOp[] = [];
      const goneNames: string[] = [];
      const lockedNames: string[] = [];
      for (const raw of queue?.pendingOps() ?? []) {
        let op: SiteOp = raw;

        // S2: an add whose id the server already has becomes an update of
        // that item — reduced below, with every other update, to only the
        // fields that actually differ.
        if (raw.type === 'add') {
          const existingEntry = findItem(merging, raw.item.id);
          if (existingEntry !== undefined) op = { type: 'update', id: raw.item.id, patch: itemPatch(raw.item) };
        }

        // The lines, by the same rules. An add the server already has becomes
        // an update; a line whose end the other lead removed is dropped and
        // named, since the server would refuse the whole batch for it.
        if (raw.type === 'addLine' && findLine(merging, raw.line.id) !== undefined) {
          op = { type: 'updateLine', id: raw.line.id, patch: linePatch(raw.line) };
        }
        if (op.type === 'addLine') {
          if (lineEndsRefusal(op.line.kind, findItem(merging, op.line.fromId), findItem(merging, op.line.toId)) !== null) {
            goneNames.push(op.line.label);
            continue;
          }
        }
        if (op.type === 'removeLine' && findLine(merging, op.id) === undefined) continue;
        if (op.type === 'updateLine') {
          const entry = findLine(merging, op.id);
          if (entry === undefined) {
            goneNames.push(findLine(current.doc, op.id)?.label ?? 'קו');
            continue;
          }
          const reduced = changedLineUpdate(entry, op.patch);
          if (reduced === null) continue;
          const fromId = reduced.patch.fromId ?? entry.fromId;
          const toId = reduced.patch.toId ?? entry.toId;
          if (lineEndsRefusal(entry.kind, findItem(merging, fromId), findItem(merging, toId)) !== null) {
            goneNames.push(entry.label);
            continue;
          }
          op = reduced;
        }

        // S2: a remove of an item already gone does the same thing either
        // way — dropped without a word. One a lock refuses is not the same
        // thing either way: named, in its own sentence (Review Focus #4).
        if (op.type === 'remove') {
          const entry = findItem(merging, op.id);
          if (entry === undefined) continue;
          if (entry.locked) { lockedNames.push(entry.label); continue; }
        }

        if (op.type === 'update') {
          const entry = findItem(merging, op.id);
          if (entry === undefined) {
            goneNames.push(findItem(current.doc, op.id)?.label ?? 'פריט');
            continue;
          }
          // Ruling 6: reduced against the doc this op is about to touch —
          // an already-pending update (or an add just turned into one,
          // above) may by now match the server's own value exactly, and
          // `lockRefusal` refuses on field presence, not value, so this must
          // happen *before* that check: a no-op must never be reported as a
          // lock refusal, and must never be resent as if it were real.
          const reduced = changedUpdate(entry, op.patch);
          if (reduced === null) continue;
          // S1: a lock another lead applied refuses this op the same as a
          // missing item would refuse it — but it is named separately.
          if (lockRefusal(entry.locked, reduced.patch) !== null) {
            lockedNames.push(entry.label);
            continue;
          }
          op = reduced;
        }

        merging = applyOps(merging, [op]).doc;
        kept.push(op);
      }

      // A replay of an earlier page's edits is announced once what it kept is saved — here, before the rebase sends it.
      if (replaying.current) {
        replaying.current = false;
        announceReplay.current = kept.length > 0;
      }
      queue?.rebase(version, kept);
      const sentences: string[] = [];
      const gone = [...new Set(goneNames)];
      const locked = [...new Set(lockedNames)];
      if (gone.length > 0) sentences.push(goneSentence(gone));
      if (locked.length > 0) sentences.push(`לא נשמרו שינויים בפריטים נעולים: ${locked.map(isolate).join(', ')}.`);
      commit({
        ...current,
        doc: merging,
        selection: existing(merging, current.selection),
        history: EMPTY_HISTORY, // review I5: the map under every entry was replaced
        notice: sentences.length === 0 ? null : sentences.join(' '),
      });
    } finally {
      resolvingRef.current = false;
    }
  }, [commit, initial]);

  const retrySave = useCallback(() => { void queueRef.current?.retry(); }, []);

  const dismissNotice = useCallback(() => {
    commit({ ...latest.current, notice: null });
  }, [commit]);

  const pendingOps = useCallback(() => queueRef.current?.pendingOps() ?? [], []);

  /* Review I2: edits an earlier page of this map left unsaved (its build was
     replaced by a deploy) are replayed through 'mine' — the latest map, with
     what still applies on top and the rest named — never simply resent
     against whatever the page loaded. They are carried, not enqueued (#25
     fix round, Important 2): kept apart as they were and held, so the
     half-second clock cannot send them raw before 'mine' has the map, even
     when it loads slowly or the lead edits meanwhile. If the map cannot be
     loaded they go as they are rather than wait forever. Once they are
     saved the lead is told (Minor 7). Keyed on the queue rather than a flag,
     so a remount's new queue gets them too. */
  const replayedInto = useRef<SaveQueue | null>(null);
  useEffect(() => {
    const queue = queueRef.current;
    const carried = initial.pending ?? [];
    if (queue === null || carried.length === 0 || replayedInto.current === queue) return;
    replayedInto.current = queue;
    replaying.current = true;
    queue.carry(carried);
    void resolveConflict('mine').then(() => {
      // Still replaying: the map could not be loaded. The edits go as they are.
      if (queueRef.current !== queue || !replaying.current) return;
      replaying.current = false;
      announceReplay.current = queue.pendingOps().length > 0;
      queue.release();
    });
  }, [initial, resolveConflict]);

  const flags = useMemo(() => computeFlags(state.doc), [state.doc]);

  return {
    doc: state.doc,
    selection: state.selection,
    flags,
    canUndo: state.history.past.length > 0,
    canRedo: state.history.future.length > 0,
    save,
    conflict: save.status === 'conflict' ? { version: save.version } : null,
    notice: state.notice,
    run,
    undo,
    redo,
    select,
    resolveConflict,
    retrySave,
    dismissNotice,
    pendingOps,
  };
}
