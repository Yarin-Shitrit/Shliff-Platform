/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import { unnamedControls } from '@/test/a11y';
import type { EditorDoc, EditorItem, EditorPlot } from '@/lib/site/editor/model';
import type { SiteOp } from '@/lib/site/editor/ops';
import { NETWORK_FAILURE, type QueueSnapshot } from './save-queue';
import type { EditorStore, EditorStoreInit } from './use-editor-store';
import type { SceneHandle, SceneViewProps, ViewInfo } from './scene/scene-view';

/* This file's own fixture: a 26 × 24 m plot on a 50 cm grid, and a 3 × 2 m
   tent at (5 m, 5 m) — not square, so a quarter turn shows. */
function siteItem(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false,
    ...over,
  };
}

function siteDoc(items: EditorItem[], plot: Partial<EditorPlot> = {}): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0, ...plot }, items, defaults: {} };
}

const { saveSiteChangesAction, loadSiteDocAction } = vi.hoisted(() => ({
  saveSiteChangesAction: vi.fn(), loadSiteDocAction: vi.fn(),
}));
vi.mock('../actions', () => ({ saveSiteChangesAction, loadSiteDocAction }));

/*
 * `next/dynamic` as the app is built with it. Next aliases `next/dynamic` to
 * `app-dynamic` for the app router (`next/dist/build/create-compiler-aliases.js`,
 * `createAppRouterApiAliases`), whose loader hands every prop, `ref` included,
 * to the lazy component. Vitest has no such alias and resolves the pages
 * router's loader, which keeps the ref for itself (`{ retry }`), so the
 * scene's handle would never reach the editor here as it does on the page.
 */
vi.mock('next/dynamic', async () => ({
  default: (await import('next/dist/shared/lib/app-dynamic')).default,
}));

/**
 * The scene is `three` and WebGL and has its own tests (plan 03). Here it is
 * a stand-in that records what the editor hands it and answers the handle,
 * so the panels are tested without a GPU.
 */
const scene = vi.hoisted(() => ({
  props: vi.fn(),
  handle: {
    fitAll: vi.fn(), fitIds: vi.fn(), zoomBy: vi.fn(), rotateView: vi.fn(), northUp: vi.fn(),
    centreGround: vi.fn(), groundAtClient: vi.fn(), setGhost: vi.fn(), jumpTo: vi.fn(), exportPng: vi.fn(),
  },
}));
vi.mock('./scene/scene-view', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  const SceneView = forwardRef<SceneHandle, SceneViewProps>(function FakeScene(props, ref) {
    useImperativeHandle(ref, () => scene.handle as unknown as SceneHandle);
    scene.props(props);
    return <div data-testid="scene" />;
  });
  return { SceneView };
});

/*
 * The store is Task 16's and has its own tests. Here it is a stand-in that
 * keeps the contract (overview, "Store and scene"): `run`, `undo` and `redo`
 * apply ops with the real `applyOps`, `invertOps` and history, so a key press
 * is checked against the map it changed. The save snapshot and the notice are
 * set by each test, so the top bar and the banners are checked in every state
 * the save queue can be in; what the lead chooses is recorded, not performed.
 */
const SAVED: QueueSnapshot = { status: 'saved', version: 0, pending: 0, error: null, errorKind: null };

const fake = vi.hoisted(() => {
  type Outside = { save: QueueSnapshot; notice: string | null };
  const listeners = new Set<() => void>();
  let outside: Outside | null = null;
  return {
    init: vi.fn<(init: EditorStoreInit) => void>(),
    resolveConflict: vi.fn<(choice: 'theirs' | 'mine') => Promise<void>>(),
    retrySave: vi.fn<() => void>(),
    dismissNotice: vi.fn<() => void>(),
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    read(): Outside {
      if (outside === null) throw new Error('the stand-in store was not reset');
      return outside;
    },
    /** What the save queue would report, and what the store would say — then every subscriber re-reads. */
    set(next: Outside): void {
      outside = next;
      for (const listener of listeners) listener();
    },
  };
});

