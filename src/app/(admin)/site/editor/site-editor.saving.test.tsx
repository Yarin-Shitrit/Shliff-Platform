/**
 * @vitest-environment jsdom
 */
/*
 * Saving, end to end: the editor with the real store (`use-editor-store.ts`)
 * and the real save queue (`save-queue.ts`), only the server actions and the
 * scene stood in. `site-editor.test.tsx` checks what the screen says for each
 * state the queue can report; this checks that a key press really reaches the
 * server, and that the lead's answer to a conflict or a refusal really does
 * what it says — the path the original bug was on (overview, Review Focus #1).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { EditorDoc, EditorItem, EditorPlot } from '@/lib/site/editor/model';
import { NETWORK_FAILURE } from './save-queue';
import type { SceneViewProps } from './scene/scene-view';

/* This file's own fixture: a 26 × 24 m plot on a 50 cm grid, and a 3 × 2 m
   tent at (5 m, 5 m). */
function siteItem(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, facing: 0, locked: false,
    ...over,
  };
}

function siteDoc(items: EditorItem[], plot: Partial<EditorPlot> = {}): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0, ...plot }, items, lines: [], defaults: {} };
}

const { saveSiteChangesAction, loadSiteDocAction } = vi.hoisted(() => ({
  saveSiteChangesAction: vi.fn(), loadSiteDocAction: vi.fn(),
}));
vi.mock('../actions', () => ({ saveSiteChangesAction, loadSiteDocAction }));

/* `next/dynamic` as the app router builds it — see `site-editor.test.tsx`. */
vi.mock('next/dynamic', async () => ({
  default: (await import('next/dist/shared/lib/app-dynamic')).default,
}));

const sceneProps = vi.hoisted(() => vi.fn());
vi.mock('./scene/scene-view', () => ({
  /* No handle: this file never drives the view. */
  SceneView: function FakeScene(props: SceneViewProps) {
    sceneProps(props);
    return <div data-testid="scene" />;
  },
}));

import { SiteEditor, type SiteEditorProps } from './site-editor';
import { notePlotSaved } from './own-plot-saves';

const CONFLICT = 'המפה שונתה ממקום אחר מאז שנפתחה. השינויים האחרונים שלך עוד לא נשמרו.';
const PLOT_SAVED = 'הגדרות המגרש נשמרו, ויש כאן שינויים שעוד לא נשמרו. אפשר לשמור אותם מעל המפה המעודכנת, או לטעון אותה בלעדיהם.';
const SITE_UPDATED = 'האתר עודכן בזמן העבודה. צריך לרענן את הדף; השינויים שלא נשמרו יחכו אחרי הרענון.';
const WAIT = { timeout: 3000 };

beforeAll(() => {
  // jsdom draws nothing; a context object is enough for the editor's one-time WebGL question.
  HTMLCanvasElement.prototype.getContext = (() => ({ getExtension: () => null })) as unknown as HTMLCanvasElement['getContext'];
});

