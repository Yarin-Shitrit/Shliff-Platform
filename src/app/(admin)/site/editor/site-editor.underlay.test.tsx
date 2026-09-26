/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { EditorDoc, EditorPlot, EditorUnderlay } from '@/lib/site/editor/model';
import type { SceneHandle, SceneViewProps } from './scene/scene-view';
import type { UnderlayEvent } from './scene/underlay-mesh';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const KEY = `site-underlays/${PLAN}/${'a'.repeat(64)}.png`;
const IMAGE: EditorUnderlay = {
  storageKey: KEY, contentType: 'image/png', sizeBytes: 64, filename: 'שרטוט.png',
  centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0, calibration: null,
};
const LRI = '⁦';
const PDI = '⁩';

function siteDoc(underlay: EditorUnderlay | null, plot: Partial<EditorPlot> = {}): EditorDoc {
  return { plot: { id: PLAN, widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0, ...plot }, items: [], lines: [], defaults: {}, underlay };
}

const { saveSiteChangesAction, loadSiteDocAction } = vi.hoisted(() => ({
  saveSiteChangesAction: vi.fn(), loadSiteDocAction: vi.fn(),
}));
vi.mock('../actions', () => ({
  saveSiteChangesAction, loadSiteDocAction,
  // The saved plans' four (`use-saved-plans.ts`): never called here, present so the mock is the module's whole face.
  takeSnapshotAction: vi.fn(), listSnapshotsAction: vi.fn(), readSnapshotAction: vi.fn(), deleteSnapshotAction: vi.fn(),
}));

/* `next/dynamic` as the app router builds it — see `site-editor.test.tsx`. */
vi.mock('next/dynamic', async () => ({
  default: (await import('next/dist/shared/lib/app-dynamic')).default,
}));