vi.mock('./use-editor-store', async () => {
  const { useRef, useState, useSyncExternalStore } = await import('react');
  const { applyOps, invertOps } = await import('@/lib/site/editor/ops');
  const history = await import('@/lib/site/editor/history');

  type Held = { doc: EditorDoc; selection: string[]; past: ReturnType<typeof history.record> };

  function useEditorStore(init: EditorStoreInit): EditorStore {
    fake.init(init);
    const [held, setHeld] = useState<Held>(() => ({
      doc: init.doc, selection: init.selection ?? [], past: history.EMPTY_HISTORY,
    }));
    const latest = useRef(held);
    const { save, notice } = useSyncExternalStore(fake.subscribe, fake.read);

    function commit(next: Held): void {
      latest.current = next;
      setHeld(next);
    }

    function step(taken: ReturnType<typeof history.undo>): string | null {
      if (taken === null) return null;
      const current = latest.current;
      commit({ ...current, doc: applyOps(current.doc, taken.ops).doc, past: taken.history });
      return taken.label;
    }

    return {
      doc: held.doc,
      selection: held.selection,
      flags: { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: [] },
      canUndo: held.past.past.length > 0,
      canRedo: held.past.future.length > 0,
      save,
      conflict: save.status === 'conflict' ? { version: save.version } : null,
      notice,
      run(label: string, ops: SiteOp[], selection?: string[]) {
        const current = latest.current;
        commit({
          doc: applyOps(current.doc, ops).doc,
          selection: selection ?? current.selection,
          past: history.record(current.past, { label, ops, inverse: invertOps(current.doc, ops) }),
        });
      },
      undo: () => step(history.undo(latest.current.past)),
      redo: () => step(history.redo(latest.current.past)),
      select(ids: string[]) {
        commit({ ...latest.current, selection: ids });
      },
      resolveConflict: fake.resolveConflict,
      retrySave: fake.retrySave,
      dismissNotice: fake.dismissNotice,
    };
  }

  return { useEditorStore };
});

import { SiteEditor, type SiteEditorProps } from './site-editor';

const PLOT_HREF = '/site?season=s26&act=plot';
const VIEW: ViewInfo = { yaw: 0, zoomPct: 100, pxPerM: 20, groundCorners: [], selectionBox: null, moving: false };
const CONFLICT = 'המפה שונתה ממקום אחר מאז שנפתחה. השינויים האחרונים שלך עוד לא נשמרו.';

/** jsdom has no `matchMedia`; this answers the editor's two questions. */
function stubMedia({ wide = true, dark = false }: { wide?: boolean; dark?: boolean } = {}): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width') ? wide : query.includes('dark') ? dark : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeAll(() => {
  stubMedia();
});

beforeEach(() => {
  vi.clearAllMocks();
  stubMedia();
  fake.set({ save: SAVED, notice: null });
  fake.resolveConflict.mockResolvedValue(undefined);
  saveSiteChangesAction.mockResolvedValue({ ok: true, version: 1 });
  loadSiteDocAction.mockResolvedValue({ ok: false, error: 'המפה לא נטענה' });
  delete document.documentElement.dataset.theme;
});

function renderEditor(over: Partial<SiteEditorProps> = {}) {
  const props: SiteEditorProps = {
    initial: { doc: siteDoc([siteItem({ id: 'a' })]), version: 0 },
    initialSelection: 'a',
    seasonName: 'ברן 26',
    sunDate: '2026-06-04',
    buildTasks: [],
    plotHref: PLOT_HREF,
    ...over,
  };
  return render(<ToastProvider><SiteEditor {...props} /></ToastProvider>);
}

function lastScene(): SceneViewProps {
  const call = scene.props.mock.lastCall;
  if (call === undefined) throw new Error('the scene never rendered');
  return call[0] as SceneViewProps;
}

function saving(save: Partial<QueueSnapshot>): void {
  act(() => { fake.set({ save: { ...SAVED, ...save }, notice: null }); });
}