beforeEach(() => {
  vi.clearAllMocks();
  // A wide screen (the map is the view) in the light theme.
  window.matchMedia = ((query: string) => ({
    matches: query === '(width >= 900px)', media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  saveSiteChangesAction.mockResolvedValue({ ok: true, version: 1 });
  loadSiteDocAction.mockResolvedValue({ ok: false, error: 'המפה לא נטענה' });
});

async function renderEditor() {
  const props: SiteEditorProps = {
    initial: { doc: siteDoc([siteItem({ id: 'a' })]), version: 0 },
    initialSelection: 'a',
    seasonId: 's26',
    seasonName: 'ברן 26',
    sunDate: '2026-06-04',
    buildTasks: [],
    plotHref: '/site?season=s26&act=plot',
    seasonDateHref: '/site?season=s26&act=season-date',
  };
  const rendered = render(<ToastProvider><SiteEditor {...props} /></ToastProvider>);
  await screen.findByTestId('scene');
  return {
    /** The page rendering the same editor again with some props changed — as `router.refresh()` does. */
    rerenderWith(next: Partial<SiteEditorProps>): void {
      rendered.rerender(<ToastProvider><SiteEditor {...props} {...next} /></ToastProvider>);
    },
  };
}

function firstItem(): EditorItem {
  const call = sceneProps.mock.lastCall;
  if (call === undefined) throw new Error('the scene never rendered');
  return (call[0] as SceneViewProps).store.doc.items[0];
}

const stage = () => screen.getByRole('region', { name: 'מפת הקאמפ' });
const turn = () => { fireEvent.keyDown(stage(), { code: 'KeyR' }); };
const saved = () => screen.findByText('כל השינויים נשמרו', undefined, WAIT);
/** What the server was sent last: the batch's ops, coalesced by the queue. */
function lastSent(): { baseVersion: number; ops: unknown[] } {
  const call = saveSiteChangesAction.mock.lastCall;
  if (call === undefined) throw new Error('nothing was sent');
  return { baseVersion: call[1] as number, ops: call[2] as unknown[] };
}

describe('saving, through the store and the queue', () => {
  it('says every change is saved, then that it is saving, then saved again', async () => {
    await renderEditor();
    expect(screen.getByText('כל השינויים נשמרו')).toBeTruthy();
    turn();
    expect(screen.getByText('שומר…')).toBeTruthy();
    await waitFor(() => {
      expect(saveSiteChangesAction).toHaveBeenCalledWith('p1', 0, expect.any(Array));
    }, WAIT);
    expect(await screen.findByText('כל השינויים נשמרו', undefined, WAIT)).toBeTruthy();
  });

  it('keeps a retry on screen, with the reason, when the connection drops, and sends again from it', async () => {
    saveSiteChangesAction.mockRejectedValueOnce(new Error('offline'));
    await renderEditor();
    turn();
    const retry = await screen.findByRole('button', { name: 'ניסיון חוזר' }, WAIT);
    expect(screen.getByText('לא נשמר —')).toBeTruthy();
    expect(screen.getByText(NETWORK_FAILURE)).toBeTruthy();
    // Ruling P8: the reason, but no reload for a dropped connection — it would throw the edit away.
    expect(screen.queryByRole('button', { name: 'טעינת הגרסה העדכנית' })).toBeNull();
    fireEvent.click(retry);
    expect(await screen.findByText('כל השינויים נשמרו', undefined, WAIT)).toBeTruthy();
    expect(screen.queryByText(NETWORK_FAILURE)).toBeNull();
    expect(saveSiteChangesAction).toHaveBeenCalledTimes(2);
  });

  it('says why a batch was refused, and reloads the map when asked', async () => {
    saveSiteChangesAction.mockResolvedValue({ ok: false, reason: 'refused', error: 'הפריט כבר לא במפה.' });
    loadSiteDocAction.mockResolvedValue({ ok: true, value: { doc: siteDoc([siteItem({ id: 'a', xCm: 900 })]), version: 2 } });
    await renderEditor();
    turn();
    expect(await screen.findByText('הפריט כבר לא במפה.', undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'טעינת הגרסה העדכנית' }));
    await waitFor(() => { expect(loadSiteDocAction).toHaveBeenCalledWith('p1'); });
    await waitFor(() => { expect(firstItem()).toMatchObject({ xCm: 900, widthCm: 300 }); });
    expect(screen.queryByText('הפריט כבר לא במפה.')).toBeNull();
    expect(screen.getByText('כל השינויים נשמרו')).toBeTruthy();
  });

  /*
   * Review C2, end to end: another lead locked the tent this lead just turned.
   * Every retry resent the same refused batch, and the only other button
   * threw away everything unsent. Keeping mine reloads, names the locked
   * item, drops only that change, and the queue is free again.
   */
  it('gets out of a refused batch by keeping my changes over the latest map, naming what was locked', async () => {
    saveSiteChangesAction.mockResolvedValueOnce({ ok: false, reason: 'refused', error: 'הפריט נעול.' });
    loadSiteDocAction.mockResolvedValue({
      ok: true,
      value: { doc: siteDoc([siteItem({ id: 'a', locked: true }), siteItem({ id: 'b', label: 'אוהל 2', xCm: 1500 })]), version: 2 },
    });
    await renderEditor();
    turn();
    expect(await screen.findByText('הפריט נעול.', undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'שמירת השינויים שלי מעליה' }));
    await waitFor(() => { expect(loadSiteDocAction).toHaveBeenCalledWith('p1'); });
    expect(await screen.findByText(/לא נשמרו שינויים בפריטים נעולים/)).toBeTruthy();
    expect(firstItem()).toMatchObject({ widthCm: 300, depthCm: 200, locked: true });
    expect(await saved()).toBeTruthy();
    expect(screen.queryByText('הפריט נעול.')).toBeNull();
    // Nothing was left to send: the refused turn is not tried again.
    expect(saveSiteChangesAction).toHaveBeenCalledTimes(1);
  });

  /*
   * Review I2: after a deploy, an editor left open calls a server action the
   * new build no longer has. Next throws `UnrecognizedActionError` ("Server
   * Action … was not found on the server", node_modules/next/dist/client/
   * components/unrecognized-action-error.js); it was read as a dropped
   * connection, and every retry failed the same way.
   */
  it('says the site was updated when a save reaches an older build, keeps the work for after the refresh, and offers it', async () => {
    const stale = Object.assign(
      new Error('Server Action "7f00aa" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action'),
      { name: 'UnrecognizedActionError' },
    );
    saveSiteChangesAction.mockRejectedValue(stale);
    const reload = vi.fn();
    const location = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...location, reload } });
    try {
      await renderEditor();
      turn();
      expect(await screen.findByText(SITE_UPDATED, undefined, WAIT)).toBeTruthy();
      expect(screen.queryByText(NETWORK_FAILURE)).toBeNull();
      // Neither reload nor keep-mine: both would call the same missing actions.
      expect(screen.queryByRole('button', { name: 'טעינת הגרסה העדכנית' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'שמירת השינויים שלי מעליה' })).toBeNull();
      // Nor the retry: it would resend to the same missing action (#25 fix round, Minor 11).
      expect(screen.queryByRole('button', { name: 'ניסיון חוזר' })).toBeNull();
      const kept = () => JSON.parse(window.sessionStorage.getItem('site-editor:pending:p1') ?? 'null') as unknown;
      const turned = [{ type: 'update', id: 'a', patch: { xCm: 550, yCm: 450, widthCm: 200, depthCm: 300, facing: 1 } }];
      // The unsaved turn waits in this tab for the page after the refresh — kept by an effect
      // once the banner is up, which under load can land a moment after it.
      await waitFor(() => { expect(kept()).toEqual(turned); });
      // The refresh keeps it too, so a press quicker than that effect loses nothing.
      window.sessionStorage.clear();
      fireEvent.click(screen.getByRole('button', { name: 'רענון הדף' }));
      expect(reload).toHaveBeenCalledTimes(1);
      expect(kept()).toEqual(turned);
      // A deliberate refresh with the work kept: the browser's own "leave this page?" would only confuse (Minor 6).
      const leaving = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(leaving);
      expect(leaving.defaultPrevented).toBe(false);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: location });
      window.sessionStorage.clear();
    }
  });

  it('still warns before an ordinary leave while a change is unsent', async () => {
    saveSiteChangesAction.mockRejectedValue(new Error('offline'));
    await renderEditor();
    turn();
    expect(await screen.findByRole('button', { name: 'ניסיון חוזר' }, WAIT)).toBeTruthy();
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
  });

  /*
   * #25 fix round, Important 3: the same stale build meets the reload that a
   * conflict's or a refusal's answer starts. It fell back to "לא הצלחנו
   * לטעון את המפה" with the banner still up — failing the same way forever.
   */
  it('says the site was updated when a conflict’s answer reaches an older build, and keeps the work for the refresh', async () => {
    const stale = Object.assign(new Error('Server Action "9c" was not found on the server.'), { name: 'UnrecognizedActionError' });
    saveSiteChangesAction.mockResolvedValue({ ok: false, reason: 'conflict', version: 4 });
    loadSiteDocAction.mockRejectedValue(stale);
    try {
      await renderEditor();
      turn();
      fireEvent.click(await screen.findByRole('button', { name: 'שמירת השינויים שלי מעליה' }, WAIT));
      expect(await screen.findByText(SITE_UPDATED, undefined, WAIT)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'רענון הדף' })).toBeTruthy();
      expect(screen.queryByText(/לא הצלחנו לטעון את המפה/)).toBeNull();
      // The conflict's own two answers would call the same missing action again.
      expect(screen.queryByRole('button', { name: 'טעינת הגרסה העדכנית' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'שמירת השינויים שלי מעליה' })).toBeNull();
      await waitFor(() => {
        expect(JSON.parse(window.sessionStorage.getItem('site-editor:pending:p1') ?? 'null')).toEqual([
          { type: 'update', id: 'a', patch: { xCm: 550, yCm: 450, widthCm: 200, depthCm: 300, facing: 1 } },
        ]);
      });
    } finally {
      window.sessionStorage.clear();
    }
  });

  it('replays the work an older build left unsaved, through keeping mine over the latest map', async () => {
    window.sessionStorage.setItem('site-editor:pending:p1', JSON.stringify([
      { type: 'update', id: 'a', patch: { xCm: 550, yCm: 450, widthCm: 200, depthCm: 300 } },
    ]));
    loadSiteDocAction.mockResolvedValue({ ok: true, value: { doc: siteDoc([siteItem({ id: 'a' })]), version: 3 } });
    saveSiteChangesAction.mockResolvedValue({ ok: true, version: 4 });
    try {
      await renderEditor();
      await waitFor(() => { expect(loadSiteDocAction).toHaveBeenCalledWith('p1'); });
      await waitFor(() => { expect(firstItem()).toMatchObject({ widthCm: 200, depthCm: 300 }); });
      await waitFor(() => {
        expect(saveSiteChangesAction).toHaveBeenCalledWith('p1', 3, [
          { type: 'update', id: 'a', patch: { xCm: 550, yCm: 450, widthCm: 200, depthCm: 300 } },
        ]);
      }, WAIT);
      expect(await saved()).toBeTruthy();
      // Not silently: the lead is told the earlier edits came back and are saved (#25 fix round, Minor 7).
      expect(await screen.findByText('השינויים שלא נשמרו לפני רענון הדף שוחזרו ונשמרו.')).toBeTruthy();
      // Taken once: a later refresh does not replay it again.
      expect(window.sessionStorage.getItem('site-editor:pending:p1')).toBeNull();
    } finally {
      window.sessionStorage.clear();
    }
  });

  /*
   * Review minor (H1 5), the P6 blind spot: 'mine' has just landed a map in
   * which the other lead locked the tent, but the editor has not re-rendered
   * yet — a Delete pressed in that gap builds its remove from the map it last
   * drew. The store skips it (the lock holds) and records nothing, so there
   * is nothing to say "removed" about, and no ביטול to offer.
   */
  it('says nothing was removed when the store recorded nothing — a remove the map under it had just made impossible', async () => {
    saveSiteChangesAction.mockResolvedValueOnce({ ok: false, reason: 'conflict', version: 5 });
    let settle: (value: unknown) => void = () => {};
    loadSiteDocAction.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    await renderEditor();
    fireEvent.keyDown(stage(), { code: 'ArrowRight' });
    expect(await screen.findByText(CONFLICT, undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'שמירת השינויים שלי מעליה' }));
    await act(async () => {
      settle({ ok: true, value: { doc: siteDoc([siteItem({ id: 'a', locked: true })]), version: 5 } });
      // Let 'mine' land in the store — and the Delete come before any re-render.
      await Promise.resolve();
      await Promise.resolve();
      fireEvent.keyDown(stage(), { code: 'Delete' });
    });
    expect(firstItem()).toMatchObject({ id: 'a', locked: true });
    expect(screen.queryByText(/הוסר מהמפה/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'ביטול' })).toBeNull();
  });

  it('turns a stale version into a choice, and the other lead’s map replaces mine when chosen', async () => {
    saveSiteChangesAction.mockResolvedValue({ ok: false, reason: 'conflict', version: 4 });
    loadSiteDocAction.mockResolvedValue({
      ok: true, value: { doc: siteDoc([siteItem({ id: 'a', xCm: 900 })]), version: 4 },
    });
    await renderEditor();
    turn();
    expect(await screen.findByText(CONFLICT, undefined, WAIT)).toBeTruthy();
    // A conflict stops the queue: nothing is resent until the lead chooses.
    expect(saveSiteChangesAction).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'טעינת הגרסה העדכנית' }));
    await waitFor(() => { expect(loadSiteDocAction).toHaveBeenCalledWith('p1'); });
    await waitFor(() => { expect(firstItem()).toMatchObject({ xCm: 900, widthCm: 300 }); });
    expect(screen.queryByText(/המפה שונתה ממקום אחר/)).toBeNull();
  });

  it('resends my changes over the new version when I keep them', async () => {
    saveSiteChangesAction
      .mockResolvedValueOnce({ ok: false, reason: 'conflict', version: 4 })
      .mockResolvedValue({ ok: true, version: 5 });
    loadSiteDocAction.mockResolvedValue({ ok: true, value: { doc: siteDoc([siteItem({ id: 'a' })]), version: 4 } });
    await renderEditor();
    turn();
    fireEvent.click(await screen.findByRole('button', { name: 'שמירת השינויים שלי מעליה' }, WAIT));
    await waitFor(() => {
      expect(saveSiteChangesAction).toHaveBeenLastCalledWith('p1', 4, expect.any(Array));
    }, WAIT);
    expect(await screen.findByText('כל השינויים נשמרו', undefined, WAIT)).toBeTruthy();
  });
});