const scene = vi.hoisted(() => ({
  props: vi.fn(),
  handle: {
    fitAll: vi.fn(), fitIds: vi.fn(), zoomBy: vi.fn(), rotateView: vi.fn(), northUp: vi.fn(),
    centreGround: vi.fn(() => null), groundAtClient: vi.fn(() => null), setGhost: vi.fn(), jumpTo: vi.fn(),
    exportPng: vi.fn(() => null), retryUnderlay: vi.fn(),
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

import { SiteEditor, type SiteEditorProps } from './site-editor';

const WAIT = { timeout: 3000 };

/** The PNG header of a 1600 × 1200 picture, padded: all the checks read. */
function png(): Uint8Array<ArrayBuffer> {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0x06, 0x40, 0, 0, 0x04, 0xb0, 8, 6, 0, 0, 0];
  const out = new Uint8Array(64);
  out.set(header);
  return out;
}

const route = vi.fn();

beforeAll(() => {
  // jsdom draws nothing; a context object is enough for the editor's one-time WebGL question.
  HTMLCanvasElement.prototype.getContext = (() => ({ getExtension: () => null })) as unknown as HTMLCanvasElement['getContext'];
});

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = ((query: string) => ({
    // A wide screen (the map is the view) in the light theme, as `site-editor.saving.test.tsx` has it.
    matches: query === '(width >= 900px)', media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  saveSiteChangesAction.mockResolvedValue({ ok: true, version: 1 });
  loadSiteDocAction.mockResolvedValue({ ok: false, error: 'המפה לא נטענה' });
  route.mockImplementation(async () => new Response(
    JSON.stringify({ storageKey: KEY, contentType: 'image/png', sizeBytes: 64, filename: 'שרטוט.png' }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', route);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 64, height: 48, close: () => {} })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderEditor(underlay: EditorUnderlay | null) {
  const props: SiteEditorProps = {
    initial: { doc: siteDoc(underlay), version: 0 },
    initialSelection: null,
    seasonId: 's26',
    seasonName: 'ברן 26',
    sunDate: '2026-06-04',
    buildTasks: [],
    plotHref: '/site?season=s26&act=plot',
    seasonDateHref: '/site?season=s26&act=season-date',
  };
  const view = render(<ToastProvider><SiteEditor {...props} /></ToastProvider>);
  await screen.findByTestId('scene');
  return view;
}

function lastScene(): SceneViewProps {
  const call = scene.props.mock.lastCall;
  if (call === undefined) throw new Error('the scene never rendered');
  return call[0] as SceneViewProps;
}
const picture = () => lastScene().store.doc.underlay ?? null;
const inspector = () => within(screen.getByRole('region', { name: 'מאפיינים' }));
const card = () => within(screen.getByRole('group', { name: 'תמונת רקע' }));
const stage = () => screen.getByRole('region', { name: 'מפת הקאמפ' });
/** The scene's part: what it would report. */
const sceneSays = (event: UnderlayEvent) => { act(() => { lastScene().onUnderlay?.(event); }); };
const shown = () => sceneSays({ type: 'status', status: { state: 'ready', aspect: 0.75 } });

async function calibrating() {
  fireEvent.click(inspector().getByRole('button', { name: 'לא כוילה' }));
  shown();
  fireEvent.click(card().getByRole('button', { name: 'כיול' }));
}

describe('the picture under the map, in the editor', () => {
  it('opens its card from the plot, uploads, lays the picture on the plot and goes straight on to calibration, in plan', async () => {
    await renderEditor(null);
    fireEvent.click(inspector().getByRole('button', { name: 'העלאת תמונה' }));
    const input = screen.getByRole('group', { name: 'תמונת רקע' }).querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([png()], 'שרטוט.png', { type: 'image/png' })] } });

    await waitFor(() => { expect(picture()).toEqual(IMAGE); });
    expect(route.mock.calls[0][0]).toBe(`/site/underlay/${PLAN}`);
    expect(lastScene().ui).toMatchObject({ tool: 'calibrate', mode: 'plan', underlay: { shown: true, opacity: 0.5 } });
    expect(card().getByRole('status').textContent).toBe('סימון הנקודה הראשונה על התמונה');

    await waitFor(() => { expect(saveSiteChangesAction).toHaveBeenCalled(); }, WAIT);
    expect(saveSiteChangesAction.mock.lastCall).toEqual([PLAN, 0, [{ type: 'setUnderlay', underlay: IMAGE }]]);
  });

  it('calibrates from two marked points and a typed distance, as one undo step, and goes back to the view it came from', async () => {
    await renderEditor(IMAGE);
    expect(lastScene().ui.mode).toBe('3d');
    await calibrating();
    expect(lastScene().ui).toMatchObject({ tool: 'calibrate', mode: 'plan' });

    sceneSays({ type: 'point', uv: [0.1, 0.5] });
    expect(card().getByRole('status').textContent).toBe('סימון הנקודה השנייה');
    expect(lastScene().underlayMarks).toEqual([[0.1, 0.5]]);
    sceneSays({ type: 'point', uv: [0.9, 0.5] });
    fireEvent.change(card().getByLabelText('המרחק בין שתי הנקודות, במטרים'), { target: { value: '26' } });
    fireEvent.click(card().getByRole('button', { name: 'כיול' }));

    expect(picture()).toEqual({
      ...IMAGE, centreXCm: 1560, widthCm: 3250, calibration: { from: [0.1, 0.5], to: [0.9, 0.5], distanceCm: 2600 },
    });
    expect(lastScene().ui).toMatchObject({ tool: 'select', mode: '3d' });
    expect(card().getByText(`כויל לפי ${LRI}26 מ׳${PDI} שסומנו על התמונה`)).toBeTruthy();
    // The saved pair is drawn while the card is open.
    expect(lastScene().underlayMarks).toEqual([[0.1, 0.5], [0.9, 0.5]]);

    fireEvent.keyDown(stage(), { code: 'KeyZ', metaKey: true });
    expect(picture()).toEqual(IMAGE);
  });

  it('says in Hebrew that a click came before the picture was shown — still loading, or not shown at all (review U1)', async () => {
    await renderEditor(null);
    await uploaded();
    sceneSays({ type: 'status', status: { state: 'loading' } });
    sceneSays({ type: 'notReady' });
    expect(card().getByRole('alert').textContent).toBe('התמונה עוד נטענת. אפשר לסמן נקודות כשהיא מופיעה.');
    sceneSays({ type: 'status', status: { state: 'failed' } });
    sceneSays({ type: 'notReady' });
    expect(card().getByRole('alert').textContent).toBe('לא הצלחנו להציג את התמונה, ולכן אי אפשר לסמן עליה נקודות.');
    shown();
    sceneSays({ type: 'point', uv: [0.1, 0.5] });
    expect(card().queryByRole('alert')).toBeNull();
    expect(card().getByRole('status').textContent).toBe('סימון הנקודה השנייה');
  });

  it('ends the calibration on Esc typed in the distance box, back to the view it came from (review U1)', async () => {
    await renderEditor(IMAGE);
    await calibrating();
    sceneSays({ type: 'point', uv: [0.1, 0.5] });
    sceneSays({ type: 'point', uv: [0.9, 0.5] });
    const distance = card().getByLabelText('המרחק בין שתי הנקודות, במטרים');
    fireEvent.change(distance, { target: { value: '2' } });
    fireEvent.keyDown(distance, { key: 'Escape', code: 'Escape' });
    expect(lastScene().ui).toMatchObject({ tool: 'select', mode: '3d' });
    expect(picture()).toEqual(IMAGE);
  });

  it('refuses in Hebrew a point beside the picture, a point too near the first, and a distance that is not one', async () => {
    await renderEditor(IMAGE);
    await calibrating();
    sceneSays({ type: 'offImage' });
    expect(card().getByRole('alert').textContent).toBe('הנקודה מחוץ לתמונה.');
    sceneSays({ type: 'point', uv: [0.5, 0.5] });
    sceneSays({ type: 'tooClose' });
    expect(card().getByRole('alert').textContent)
      .toBe('שתי הנקודות קרובות מדי זו לזו. מרחק ארוך, כמו צלע של הגדר, נותן כיול מדויק יותר.');
    sceneSays({ type: 'point', uv: [0.51, 0.5] });
    const distance = card().getByLabelText('המרחק בין שתי הנקודות, במטרים');
    fireEvent.change(distance, { target: { value: 'abc' } });
    fireEvent.click(card().getByRole('button', { name: 'כיול' }));
    expect(card().getByRole('alert').textContent).toBe('צריך מספר במטרים, עם עד שתי ספרות אחרי הנקודה — למשל 2.5');
    // 26 cm of picture typed as 500 m would make it 5 km wide.
    fireEvent.change(distance, { target: { value: '500' } });
    fireEvent.click(card().getByRole('button', { name: 'כיול' }));
    expect(card().getByRole('alert').textContent)
      .toBe('בקנה המידה הזה התמונה הייתה מכסה פחות מ־10 ס״מ או יותר מ־500 מטר. כדאי לבדוק את המרחק שהוקלד.');
    expect(picture()).toEqual(IMAGE);
  });

  it('aligns the picture with the arrows and quarter turns, each one step, and Esc ends it', async () => {
    await renderEditor(IMAGE);
    fireEvent.click(inspector().getByRole('button', { name: 'לא כוילה' }));
    shown();
    fireEvent.click(card().getByRole('button', { name: 'הזזה' }));
    expect(lastScene().ui.tool).toBe('align');

    fireEvent.keyDown(stage(), { code: 'ArrowRight' });
    expect(picture()?.centreXCm).toBe(1310);
    fireEvent.keyDown(stage(), { code: 'ArrowUp', shiftKey: true });
    expect(picture()?.centreYCm).toBe(1100);
    fireEvent.click(card().getByRole('button', { name: 'סיבוב רבע ימינה' }));
    expect(picture()?.rotationTenths).toBe(900);
    fireEvent.keyDown(stage(), { code: 'KeyZ', metaKey: true });
    expect(picture()?.rotationTenths).toBe(0);

    fireEvent.keyDown(stage(), { code: 'Escape' });
    expect(lastScene().ui.tool).toBe('select');
    fireEvent.keyDown(stage(), { code: 'ArrowRight' });
    expect(picture()?.centreXCm).toBe(1310);
  });

  it('hides the picture and sets how see-through it is for this viewer only — nothing is saved', async () => {
    await renderEditor(IMAGE);
    fireEvent.click(screen.getByRole('button', { name: 'תמונת רקע' }));
    expect(lastScene().ui.underlay).toEqual({ shown: false, opacity: 0.5 });
    fireEvent.click(inspector().getByRole('button', { name: 'לא כוילה' }));
    fireEvent.change(card().getByRole('slider', { name: 'אטימות' }), { target: { value: '30' } });
    expect(lastScene().ui.underlay).toEqual({ shown: false, opacity: 0.3 });
    await new Promise((done) => { setTimeout(done, 700); });
    expect(saveSiteChangesAction).not.toHaveBeenCalled();
  });

  it('takes the picture off with a toast that says the file is kept, and ביטול brings it back', async () => {
    await renderEditor(IMAGE);
    fireEvent.click(inspector().getByRole('button', { name: 'לא כוילה' }));
    fireEvent.click(card().getByRole('button', { name: 'הסרת התמונה' }));
    expect(picture()).toBeNull();
    expect(await screen.findByText('תמונת הרקע הוסרה מהמפה. הקובץ עצמו נשמר, כדי שאפשר יהיה לבטל.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    await waitFor(() => { expect(picture()).toEqual(IMAGE); });
  });

  it('says in Hebrew why a file was refused, and sends nothing', async () => {
    await renderEditor(null);
    fireEvent.click(inspector().getByRole('button', { name: 'העלאת תמונה' }));
    const input = screen.getByRole('group', { name: 'תמונת רקע' }).querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.7\n'], 'plan.pdf', { type: 'application/pdf' })] } });
    expect(await card().findByRole('alert')).toBeTruthy();
    expect(card().getByRole('alert').textContent).toBe('קובץ PDF אי אפשר להעלות כרקע. צילום מסך של העמוד יעבוד.');
    expect(route).not.toHaveBeenCalled();
    expect(picture()).toBeNull();
  });
});

/** Uploads the sketch from the plot's row, as the first test does, and waits for it on the map. */
async function uploaded(): Promise<void> {
  fireEvent.click(inspector().getByRole('button', { name: 'העלאת תמונה' }));
  const input = screen.getByRole('group', { name: 'תמונת רקע' }).querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([png()], 'שרטוט.png', { type: 'image/png' })] } });
  await waitFor(() => { expect(picture()).toEqual(IMAGE); });
}

const toolRow = () => within(screen.getByRole('group', { name: 'כלי' }));

/*
 * Review U1: the picture's two tools end with the picture. However it goes —
 * an undo of its upload, a redo of its removal, the other lead's removal
 * reloaded — no calibration or alignment tool stays on over nothing.
 */
describe('the picture’s tools end with the picture (review U1)', () => {
  it('leaves the calibration when the tool row’s undo takes the new picture away, and the view it came from comes back', async () => {
    await renderEditor(null);
    await uploaded();
    expect(lastScene().ui).toMatchObject({ tool: 'calibrate', mode: 'plan' });
    sceneSays({ type: 'point', uv: [0.1, 0.5] });
    fireEvent.click(screen.getByRole('button', { name: 'ביטול הפעולה האחרונה' }));
    expect(picture()).toBeNull();
    expect(lastScene().ui).toMatchObject({ tool: 'select', mode: '3d' });
    expect(lastScene().underlayMarks).toEqual([]);
  });

  it('leaves the alignment when an undo takes the picture away', async () => {
    await renderEditor(null);
    await uploaded();
    shown();
    fireEvent.keyDown(stage(), { code: 'Escape' });
    fireEvent.click(card().getByRole('button', { name: 'הזזה' }));
    expect(lastScene().ui.tool).toBe('align');
    fireEvent.keyDown(stage(), { code: 'KeyZ', metaKey: true });
    expect(picture()).toBeNull();
    expect(lastScene().ui.tool).toBe('select');
  });

  it('leaves the picture’s tools by the tool row’s select and measure, with the view it came from', async () => {
    await renderEditor(IMAGE);
    await calibrating();
    sceneSays({ type: 'point', uv: [0.1, 0.5] });
    fireEvent.click(toolRow().getByRole('button', { name: /בחירה/ }));
    expect(lastScene().ui).toMatchObject({ tool: 'select', mode: '3d' });
    expect(lastScene().underlayMarks).toEqual([]);

    fireEvent.click(card().getByRole('button', { name: 'כיול' }));
    expect(lastScene().ui).toMatchObject({ tool: 'calibrate', mode: 'plan' });
    fireEvent.click(toolRow().getByRole('button', { name: /מדידה/ }));
    expect(lastScene().ui).toMatchObject({ tool: 'measure', mode: '3d' });

    fireEvent.click(toolRow().getByRole('button', { name: /בחירה/ }));
    fireEvent.click(card().getByRole('button', { name: 'הזזה' }));
    expect(lastScene().ui.tool).toBe('align');
    fireEvent.click(toolRow().getByRole('button', { name: /מדידה/ }));
    expect(lastScene().ui.tool).toBe('measure');
  });

  it('leaves them by the keys V and M too', async () => {
    await renderEditor(IMAGE);
    await calibrating();
    fireEvent.keyDown(stage(), { code: 'KeyV' });
    expect(lastScene().ui).toMatchObject({ tool: 'select', mode: '3d' });
    fireEvent.click(card().getByRole('button', { name: 'כיול' }));
    fireEvent.keyDown(stage(), { code: 'KeyM' });
    expect(lastScene().ui).toMatchObject({ tool: 'measure', mode: '3d' });
  });
});
