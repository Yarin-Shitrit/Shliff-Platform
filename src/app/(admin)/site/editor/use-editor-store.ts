import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionResult } from '@/lib/action-result';
import { derive } from '@/lib/site/derive';
import { EMPTY_HISTORY, record, redo as redoStep, undo as undoStep, type History } from '@/lib/site/editor/history';
import { findItem, type EditorDoc, type EditorItem } from '@/lib/site/editor/model';
import { applyOps, invertOps, lockRefusal, type ItemPatch, type SiteOp } from '@/lib/site/editor/ops';
import { SaveQueue, type QueueSnapshot, type SaveFn } from './save-queue';

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
  run(label: string, ops: SiteOp[], selection?: string[]): void;
  undo(): string | null;
  redo(): string | null;
  select(ids: string[]): void;
  resolveConflict(choice: 'theirs' | 'mine'): Promise<void>;
  retrySave(): void;
  dismissNotice(): void;
}

interface StoreState {
  doc: EditorDoc;
  selection: string[];
  history: History;
  notice: string | null;
}

/** When the map could not be read back after a conflict and the server said nothing usable. */
const LOAD_FAILED = 'לא הצלחנו לטעון את המפה העדכנית. אפשר לנסות שוב.';
/**
 * When an undo or redo names items the map no longer has, or would refuse
 * because another lead locked them meanwhile (Review Focus #3; controller
 * ruling S1 folds a lock refusal into the same "partly applied" notice).
 */
const PARTLY_APPLIED = 'חלק מהפעולה לא בוצע, כי פריטים שהיא נוגעת בהם כבר לא במפה.';

/** Only ids the map still has, each once, in the order given. */
function existing(doc: EditorDoc, ids: readonly string[]): string[] {
  const present = new Set(doc.items.map((item) => item.id));
  return [...new Set(ids)].filter((id) => present.has(id));
}

/**
 * Applies what can be applied, one op at a time, and returns which ops
 * landed. An op naming an item that is gone is skipped, never thrown — and so
 * is an update `lockRefusal` would refuse against the doc as it stands right
 * now (controller ruling S1): another lead may have locked the item since
 * this lead's history entry was recorded.
 */
function applyEach(doc: EditorDoc, ops: readonly SiteOp[]): { doc: EditorDoc; applied: SiteOp[]; skipped: number } {
  let next = doc;
  const applied: SiteOp[] = [];
  let skipped = 0;
  for (const op of ops) {
    if (op.type === 'update' && lockRefusal(findItem(next, op.id)?.locked ?? false, op.patch) !== null) {
      skipped += 1;
      continue;
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
 * update of that item instead of being dropped. `locked` is left out on
 * purpose, so replaying this lead's add can never silently unlock an item the
 * other lead locked — it goes through `lockRefusal` like any other update.
 */
function itemPatch(item: EditorItem): ItemPatch {
  return {
    label: item.label, kind: item.kind, xCm: item.xCm, yCm: item.yCm,
    widthCm: item.widthCm, depthCm: item.depthCm, heightCm: item.heightCm,
    insetCm: item.insetCm, taskId: item.taskId, notes: item.notes,
  };
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
  }, [initial]);

  const run = useCallback((label: string, ops: SiteOp[], selection?: string[]) => {
    const current = latest.current;
    const { doc, applied } = applyEach(current.doc, ops);
    const nextSelection = existing(doc, selection ?? current.selection);
    if (applied.length === 0) {
      if (selection !== undefined) commit({ ...current, selection: nextSelection });
      return;
    }
    const inverse = invertOps(current.doc, applied);
    commit({
      ...current,
      doc,
      selection: nextSelection,
      history: record(current.history, { label, ops: applied, inverse }),
    });
    queueRef.current?.enqueue(applied);
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

  const select = useCallback((ids: string[]) => {
    const current = latest.current;
    commit({ ...current, selection: existing(current.doc, ids) });
  }, [commit]);

  /**
   * The conflict banner's two answers (spec §6.4). Both start from the map
   * as the server has it now. 'theirs' takes it as it is; 'mine' replays what
   * is unsent on top of it, minus anything about an item that is gone or
   * locked — and says which items those were, by the names the lead knew
   * them by, never by id (controller ruling S2).
   *
   * 'theirs' is also the reload a refused batch offers.
   */
  const resolveConflict = useCallback(async (choice: 'theirs' | 'mine') => {
    const loaded = await initial.load();
    const current = latest.current;
    if (!loaded.ok || loaded.value === undefined) {
      commit({ ...current, notice: loaded.ok ? LOAD_FAILED : loaded.error });
      return;
    }
    const { doc: serverDoc, version } = loaded.value;
    const queue = queueRef.current;

    if (choice === 'theirs') {
      queue?.reset(version);
      commit({ ...current, doc: serverDoc, selection: existing(serverDoc, current.selection), notice: null });
      return;
    }

    // Replayed one op at a time against a doc that carries every kept op
    // before it, the way the server itself checks a batch (`plan.ts`) — so a
    // second op about an item the first op just touched sees it as it now is.
    let merging = serverDoc;
    const kept: SiteOp[] = [];
    const dropped: string[] = [];
    for (const raw of queue?.pendingOps() ?? []) {
      // S2: an add whose id the server already has becomes an update of that
      // item, rather than being dropped.
      const op: SiteOp = raw.type === 'add' && findItem(merging, raw.item.id) !== undefined
        ? { type: 'update', id: raw.item.id, patch: itemPatch(raw.item) }
        : raw;

      // S2: a remove of an item already gone does the same thing either way
      // — dropped without a word.
      if (op.type === 'remove' && findItem(merging, op.id) === undefined) continue;

      if (op.type === 'update') {
        const entry = findItem(merging, op.id);
        if (entry === undefined) {
          dropped.push(findItem(current.doc, op.id)?.label ?? 'פריט');
          continue;
        }
        // S1: a lock another lead applied refuses this op the same as a
        // missing item would.
        if (lockRefusal(entry.locked, op.patch) !== null) {
          dropped.push(entry.label);
          continue;
        }
      }

      merging = applyOps(merging, [op]).doc;
      kept.push(op);
    }

    queue?.rebase(version, kept);
    const names = [...new Set(dropped)];
    commit({
      ...current,
      doc: merging,
      selection: existing(merging, current.selection),
      notice: names.length === 0 ? null : `לא נשמרו שינויים בפריטים שכבר לא במפה: ${names.join(', ')}.`,
    });
  }, [commit, initial]);

  const retrySave = useCallback(() => { void queueRef.current?.retry(); }, []);

  const dismissNotice = useCallback(() => {
    commit({ ...latest.current, notice: null });
  }, [commit]);

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
  };
}