/*
 * A plot saved in the drawer (Task 25): `setPlot` bumps the plan's version and
 * the drawer refreshes the page, so the editor is handed a newer `initial`.
 * The store keeps its first `init` (§6.1), so the editor takes the newer map
 * itself — never by being remounted on the version.
 */
describe('a plot saved in the drawer', () => {
  const widened = () => ({ doc: siteDoc([siteItem({ id: 'a' })], { widthCm: 3000 }), version: 1 });
  const plotWidth = () => {
    const call = sceneProps.mock.lastCall;
    if (call === undefined) throw new Error('the scene never rendered');
    return (call[0] as SceneViewProps).store.doc.plot.widthCm;
  };

  it('is taken up at once when nothing is waiting to be saved', async () => {
    loadSiteDocAction.mockResolvedValue({ ok: true, value: widened() });
    const { rerenderWith } = await renderEditor();
    rerenderWith({ initial: widened() });
    await waitFor(() => { expect(plotWidth()).toBe(3000); });
    expect(loadSiteDocAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/המפה שונתה ממקום אחר/)).toBeNull();
  });

  it('raises the choice, rather than dropping edits, when something is waiting to be saved', async () => {
    loadSiteDocAction.mockResolvedValue({ ok: true, value: widened() });
    notePlotSaved('p1', 1); // the drawer in this tab saved version 1
    const { rerenderWith } = await renderEditor();
    turn(); // waiting: the queue sends after 500 ms
    rerenderWith({ initial: widened() });
    expect(screen.getByText(PLOT_SAVED)).toBeTruthy();
    expect(loadSiteDocAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'שמירת השינויים שלי מעליה' }));
    await waitFor(() => { expect(plotWidth()).toBe(3000); });
    expect(firstItem()).toMatchObject({ widthCm: 200, depthCm: 300 });
    await waitFor(() => {
      expect(saveSiteChangesAction).toHaveBeenLastCalledWith('p1', 1, expect.any(Array));
    }, WAIT);
  });

  /*
   * Hotfix H1 — the review's probe, kept. The take-up used 'theirs', which
   * empties the queue: a turn and a copy made while the newer map was still
   * loading were thrown away, nothing was sent, the top bar said everything
   * was saved, and the copy's toast stayed on screen offering ביטול for a
   * copy that no longer existed.
   */
  it('keeps the edits made while the newer map loads, and saves them over it', async () => {
    let settle: (value: unknown) => void = () => {};
    loadSiteDocAction.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    saveSiteChangesAction.mockResolvedValue({ ok: true, version: 2 });
    const { rerenderWith } = await renderEditor();
    rerenderWith({ initial: widened() });
    await waitFor(() => { expect(loadSiteDocAction).toHaveBeenCalledTimes(1); });

    turn();
    fireEvent.keyDown(stage(), { code: 'KeyD', metaKey: true });
    expect(await screen.findByText(/נוצר עותק של/)).toBeTruthy();
    // Nothing asks the lead to choose while the editor is taking the map up itself.
    expect(screen.queryByText(CONFLICT)).toBeNull();

    await act(async () => { settle({ ok: true, value: widened() }); });
    await waitFor(() => { expect(plotWidth()).toBe(3000); });
    const items = (sceneProps.mock.lastCall?.[0] as SceneViewProps).store.doc.items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'a', widthCm: 200, depthCm: 300 });
    // Both edits go to the server, over the version the map was taken up at.
    await waitFor(() => {
      expect(saveSiteChangesAction).toHaveBeenCalledWith('p1', 1, expect.any(Array));
    }, WAIT);
    expect(lastSent().ops).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'update', id: 'a' }),
      expect.objectContaining({ type: 'add' }),
    ]));
    expect(await saved()).toBeTruthy();
    // The map was replaced under the copy's history entry, so its ביטול goes too.
    expect(screen.queryByText(/נוצר עותק של/)).toBeNull();
  });
});

