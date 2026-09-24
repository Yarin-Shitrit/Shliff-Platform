/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { SiteItemView, SitePlan } from '@/lib/site/plan';

const { requireAdmin, resolveSeason, siteView, seasonsWithPlans, itemById, listTasks, loadDoc } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), resolveSeason: vi.fn(), siteView: vi.fn(),
  seasonsWithPlans: vi.fn(), itemById: vi.fn(), listTasks: vi.fn(), loadDoc: vi.fn(),
}));
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/seasons/current', () => ({ resolveSeason }));
vi.mock('@/lib/work/tasks', () => ({ listTasks }));
/* Only the readers are replaced; the geometry the screen draws stays real. */
vi.mock('@/lib/site/plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/site/plan')>()),
  siteView, seasonsWithPlans, itemById, loadDoc,
}));
/* The board reaches `useToast`, which needs a provider the page does not
   render (the admin layout does). The board has its own test. */
vi.mock('./site-board', () => ({
  SiteBoard: ({ items }: { items: unknown[] }) => <div data-testid="board">{`board:${items.length}`}</div>,
}));
/* The editor has its own tests, with the scene mocked; here it only has to be handed the right things.
   Each mount takes the next number, so a test can tell a remount from a re-render. */
const mounts = vi.hoisted(() => ({ count: 0 }));
vi.mock('./editor/site-editor', async () => {
  const { useState } = await import('react');
  return {
    SiteEditor: function FakeEditor(props: {
      initial: { doc: { items: unknown[] }; version: number };
      initialSelection: string | null;
      seasonName: string;
      sunDate: string | null;
      buildTasks: ReadonlyArray<{ id: string; title: string }>;
      plotHref: string;
    }) {
      const [mount] = useState(() => { mounts.count += 1; return mounts.count; });
      return (
        <div
          data-testid="editor"
          data-mount={mount}
          data-season={props.seasonName}
          data-selection={props.initialSelection ?? ''}
          data-sun={props.sunDate ?? ''}
          data-tasks={props.buildTasks.map((task) => task.title).join(',')}
          data-plot={props.plotHref}
        >
          {`editor:${props.initial.doc.items.length}:v${props.initial.version}`}
        </div>
      );
    },
  };
});

import SitePage from './page';

const S26 = { id: 's26', name: 'ברן 26', year: 2026, flatRate: '1200.00', plannedSize: 35, startsOn: null };
const S25 = { id: 's25', name: 'ברן 25', year: 2025, flatRate: '1500.00', plannedSize: 43, startsOn: null };

const PLAN: SitePlan = {
  id: 'p1', seasonId: 's26', widthCm: 2600, depthCm: 2400, gridCm: 50, notes: null,
  version: 0, northDeg: 0,
  updatedAt: new Date('2026-09-01T00:00:00Z'), updatedBy: 'lead@shliff.camp',
};

function item(over: Partial<SiteItemView> & { id: string }): SiteItemView {
  return {
    planId: 'p1', kind: 'tent', label: 'אוהל 1', xCm: 0, yCm: 0, widthCm: 300, depthCm: 300,
    insetCm: null, heightCm: null, locked: false, sort: 0, taskId: null, taskTitle: null, notes: null,
    updatedAt: new Date('2026-09-01T00:00:00Z'), updatedBy: 'lead@shliff.camp',
    outside: false, overlapping: false, shade: 'unshaded', ...over,
  };
}

function view(items: SiteItemView[], counts: Partial<ReturnType<typeof baseCounts>> = {}) {
  return { plan: PLAN, items, counts: { ...baseCounts(items.length), ...counts } };
}