/** A promise the test settles by hand, to see the banner while the store is still loading. */
function held(): { promise: Promise<void>; settle: () => void } {
  let settle = () => {};
  const promise = new Promise<void>((resolve) => { settle = resolve; });
  return { promise, settle };
}

const stage = () => screen.getByRole('region', { name: 'מפת הקאמפ' });
const firstItem = () => lastScene().store.doc.items[0];
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('the editor shell', () => {
  it('mounts the scene with the loaded map, the room the panels leave, and the page’s theme', async () => {
    document.documentElement.dataset.theme = 'dark';
    const { container } = renderEditor();
    await screen.findByTestId('scene');
    const props = lastScene();
    expect(props.store.doc.items.map((item) => item.id)).toEqual(['a']);
    expect(props.store.selection).toEqual(['a']);
    expect(props.insets).toEqual({ left: 316, right: 280, top: 56, bottom: 64 });
    expect(props.ui).toMatchObject({ tool: 'select', mode: '3d', theme: 'dark', sun: false });
    expect(props.sunDate).toBe('2026-06-04');
    expect(screen.getByRole('link', { name: 'הגדרות המגרש' }).getAttribute('href')).toBe(PLOT_HREF);
    expect(unnamedControls(container)).toEqual([]);
  });

  it('flies to the item a deep link names, once, when the scene is up', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    act(() => { lastScene().onView(VIEW); });
    expect(scene.handle.fitIds).toHaveBeenCalledWith(['a']);
    act(() => { lastScene().onView({ ...VIEW, zoomPct: 150 }); });
    expect(scene.handle.fitIds).toHaveBeenCalledTimes(1);
  });

  it('hands the store this plot’s map, and saves and reloads against this plot', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    const init = fake.init.mock.calls[0][0];
    expect(init.version).toBe(0);
    expect(init.selection).toEqual(['a']);
    expect(init.doc.items.map((item) => item.id)).toEqual(['a']);
    const ops: SiteOp[] = [{ type: 'remove', id: 'a' }];
    await expect(init.save(3, ops)).resolves.toEqual({ ok: true, version: 1 });
    expect(saveSiteChangesAction).toHaveBeenCalledWith('p1', 3, ops);
    await init.load();
    expect(loadSiteDocAction).toHaveBeenCalledWith('p1');
  });

  it('lights the sun only for a real gate day, and never guesses one', async () => {
    const { unmount } = renderEditor({ sunDate: '2026-06-04' });
    await screen.findByTestId('scene');
    fireEvent.click(button('צל לפי שעה'));
    expect(lastScene().ui.sun).toBe(true);
    expect(lastScene().sunDate).toBe('2026-06-04');
    unmount();

    for (const sunDate of [null, '2026-02-31', 'soon']) {
      const rendered = renderEditor({ sunDate });
      await screen.findByTestId('scene');
      fireEvent.click(button('צל לפי שעה'));
      // The switch shows the lead's choice; the scene lights no sun without a day.
      expect(button('צל לפי שעה').getAttribute('aria-pressed')).toBe('true');
      expect(lastScene().ui.sun).toBe(false);
      expect(lastScene().sunDate).toBeNull();
      rendered.unmount();
    }
  });
});