/*
 * The shortcuts that change the map, with the real store behind them:
 * `site-editor.test.tsx` checks the same keys against a stand-in, so this is
 * where a key press is followed all the way to what the server is sent.
 */
describe('the keyboard, through the store and the queue', () => {
  it('turns with R, undoes with ⌘Z and redoes with ⇧⌘Z, and the server gets where it ended', async () => {
    await renderEditor();
    const undo = screen.getByRole('button', { name: 'ביטול הפעולה האחרונה' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'ביצוע מחדש' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);

    turn();
    expect(firstItem()).toMatchObject({ xCm: 550, yCm: 450, widthCm: 200, depthCm: 300 });
    expect(undo.disabled).toBe(false);
    fireEvent.keyDown(stage(), { code: 'KeyZ', key: 'ז', metaKey: true });
    expect(firstItem()).toMatchObject({ xCm: 500, yCm: 500, widthCm: 300, depthCm: 200 });
    expect(redo.disabled).toBe(false);
    fireEvent.keyDown(stage(), { code: 'KeyZ', key: 'ז', metaKey: true, shiftKey: true });
    expect(firstItem()).toMatchObject({ xCm: 550, yCm: 450, widthCm: 200, depthCm: 300 });

    expect(await saved()).toBeTruthy();
    // Three presses inside the quiet time are one batch, and it carries where the item ended.
    expect(saveSiteChangesAction).toHaveBeenCalledTimes(1);
    expect(lastSent()).toEqual({
      baseVersion: 0,
      ops: [{ type: 'update', id: 'a', patch: { xCm: 550, yCm: 450, widthCm: 200, depthCm: 300, facing: 1 } }],
    });
  });

  it('sends an undo to the server too, once the turn it undoes was saved', async () => {
    await renderEditor();
    turn();
    expect(await saved()).toBeTruthy();
    expect(lastSent().ops).toEqual([
      { type: 'update', id: 'a', patch: { xCm: 550, yCm: 450, widthCm: 200, depthCm: 300, facing: 1 } },
    ]);

    fireEvent.keyDown(stage(), { code: 'KeyZ', key: 'ז', ctrlKey: true });
    expect(firstItem()).toMatchObject({ xCm: 500, yCm: 500, widthCm: 300, depthCm: 200 });
    await waitFor(() => { expect(saveSiteChangesAction).toHaveBeenCalledTimes(2); }, WAIT);
    expect(lastSent()).toEqual({
      baseVersion: 1,
      ops: [{ type: 'update', id: 'a', patch: { xCm: 500, yCm: 500, widthCm: 300, depthCm: 200, facing: 0 } }],
    });
  });

  it('nudges by one grid step, and by a metre with shift, and saves the move', async () => {
    await renderEditor();
    fireEvent.keyDown(stage(), { code: 'ArrowRight' });
    expect(firstItem()).toMatchObject({ xCm: 550, yCm: 500 });
    fireEvent.keyDown(stage(), { code: 'ArrowDown', shiftKey: true });
    expect(firstItem()).toMatchObject({ xCm: 550, yCm: 600 });

    expect(await saved()).toBeTruthy();
    expect(lastSent()).toEqual({
      baseVersion: 0,
      ops: [{ type: 'update', id: 'a', patch: { xCm: 550, yCm: 600 } }],
    });
  });
});
