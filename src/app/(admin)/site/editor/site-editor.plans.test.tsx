/**
 * @vitest-environment jsdom
 */
/*
 * Saved plans, end to end: the editor with the real store and the real save
 * queue, only the server actions and the scene stood in. A plan saved from
 * the card is the map as the store shows it; a plan loaded from the card
 * reaches the server as ordinary ops against the version, and its toast's
 * ביטול takes the map back.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { EditorDoc, EditorItem, EditorPlot } from '@/lib/site/editor/model';
import type { SiteOp } from '@/lib/site/editor/ops';
import type { Snapshot, SnapshotSummary } from '@/lib/site/snapshots';
import type { SceneViewProps } from './scene/scene-view';

function siteItem(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, facing: 0, locked: false, groupId: null,
    ...over,
  };
}

function siteDoc(items: EditorItem[], plot: Partial<EditorPlot> = {}): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0, ...plot }, items, lines: [], defaults: {} };
}

const actions = vi.hoisted(() => ({
  saveSiteChangesAction: vi.fn(), loadSiteDocAction: vi.fn(),
  takeSnapshotAction: vi.fn(), listSnapshotsAction: vi.fn(), readSnapshotAction: vi.fn(), deleteSnapshotAction: vi.fn(),
}));
vi.mock('../actions', () => actions);

/* `next/dynamic` as the app router builds it — see `site-editor.test.tsx`. */
vi.mock('next/dynamic', async () => ({
  default: (await import('next/dist/shared/lib/app-dynamic')).default,
}));

const sceneProps = vi.hoisted(() => vi.fn());
vi.mock('./scene/scene-view', () => ({
  SceneView: function FakeScene(props: SceneViewProps) {
    sceneProps(props);
    return <div data-testid="scene" />;
  },
}));

import { SiteEditor, type SiteEditorProps } from './site-editor';

const WAIT = { timeout: 3000 };
const PLAN_PLOT = { widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 };

const summary = (over: Partial<SnapshotSummary> & { id: string; name: string }): SnapshotSummary => ({
  plot: PLAN_PLOT, itemCount: 1, lineCount: 0, createdAt: '2026-09-26T12:40:00.000Z', createdBy: 'lead@shliff.camp', ...over,
});

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({ getExtension: () => null })) as unknown as HTMLCanvasElement['getContext'];
});

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = ((query: string) => ({
    matches: query === '(width >= 900px)', media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  actions.saveSiteChangesAction.mockResolvedValue({ ok: true, version: 1 });
  actions.loadSiteDocAction.mockResolvedValue({ ok: false, error: 'המפה לא נטענה' });
  actions.listSnapshotsAction.mockResolvedValue({ ok: true, value: [] });
});

async function renderEditor(items: EditorItem[] = [siteItem({ id: 'a' })], selection: string | null = null) {
  const props: SiteEditorProps = {
    initial: { doc: siteDoc(items), version: 0 },
    initialSelection: selection,
    seasonId: 's26',
    seasonName: 'ברן 26',
    sunDate: '2026-06-04',
    buildTasks: [{ id: 't1', title: 'הקמת המטבח' }],
    plotHref: '/site?season=s26&act=plot',
    seasonDateHref: '/site?season=s26&act=season-date',
  };
  render(<ToastProvider><SiteEditor {...props} /></ToastProvider>);
  await screen.findByTestId('scene');
}

function docNow(): EditorDoc {
  const call = sceneProps.mock.lastCall;
  if (call === undefined) throw new Error('the scene never rendered');
  return (call[0] as SceneViewProps).store.doc;
}

const stage = () => screen.getByRole('region', { name: 'מפת הקאמפ' });
const openCard = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'תוכניות שמורות' }));
  return screen.findByRole('group', { name: 'תוכניות שמורות' });
};
/** What the server was sent last: the batch's ops, coalesced by the queue. */
function lastSent(): { baseVersion: number; ops: SiteOp[] } {
  const call = actions.saveSiteChangesAction.mock.lastCall;
  if (call === undefined) throw new Error('nothing was sent');
  return { baseVersion: call[1] as number, ops: call[2] as SiteOp[] };
}

