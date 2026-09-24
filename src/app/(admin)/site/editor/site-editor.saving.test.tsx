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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { EditorDoc, EditorItem, EditorPlot } from '@/lib/site/editor/model';
import { NETWORK_FAILURE } from './save-queue';
import type { SceneViewProps } from './scene/scene-view';

/* This file's own fixture: a 26 × 24 m plot on a 50 cm grid, and a 3 × 2 m
   tent at (5 m, 5 m). */
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

import { SiteEditor } from './site-editor';

const CONFLICT = 'המפה שונתה ממקום אחר מאז שנפתחה. השינויים האחרונים שלך עוד לא נשמרו.';
const WAIT = { timeout: 3000 };

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  saveSiteChangesAction.mockResolvedValue({ ok: true, version: 1 });
  loadSiteDocAction.mockResolvedValue({ ok: false, error: 'המפה לא נטענה' });
});

async function renderEditor() {
  render(
    <ToastProvider>
      <SiteEditor
        initial={{ doc: siteDoc([siteItem({ id: 'a' })]), version: 0 }}
        initialSelection="a"
        seasonName="ברן 26"
        sunDate="2026-06-04"
        buildTasks={[]}
        plotHref="/site?season=s26&act=plot"
      />
    </ToastProvider>,
  );
  await screen.findByTestId('scene');
}

function firstItem(): EditorItem {
  const call = sceneProps.mock.lastCall;
  if (call === undefined) throw new Error('the scene never rendered');
  return (call[0] as SceneViewProps).store.doc.items[0];
}

const turn = () => { fireEvent.keyDown(screen.getByRole('region', { name: 'מפת הקאמפ' }), { code: 'KeyR' }); };

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