describe('saving', () => {
  it('says every change is saved, then that it is saving, then saved again', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    expect(screen.getByText('כל השינויים נשמרו')).toBeTruthy();
    saving({ status: 'pending', pending: 1 });
    expect(screen.getByText('שומר…')).toBeTruthy();
    saving({ status: 'saving', pending: 1 });
    expect(screen.getByText('שומר…')).toBeTruthy();
    saving({ status: 'saved', version: 1 });
    expect(screen.getByText('כל השינויים נשמרו')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ניסיון חוזר' })).toBeNull();
  });

  it('keeps a retry on screen, with the reason, when the connection drops — and no reload', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    // The save queue's own sentence for a send that got no answer.
    saving({ status: 'error', errorKind: 'network', error: NETWORK_FAILURE, pending: 1 });
    expect(screen.getByText('לא נשמר —')).toBeTruthy();
    // Ruling P8 took the reload away from a dropped connection, not the reason.
    expect(screen.getByText(NETWORK_FAILURE)).toBeTruthy();
    // The retry is read with the reason, though they sit in two places.
    expect(screen.getByRole('button', { name: 'ניסיון חוזר', description: NETWORK_FAILURE })).toBeTruthy();
    fireEvent.click(button('ניסיון חוזר'));
    expect(fake.retrySave).toHaveBeenCalledTimes(1);
    // A reload would throw away what the lead did while offline (ruling P8).
    expect(screen.queryByRole('button', { name: 'טעינת הגרסה העדכנית' })).toBeNull();
    expect(fake.resolveConflict).not.toHaveBeenCalled();
  });

  it('says why the server refused a batch, and offers the way back beside the retry', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    saving({ status: 'error', errorKind: 'refused', error: 'הפריט כבר לא במפה.', pending: 1 });
    expect(screen.getByText('הפריט כבר לא במפה.')).toBeTruthy();
    expect(button('ניסיון חוזר')).toBeTruthy();
    const loading = held();
    fake.resolveConflict.mockReturnValueOnce(loading.promise);
    fireEvent.click(button('טעינת הגרסה העדכנית'));
    expect(fake.resolveConflict).toHaveBeenCalledWith('theirs');
    expect(button('טעינת הגרסה העדכנית').disabled).toBe(true);
    // While the map reloads, a retry would resend what the reload is about to drop.
    expect(button('ניסיון חוזר').disabled).toBe(true);
    fireEvent.click(button('ניסיון חוזר'));
    expect(fake.retrySave).not.toHaveBeenCalled();
    await act(async () => { loading.settle(); await loading.promise; });
    expect(button('טעינת הגרסה העדכנית').disabled).toBe(false);
    expect(button('ניסיון חוזר').disabled).toBe(false);
  });

  it('turns a stale version into a choice, and takes the other lead’s map only when chosen', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    saving({ status: 'conflict', version: 4, pending: 1 });
    expect(screen.getByText(CONFLICT)).toBeTruthy();
    expect(screen.getByText('לא נשמר — המפה שונתה ממקום אחר')).toBeTruthy();
    // A conflict is not retried: it is the lead's choice.
    expect(screen.queryByRole('button', { name: 'ניסיון חוזר' })).toBeNull();
    expect(fake.resolveConflict).not.toHaveBeenCalled();

    const loading = held();
    fake.resolveConflict.mockReturnValueOnce(loading.promise);
    fireEvent.click(button('טעינת הגרסה העדכנית'));
    expect(fake.resolveConflict).toHaveBeenCalledWith('theirs');
    // One answer at a time: both choices wait while the map loads.
    expect(button('טעינת הגרסה העדכנית').disabled).toBe(true);
    expect(button('שמירת השינויים שלי מעליה').disabled).toBe(true);
    await act(async () => { loading.settle(); await loading.promise; });
    saving({ status: 'saved', version: 4 });
    expect(screen.queryByText(CONFLICT)).toBeNull();
  });

  it('resends my changes over the new version when I keep them', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    saving({ status: 'conflict', version: 4, pending: 1 });
    fireEvent.click(button('שמירת השינויים שלי מעליה'));
    await waitFor(() => { expect(fake.resolveConflict).toHaveBeenCalledWith('mine'); });
    expect(fake.resolveConflict).toHaveBeenCalledTimes(1);
  });

  it('says what the store could not do, until the lead has read it', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    act(() => { fake.set({ save: SAVED, notice: 'לא נשמרו שינויים בפריטים שכבר לא במפה: אוהל 1.' }); });
    expect(screen.getByText('לא נשמרו שינויים בפריטים שכבר לא במפה: אוהל 1.')).toBeTruthy();
    fireEvent.click(button('הבנתי'));
    expect(fake.dismissNotice).toHaveBeenCalledTimes(1);
  });
});