describe('saved plans, through the editor', () => {
  it('opens the card from the top bar, reads the list, and saves the map as the store shows it — an unsaved edit included', async () => {
    actions.takeSnapshotAction.mockResolvedValue({ ok: true, value: [summary({ id: 'n1', name: 'תוכנית 1' })] });
    await renderEditor([siteItem({ id: 'a' })], 'a');
    // A quarter turn of the selected tent: on screen at once, and still on its way to the server.
    fireEvent.keyDown(stage(), { code: 'KeyR' });
    expect(docNow().items[0]).toMatchObject({ widthCm: 200, depthCm: 300 });
    const card = await openCard();
    await waitFor(() => { expect(actions.listSnapshotsAction).toHaveBeenCalledWith('p1'); });
    expect(await within(card).findByText(/עוד לא נשמרה תוכנית/)).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: 'שמירת המפה' }));
    await waitFor(() => { expect(actions.takeSnapshotAction).toHaveBeenCalled(); });
    const [planId, name, content] = actions.takeSnapshotAction.mock.lastCall as [string, string, { plot: unknown; items: EditorItem[]; lines: unknown[] }];
    expect(planId).toBe('p1');
    expect(name).toBe('תוכנית 1');
    expect(content.plot).toEqual(PLAN_PLOT);
    expect(content.items.map((item) => [item.id, item.widthCm, item.depthCm])).toEqual([['a', 200, 300]]);
    expect(await screen.findByText('התוכנית ⁨תוכנית 1⁩ נשמרה', undefined, WAIT)).toBeTruthy();
    expect(within(card).getAllByRole('listitem').length).toBe(1);
    // The next save is proposed the next number.
    expect((within(card).getByRole('textbox', { name: 'שם התוכנית' }) as HTMLInputElement).value).toBe('תוכנית 2');
  });

  it('loads a plan as one edit: the map changes, the ops reach the server against the version, and ביטול takes it back', async () => {
    const plan: Snapshot = {
      ...summary({ id: 'n1', name: 'המטבח בצפון', itemCount: 2 }),
      items: [siteItem({ id: 'a', xCm: 1500 }), siteItem({ id: 'b', label: 'אוהל 2', xCm: 2000, taskId: 'gone-task' })],
      lines: [],
    };
    actions.listSnapshotsAction.mockResolvedValue({ ok: true, value: [summary({ id: 'n1', name: 'המטבח בצפון', itemCount: 2 })] });
    actions.readSnapshotAction.mockResolvedValue({ ok: true, value: plan });
    await renderEditor([siteItem({ id: 'a' }), siteItem({ id: 'c', label: 'אוהל 3', xCm: 900 })]);
    const card = await openCard();
    fireEvent.click(await within(card).findByRole('button', { name: 'טעינה למפה' }));
    await waitFor(() => { expect(actions.readSnapshotAction).toHaveBeenCalledWith('p1', 'n1'); });

    // On screen at once: a moved back, c gone, b back — without its link to a task this season does not have.
    await waitFor(() => {
      expect(docNow().items.map((item) => [item.id, item.xCm, item.taskId])).toEqual([['a', 1500, null], ['b', 2000, null]]);
    });
    const toast = await screen.findByText(/התוכנית ⁨המטבח בצפון⁩ נטענה למפה/, undefined, WAIT);
    expect(toast.textContent).toContain('הקישור למשימת הקמה שכבר לא קיימת הוסר מפריט אחד');

    // Saved like any edit, against the version the page loaded.
    await waitFor(() => { expect(actions.saveSiteChangesAction).toHaveBeenCalled(); }, WAIT);
    const sent = lastSent();
    expect(sent.baseVersion).toBe(0);
    expect(sent.ops.map((op) => op.type).sort()).toEqual(['add', 'remove', 'update']);
    expect(await screen.findByText('כל השינויים נשמרו', undefined, WAIT)).toBeTruthy();

    // ביטול on the toast: one step back to the map as it was.
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    await waitFor(() => {
      expect(docNow().items.map((item) => [item.id, item.xCm])).toEqual([['a', 500], ['c', 900]]);
    });
  });

  it('says so when the map already is the plan, and sends nothing', async () => {
    const plan: Snapshot = { ...summary({ id: 'n1', name: 'כמו עכשיו' }), items: [siteItem({ id: 'a' })], lines: [] };
    actions.listSnapshotsAction.mockResolvedValue({ ok: true, value: [summary({ id: 'n1', name: 'כמו עכשיו' })] });
    actions.readSnapshotAction.mockResolvedValue({ ok: true, value: plan });
    await renderEditor();
    const card = await openCard();
    fireEvent.click(await within(card).findByRole('button', { name: 'טעינה למפה' }));
    expect(await screen.findByText('המפה כבר זהה לתוכנית ⁨כמו עכשיו⁩.', undefined, WAIT)).toBeTruthy();
    expect(actions.saveSiteChangesAction).not.toHaveBeenCalled();
  });

  it('forgets a plan after the dialog, and shows the list the server answers with', async () => {
    actions.listSnapshotsAction.mockResolvedValue({ ok: true, value: [summary({ id: 'n1', name: 'ישנה' }), summary({ id: 'n2', name: 'חדשה' })] });
    actions.deleteSnapshotAction.mockResolvedValue({ ok: true, value: [summary({ id: 'n2', name: 'חדשה' })] });
    await renderEditor();
    const card = await openCard();
    expect((await within(card).findAllByRole('listitem')).length).toBe(2);
    fireEvent.click(within(card).getByRole('button', { name: 'מחיקת התוכנית ישנה' }));
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת התוכנית' }));
    await waitFor(() => { expect(actions.deleteSnapshotAction).toHaveBeenCalledWith('p1', 'n1'); });
    await waitFor(() => { expect(within(card).getAllByRole('listitem').length).toBe(1); });
    expect(within(card).getByRole('listitem').textContent).toContain('חדשה');
    expect(actions.saveSiteChangesAction).not.toHaveBeenCalled();
  });

  it('says why a save was refused, in the card, and why a list could not be read', async () => {
    actions.listSnapshotsAction.mockRejectedValueOnce(new Error('offline'));
    actions.takeSnapshotAction.mockResolvedValue({ ok: false, error: 'למפה יש כבר 30 תוכניות שמורות. כדי לשמור עוד אחת, מוחקים תוכנית שכבר לא צריך' });
    await renderEditor();
    const card = await openCard();
    expect((await within(card).findByRole('alert')).textContent).toBe('לא הצלחנו להגיע לשרת. אפשר לנסות שוב.');
    fireEvent.click(within(card).getByRole('button', { name: 'ניסיון חוזר' }));
    await waitFor(() => { expect(actions.listSnapshotsAction).toHaveBeenCalledTimes(2); });
    expect(await within(card).findByText(/עוד לא נשמרה תוכנית/)).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: 'שמירת המפה' }));
    expect((await within(card).findByRole('alert')).textContent).toContain('למפה יש כבר 30 תוכניות שמורות');
  });
});
