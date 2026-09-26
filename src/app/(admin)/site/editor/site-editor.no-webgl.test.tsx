/**
 * @vitest-environment jsdom
 */
/*
 * Its own file, because the editor asks about WebGL once per page load — a new
 * module registry is a new page.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { EditorDoc } from '@/lib/site/editor/model';
import type { SceneHandle, SceneViewProps } from './scene/scene-view';

vi.mock('../actions', () => ({ saveSiteChangesAction: vi.fn(), loadSiteDocAction: vi.fn() }));
/* `next/dynamic` as the app router builds it — see `site-editor.test.tsx`. */
vi.mock('next/dynamic', async () => ({
  default: (await import('next/dist/shared/lib/app-dynamic')).default,
}));
/* Stands in for SceneView's own no-WebGL notice; plan 03's tests hold its words. */
vi.mock('./scene/scene-view', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  const SceneView = forwardRef<SceneHandle, SceneViewProps>(function FakeScene(_props, ref) {
    useImperativeHandle(ref, () => ({}) as SceneHandle);
    return <p data-testid="scene">המפה צריכה דפדפן עם גרפיקה תלת־ממדית פעילה.</p>;
  });
  return { SceneView };
});

import { SiteEditor } from './site-editor';

/* This file's own fixture. */
const DOC: EditorDoc = {
  plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 },
  items: [{
    id: 'a', kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, facing: 0, locked: false,
  }],
  lines: [],
  defaults: {},
};

// This browser gives no WebGL: every context comes back null (a test can change that).
const getContext = vi.fn<(kind: string) => unknown>(() => null);

beforeAll(() => {
  // A wide screen: the map would be the view, if the browser could draw it.
  window.matchMedia = ((query: string) => ({
    matches: query === '(width >= 900px)',
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  HTMLCanvasElement.prototype.getContext = getContext as unknown as HTMLCanvasElement['getContext'];
});

/** The modules a render uses — this file's own, or a fresh page load's (`vi.resetModules`). */
type Loaded = { Editor: typeof SiteEditor; Toasts: typeof ToastProvider };

function renderEditor({ Editor, Toasts }: Loaded = { Editor: SiteEditor, Toasts: ToastProvider }) {
  return render(
    <Toasts>
      <Editor
        initial={{ doc: DOC, version: 0 }}
        initialSelection="a"
        seasonId="s26"
        seasonName="ברן 26"
        sunDate={null}
        buildTasks={[]}
        plotHref="/site?season=s26&act=plot"
        seasonDateHref="/site?season=s26&act=season-date"
      />
    </Toasts>,
  );
}

describe('the editor without WebGL', () => {
  it('puts the item table under the scene’s own notice, and draws no tool row', async () => {
    renderEditor();
    expect(await screen.findByTestId('scene')).toBeTruthy();
    expect(within(screen.getByRole('table', { name: 'הפריטים במפה' })).getByText('אוהל 1')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'כלי העריכה' })).toBeNull();
    // The top bar still says where saving stands, and still leads to the plot settings.
    expect(screen.getByText('כל השינויים נשמרו')).toBeTruthy();
    // What the table cannot do is the scene's notice; what still works here is said under it.
    const note = screen.getByText(/כאן אפשר לקרוא את הפריטים ולשנות את/).closest('p');
    if (note === null) throw new Error('the note is not a paragraph');
    expect(within(note).getByRole('link', { name: 'הגדרות המגרש' }).getAttribute('href')).toBe('/site?season=s26&act=plot');
    // A wide screen here: the note does not send the lead to find a wider one.
    expect(note.textContent).not.toMatch(/900/);
    // No picture of a map the browser cannot draw.
    expect(screen.queryByRole('button', { name: 'ייצוא תמונה' })).toBeNull();
  });

  /* Review I2: the table reads the flags the checks read. With the camp's
     rope angle (45°, 3 m nets), a net flush with the east fence by its cloth
     has its stakes 3 m past it: outside, in the table as in the checks bar. */
  it('flags a net outside by its ropes in the item table, with the camp’s angle', async () => {
    const roped: EditorDoc = {
      ...DOC,
      items: [{ ...DOC.items[0], id: 'n', kind: 'shade', label: 'רשת צל 1', xCm: 1800, yCm: 800, widthCm: 800, depthCm: 800, insetCm: 50 }],
      defaults: { shade: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } },
    };
    render(
      <ToastProvider>
        <SiteEditor
          initial={{ doc: roped, version: 0 }}
          initialSelection={null}
          seasonId="s26"
          seasonName="ברן 26"
          sunDate={null}
          buildTasks={[]}
          plotHref="/site?season=s26&act=plot"
          seasonDateHref="/site?season=s26&act=season-date"
        />
      </ToastProvider>,
    );
    const table = await screen.findByRole('table', { name: 'הפריטים במפה' });
    const row = within(table).getByText('רשת צל 1').closest('tr');
    if (row === null) throw new Error('the net has no row');
    expect(within(row).getByText('מחוץ למגרש')).toBeTruthy();
  });

  /* Ruling P7: no shortcut acts on a map that is not shown. */
  it('leaves every key to the page', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    const table = screen.getByRole('table', { name: 'הפריטים במפה' });
    for (const keys of [{ code: 'Delete' }, { code: 'KeyR' }, { code: 'KeyZ', metaKey: true }, { code: 'Slash', shiftKey: true }]) {
      const press = createEvent.keyDown(table, keys);
      fireEvent(table, press);
      expect(press.defaultPrevented).toBe(false);
    }
  });

  /** A new module registry is a new page load: nothing has asked yet in it. */
  async function freshPage(): Promise<Loaded> {
    vi.resetModules();
    return {
      Editor: (await import('./site-editor')).SiteEditor,
      Toasts: (await import('@/components/ui/toaster')).ToastProvider,
    };
  }

  it('asks the browser once per page load, and only for WebGL 2, however often the editor mounts', async () => {
    const fresh = await freshPage();
    getContext.mockClear();
    const first = renderEditor(fresh);
    await screen.findByTestId('scene');
    expect(getContext.mock.calls.map((call) => call[0])).toEqual(['webgl2']);
    first.unmount();
    renderEditor(fresh);
    await screen.findByTestId('scene');
    // The same page load: the second editor takes the first answer.
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  /* three's WebGLRenderer (r186) needs WebGL 2: a browser that offers only
     WebGL 1 cannot draw the map, so it gets the table — not the editor's
     chrome over a scene that will never start, with its keys live. */
  it('treats a browser with only WebGL 1 as one without WebGL', async () => {
    const fresh = await freshPage();
    getContext.mockImplementation((kind) => (kind === 'webgl' ? { getExtension: () => null } : null));
    try {
      renderEditor(fresh);
      expect(await screen.findByTestId('scene')).toBeTruthy();
      expect(screen.getByRole('table', { name: 'הפריטים במפה' })).toBeTruthy();
      expect(screen.queryByRole('group', { name: 'כלי העריכה' })).toBeNull();
      const press = createEvent.keyDown(screen.getByRole('table', { name: 'הפריטים במפה' }), { code: 'Delete' });
      fireEvent(screen.getByRole('table', { name: 'הפריטים במפה' }), press);
      expect(press.defaultPrevented).toBe(false);
    } finally {
      getContext.mockImplementation(() => null);
    }
  });
});