describe('the keyboard', () => {
  it('reads a shortcut by the key’s place, so a Hebrew layout turns the item too', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'KeyR', key: 'ר' });
    expect(firstItem()).toMatchObject({ xCm: 550, yCm: 450, widthCm: 200, depthCm: 300 });
    fireEvent.keyDown(stage(), { code: 'KeyZ', key: 'ז', metaKey: true });
    expect(firstItem()).toMatchObject({ xCm: 500, yCm: 500, widthCm: 300, depthCm: 200 });
    fireEvent.keyDown(stage(), { code: 'KeyZ', key: 'ז', metaKey: true, shiftKey: true });
    expect(firstItem()).toMatchObject({ widthCm: 200, depthCm: 300 });
  });

  it('leaves the browser its own ⌘ shortcuts', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    const reload = createEvent.keyDown(stage(), { code: 'KeyR', metaKey: true });
    fireEvent(stage(), reload);
    expect(reload.defaultPrevented).toBe(false);
    expect(firstItem().widthCm).toBe(300);
  });

  it('leaves the browser its own Alt keys — Back, and the menus', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    const back = createEvent.keyDown(stage(), { code: 'ArrowLeft', altKey: true });
    fireEvent(stage(), back);
    expect(back.defaultPrevented).toBe(false);
    expect(firstItem().xCm).toBe(500);
    const menu = createEvent.keyDown(stage(), { code: 'KeyE', altKey: true });
    fireEvent(stage(), menu);
    expect(menu.defaultPrevented).toBe(false);
    expect(scene.handle.rotateView).not.toHaveBeenCalled();
  });

  it('leaves a key typed in a box to the box', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    const box = document.createElement('input');
    stage().appendChild(box);
    const typed = createEvent.keyDown(box, { code: 'KeyR', key: 'ר' });
    fireEvent(box, typed);
    expect(typed.defaultPrevented).toBe(false);
    expect(firstItem().widthCm).toBe(300);
    fireEvent.keyDown(box, { code: 'Backspace' });
    expect(lastScene().store.doc.items).toHaveLength(1);
  });

  it('nudges by one grid step, and by a metre with shift, relative to the screen', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'ArrowRight' });
    expect(firstItem().xCm).toBe(550);
    fireEvent.keyDown(stage(), { code: 'ArrowDown', shiftKey: true });
    expect(firstItem().yCm).toBe(600);
  });

  it('switches tool and view from the tool row and from the keys', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.click(button(/תוכנית/));
    expect(lastScene().ui.mode).toBe('plan');
    expect(button(/תוכנית/).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(stage(), { code: 'Digit3' });
    expect(lastScene().ui.mode).toBe('3d');
    fireEvent.keyDown(stage(), { code: 'KeyM' });
    expect(lastScene().ui.tool).toBe('measure');
    fireEvent.click(button(/הצמדה/));
    expect(lastScene().ui.snap).toBe(false);
  });

  it('zooms, fits and turns the view through the scene', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'Equal' });
    expect(scene.handle.zoomBy).toHaveBeenLastCalledWith(0.8);
    fireEvent.keyDown(stage(), { code: 'Minus' });
    expect(scene.handle.zoomBy).toHaveBeenLastCalledWith(1.25);
    fireEvent.keyDown(stage(), { code: 'KeyF' });
    expect(scene.handle.fitIds).toHaveBeenLastCalledWith(['a']);
    fireEvent.keyDown(stage(), { code: 'Escape' });
    expect(lastScene().store.selection).toEqual([]);
    fireEvent.keyDown(stage(), { code: 'KeyF' });
    expect(scene.handle.fitAll).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(stage(), { code: 'KeyQ' });
    expect(scene.handle.rotateView).toHaveBeenLastCalledWith(1);
  });

  it('keeps undo and redo in step with the history', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    const undo = button('ביטול הפעולה האחרונה');
    const redo = button('ביצוע מחדש');
    expect(undo.disabled).toBe(true);
    fireEvent.keyDown(stage(), { code: 'KeyR' });
    expect(undo.disabled).toBe(false);
    fireEvent.click(undo);
    expect(firstItem().widthCm).toBe(300);
    expect(redo.disabled).toBe(false);
    fireEvent.click(redo);
    expect(firstItem().widthCm).toBe(200);
  });
});