function baseCounts(items: number) {
  return {
    items, outside: 0, overlapping: 0, overlapPairs: 0, plotAreaM2: 624,
    shade: { nets: 0, shaded: 0, partly: 0, unshaded: items, shadedAreaM2: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  resolveSeason.mockResolvedValue({ seasons: [S26, S25], current: S26 });
  siteView.mockResolvedValue(null);
  seasonsWithPlans.mockResolvedValue([]);
  itemById.mockResolvedValue(null);
  listTasks.mockResolvedValue([]);
  loadDoc.mockResolvedValue(null);
});

/* The admin layout mounts the `ToastProvider` the drawers report through. */
async function pageFor(params: Record<string, string> = {}) {
  const page = await SitePage({ searchParams: Promise.resolve({ season: 's26', ...params }) });
  return <ToastProvider>{page}</ToastProvider>;
}

async function renderPage(params: Record<string, string> = {}) {
  return render(await pageFor(params));
}

describe('the camp map screen', () => {
  it('invites an import when the camp has no seasons at all', async () => {
    resolveSeason.mockResolvedValue({ seasons: [], current: null });
    await renderPage();
    expect(screen.getByText('אין כאן כלום עדיין')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ייבוא מהגיליון' }).getAttribute('href')).toBe('/imports');
  });

  it('invites the lead to create a map for a season that has none', async () => {
    await renderPage();
    expect(screen.getByText('אין כאן כלום לשנה הזו')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'יצירת מפה' }).getAttribute('href'))
      .toBe('/site?season=s26&act=plot');
    expect(screen.queryByRole('link', { name: /העתקה/ })).toBeNull();
  });

  it('offers a copy from a season that has a map', async () => {
    seasonsWithPlans.mockResolvedValue([{ seasonId: 's25', seasonName: 'ברן 25', items: 12 }]);
    await renderPage();
    expect(screen.getByRole('link', { name: 'העתקה מברן 25' }).getAttribute('href'))
      .toBe('/site?season=s26&act=copy');
  });

  it('opens the create drawer from the URL', async () => {
    await renderPage({ act: 'plot' });
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('יצירת מפה')).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'יצירת המפה' })).toBeTruthy();
  });

  it('draws the plot, its tiles and its list, every figure linking onward', async () => {
    siteView.mockResolvedValue(view([
      item({ id: 'a', label: 'אוהל 1' }),
      item({ id: 'b', label: 'מטבח 1', kind: 'kitchen', xCm: 500, widthCm: 400, taskId: 't1', taskTitle: 'הקמת המטבח' }),
    ]));
    await renderPage();

    expect(screen.getByText('624 מ״ר')).toBeTruthy();
    expect(screen.getByText('26 × 24 מ׳ · נרשם ידנית')).toBeTruthy();
    expect(screen.getByRole('link', { name: /שטח המגרש/ }).getAttribute('href'))
      .toBe('/site?season=s26&act=plot');
    expect(screen.getByTestId('board').textContent).toBe('board:2');

    const table = screen.getByRole('table', { name: 'הפריטים במפה' });
    expect(within(table).getByRole('link', { name: 'אוהל 1' }).getAttribute('href'))
      .toBe('/site?season=s26&peek=a');
    expect(within(table).getByRole('link', { name: 'הקמת המטבח' }).getAttribute('href'))
      .toBe('/logistics/build?season=s26');
    // Two icon-only actions per row, each named (E4), the bin pointing at the confirmation.
    expect(within(table).getAllByRole('link', { name: 'עריכה' }).map((a) => a.getAttribute('href')))
      .toEqual(['/site?season=s26&peek=a', '/site?season=s26&peek=b']);
    expect(within(table).getAllByRole('link', { name: 'מחיקה' }).map((a) => a.getAttribute('href')))
      .toEqual(['/site?season=s26&peek=a&act=remove', '/site?season=s26&peek=b&act=remove']);
    // R11, on every row.
    expect(within(table).getAllByRole('img', { name: 'מקור: נרשם ידנית' })).toHaveLength(2);
  });

  it('counts what the fence cuts through and points at the first offender, moving nothing', async () => {
    siteView.mockResolvedValue(view([
      item({ id: 'in' }),
      item({ id: 'out', label: 'קראוון 1', kind: 'caravan', xCm: 2500, outside: true }),
    ], { outside: 1 }));
    await renderPage();

    const banner = screen.getByRole('region', { name: 'פריטים מחוץ למגרש' });
    expect(within(banner).getByText('1 פריטים נמצאים מחוץ למגרש.')).toBeTruthy();
    expect(within(banner).getByRole('link', { name: 'לפריט הראשון' }).getAttribute('href'))
      .toBe('/site?season=s26&peek=out');
    expect(screen.getByRole('link', { name: /מחוץ למגרש/ }).getAttribute('href'))
      .toBe('/site?season=s26&peek=out');
    // The row says the word, not just the colour.
    const table = screen.getByRole('table', { name: 'הפריטים במפה' });
    expect(within(table).getAllByText('מחוץ למגרש').length).toBeGreaterThan(0);
  });

  it('says how much of the ground is in shade, and who is not', async () => {
    siteView.mockResolvedValue(view([
      item({ id: 'net', kind: 'shade', label: 'רשת צל 1', widthCm: 800, depthCm: 800, insetCm: 50, shade: null }),
      item({ id: 'sofa', kind: 'sofa', label: 'ספה 1', xCm: 200, yCm: 200, widthCm: 200, depthCm: 90, shade: 'shaded' }),
      item({ id: 'chair', kind: 'armchair', label: 'כורסה 1', widthCm: 90, depthCm: 90, shade: 'partly' }),
    ], { shade: { nets: 1, shaded: 1, partly: 1, unshaded: 0, shadedAreaM2: 49 } }));
    await renderPage();

    expect(screen.getByText('49 מ״ר')).toBeTruthy();
    expect(screen.getByText('1 רשתות צל · 1 פריטים חלקית או ללא צל')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'הפריטים במפה' });
    expect(within(table).getByText('בצל 7 × 7 מ׳')).toBeTruthy();
    expect(within(table).getByText('חלקית בצל')).toBeTruthy();
    expect(within(table).getByText('בצל')).toBeTruthy();
  });

  it('opens the item drawer over the row the URL names, with the season’s build tasks', async () => {
    const row = item({ id: 'a', label: 'אוהל 1' });
    siteView.mockResolvedValue(view([row]));
    itemById.mockResolvedValue(row);
    listTasks.mockResolvedValue([{ taskId: 't1', title: 'הקמת המטבח' }]);
    await renderPage({ peek: 'a' });

    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: 'אוהל 1' })).toBeTruthy();
    expect(within(drawer).getByRole('option', { name: 'הקמת המטבח' })).toBeTruthy();
    expect(within(drawer).getByRole('link', { name: 'הסרה מהמפה' }).getAttribute('href'))
      .toBe('/site?season=s26&peek=a&act=remove');
  });

  it('raises the confirmation, naming the verb, when asked to remove', async () => {
    const row = item({ id: 'a', label: 'אוהל 1' });
    siteView.mockResolvedValue(view([row]));
    itemById.mockResolvedValue(row);
    await renderPage({ peek: 'a', act: 'remove' });
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'הסרת הפריט' })).toBeTruthy();
  });

  it('opens no drawer for an item on another season’s map', async () => {
    siteView.mockResolvedValue(view([item({ id: 'a' })]));
    itemById.mockResolvedValue(item({ id: 'z', planId: 'p-other' }));
    await renderPage({ peek: 'z' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('behind ?editor=3d', () => {
    const LOADED = {
      version: 4,
      doc: {
        plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 },
        items: [{ id: 'a' }, { id: 'b' }],
        defaults: {},
      },
    };

    it('mounts the editor with the document it saves against, instead of the board', async () => {
      siteView.mockResolvedValue(view([item({ id: 'a' }), item({ id: 'b', label: 'אוהל 2' })]));
      loadDoc.mockResolvedValue(LOADED);
      listTasks.mockResolvedValue([{ taskId: 't1', title: 'הקמת המטבח' }]);
      await renderPage({ editor: '3d' });

      expect(loadDoc).toHaveBeenCalledWith({}, 'p1');
      const editor = screen.getByTestId('editor');
      expect(editor.textContent).toBe('editor:2:v4');
      expect(editor.getAttribute('data-tasks')).toBe('הקמת המטבח');
      expect(editor.getAttribute('data-plot')).toBe('/site?season=s26&act=plot');
      expect(screen.queryByTestId('board')).toBeNull();
      expect(screen.queryByRole('table', { name: 'הפריטים במפה' })).toBeNull();
    });

    it('selects the item ?peek= names instead of opening a drawer, and passes the gate day in Israel', async () => {
      siteView.mockResolvedValue(view([item({ id: 'a' })]));
      loadDoc.mockResolvedValue(LOADED);
      resolveSeason.mockResolvedValue({ seasons: [S26], current: { ...S26, startsOn: new Date('2026-06-03T22:30:00Z') } });
      await renderPage({ editor: '3d', peek: 'a' });
      const editor = screen.getByTestId('editor');
      expect(editor.getAttribute('data-selection')).toBe('a');
      expect(editor.getAttribute('data-sun')).toBe('2026-06-04');
      expect(screen.queryByRole('dialog')).toBeNull();
      // The drawer's own read is not made for a drawer that never opens.
      expect(itemById).not.toHaveBeenCalled();
    });

    it('selects nothing for a ?peek= that is not on this map, and no sun without a gate day', async () => {
      siteView.mockResolvedValue(view([item({ id: 'a' })]));
      loadDoc.mockResolvedValue(LOADED);
      await renderPage({ editor: '3d', peek: 'z' });
      const editor = screen.getByTestId('editor');
      expect(editor.getAttribute('data-selection')).toBe('');
      expect(editor.getAttribute('data-sun')).toBe('');
    });

    it('still opens the plot drawer over it', async () => {
      siteView.mockResolvedValue(view([item({ id: 'a' })]));
      loadDoc.mockResolvedValue(LOADED);
      await renderPage({ editor: '3d', act: 'plot' });
      expect(screen.getByTestId('editor')).toBeTruthy();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    /* Keyed on the plan: another season's map is another editor, so one
       season's name can never sit over another season's frozen map. Never on
       the version: the page re-renders after the plot drawer saves, and a
       remount then would throw away edits the queue has not sent yet. */
    it('remounts the editor for another season’s map, and never for a newer version of the same one', async () => {
      siteView.mockResolvedValue(view([item({ id: 'a' }), item({ id: 'b' })]));
      loadDoc.mockResolvedValue(LOADED);
      const { rerender } = await renderPage({ editor: '3d' });
      const first = screen.getByTestId('editor').getAttribute('data-mount');

      loadDoc.mockResolvedValue({ ...LOADED, version: 5 });
      rerender(await pageFor({ editor: '3d' }));
      expect(screen.getByTestId('editor').textContent).toBe('editor:2:v5');
      expect(screen.getByTestId('editor').getAttribute('data-mount')).toBe(first);

      resolveSeason.mockResolvedValue({ seasons: [S26, S25], current: S25 });
      siteView.mockResolvedValue({
        ...view([item({ id: 'c', planId: 'p2' })]),
        plan: { ...PLAN, id: 'p2', seasonId: 's25' },
      });
      loadDoc.mockResolvedValue({ version: 1, doc: { ...LOADED.doc, plot: { ...LOADED.doc.plot, id: 'p2' }, items: [{ id: 'c' }] } });
      rerender(await pageFor({ season: 's25', editor: '3d' }));
      const editor = screen.getByTestId('editor');
      expect(editor.getAttribute('data-season')).toBe('ברן 25');
      expect(editor.textContent).toBe('editor:1:v1');
      expect(editor.getAttribute('data-mount')).not.toBe(first);
    });

    it('keeps the board for any other value of ?editor', async () => {
      siteView.mockResolvedValue(view([item({ id: 'a' })]));
      await renderPage({ editor: '2d' });
      expect(screen.getByTestId('board')).toBeTruthy();
      expect(loadDoc).not.toHaveBeenCalled();
    });

    it('falls back to the board when the plan vanished between the two reads', async () => {
      siteView.mockResolvedValue(view([item({ id: 'a' })]));
      loadDoc.mockResolvedValue(null);
      await renderPage({ editor: '3d' });
      expect(screen.queryByTestId('editor')).toBeNull();
      expect(screen.getByTestId('board')).toBeTruthy();
    });
  });

  it('is not found for a signed-in non-admin', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    await expect(renderPage()).rejects.toThrow();
  });
});
