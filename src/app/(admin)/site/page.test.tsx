/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { SiteItemView, SitePlan } from '@/lib/site/plan';
import type { EditorDoc } from '@/lib/site/editor/model';

const { requireAdmin, resolveSeason, siteView, seasonsWithPlans, loadDoc, listTasks } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), resolveSeason: vi.fn(), siteView: vi.fn(),
  seasonsWithPlans: vi.fn(), loadDoc: vi.fn(), listTasks: vi.fn(),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/seasons/current', () => ({ resolveSeason }));
vi.mock('@/lib/work/tasks', () => ({ listTasks }));
/* Only the readers are replaced; the geometry the table draws stays real. */
vi.mock('@/lib/site/plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/site/plan')>()),
  siteView, seasonsWithPlans, loadDoc,
}));
/* The editor has its own tests, with the scene mocked — the item table it
   draws for a phone and a browser without WebGL among them. Here it only has
   to be handed the right things. Each mount takes the next number, so a test
   can tell a remount from a re-render. */
const mounts = vi.hoisted(() => ({ count: 0 }));
vi.mock('./editor/site-editor', async () => {
  const { useState } = await import('react');
  return {
    SiteEditor: function FakeEditor(props: {
      initial: { doc: EditorDoc; version: number };
      initialSelection: string | null;
      seasonId: string;
      seasonName: string;
      sunDate: string | null;
      buildTasks: ReadonlyArray<{ id: string; title: string }>;
      plotHref: string;
      seasonDateHref: string;
    }) {
      const [mount] = useState(() => { mounts.count += 1; return mounts.count; });
      return (
        <div
          data-testid="editor"
          data-mount={mount}
          data-season-id={props.seasonId}
          data-season={props.seasonName}
          data-selection={props.initialSelection ?? ''}
          data-sun={props.sunDate ?? ''}
          data-tasks={props.buildTasks.map((task) => `${task.id}:${task.title}`).join(',')}
          data-plot={props.plotHref}
          data-date={props.seasonDateHref}
        >
          <span data-testid="editor-map">{`editor:${props.initial.doc.items.length}:v${props.initial.version}`}</span>
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
  version: 3, northDeg: 0,
  updatedAt: new Date('2026-09-01T00:00:00Z'), updatedBy: 'lead@shliff.camp',
};

function item(over: Partial<SiteItemView> & { id: string }): SiteItemView {
  return {
    planId: 'p1', kind: 'tent', label: 'אוהל 1', xCm: 0, yCm: 0, widthCm: 300, depthCm: 300,
    insetCm: null, ropeAngleDeg: null, heightCm: null, locked: false, sort: 0, taskId: null, taskTitle: null, notes: null,
    updatedAt: new Date('2026-09-01T00:00:00Z'), updatedBy: 'lead@shliff.camp',
    outside: false, overlapping: false, shade: 'unshaded', ...over,
  };
}

function view(items: SiteItemView[]) {
  return {
    plan: PLAN,
    items,
    lines: [],
    counts: {
      items: items.length, outside: items.filter((row) => row.outside).length, overlapping: 0, overlapPairs: 0,
      plotAreaM2: 624, shade: { nets: 0, shaded: 0, partly: 0, unshaded: items.length, shadedAreaM2: 0 },
    },
  };
}

/** What `loadDoc` answers for the same rows: the editor's document and the version it saves against. */
function loaded(ids: string[], planId = 'p1', version = 3): { doc: EditorDoc; version: number } {
  return {
    version,
    doc: {
      plot: { id: planId, widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 },
      items: ids.map((id, index) => ({
        id, kind: 'tent', label: `אוהל ${index + 1}`, xCm: 0, yCm: 0, widthCm: 300, depthCm: 300,
        heightCm: null, insetCm: null, ropeAngleDeg: null, sort: index, taskId: null, notes: null, locked: false,
      })),
      lines: [],
      defaults: {},
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  resolveSeason.mockResolvedValue({ seasons: [S26, S25], current: S26 });
  siteView.mockResolvedValue(null);
  seasonsWithPlans.mockResolvedValue([]);
  loadDoc.mockResolvedValue(null);
  listTasks.mockResolvedValue([]);
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
    expect(screen.queryByTestId('editor')).toBeNull();
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

  it('mounts the editor with the map it saves against, the season’s build tasks and the drawers’ addresses', async () => {
    siteView.mockResolvedValue(view([item({ id: 'a' }), item({ id: 'b', label: 'אוהל 2' })]));
    loadDoc.mockResolvedValue(loaded(['a', 'b']));
    listTasks.mockResolvedValue([{ taskId: 't1', title: 'הקמת המטבח' }]);
    await renderPage();

    const editor = screen.getByTestId('editor');
    expect(screen.getByTestId('editor-map').textContent).toBe('editor:2:v3');
    expect(editor.getAttribute('data-tasks')).toBe('t1:הקמת המטבח');
    // The season a build task's link in the editor's item table goes to.
    expect(editor.getAttribute('data-season-id')).toBe('s26');
    expect(editor.getAttribute('data-plot')).toBe('/site?season=s26&act=plot');
    // The sun card's gate day links to the shell's drawer for this season's opening date (SD4).
    expect(editor.getAttribute('data-date')).toBe('/site?season=s26&act=season-date');
    expect(loadDoc).toHaveBeenCalledWith({}, 'p1');
    expect(listTasks).toHaveBeenCalledWith({}, 's26', { kind: 'build' });
  });

  /* Ruling T26-1: the flag retired, but a link that still carries it (one was
     handed out) opens the same editor, and nothing built from it carries it on. */
  it('opens the editor from an old ?editor=3d link too, and carries the flag no further', async () => {
    siteView.mockResolvedValue(view([item({ id: 'a' })]));
    loadDoc.mockResolvedValue(loaded(['a']));
    await renderPage({ editor: '3d', act: 'plot' });

    const editor = screen.getByTestId('editor');
    expect(screen.getByTestId('editor-map').textContent).toBe('editor:1:v3');
    expect(editor.getAttribute('data-plot')).toBe('/site?season=s26&act=plot');
    expect(editor.getAttribute('data-date')).toBe('/site?season=s26&act=season-date');
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByRole('link', { name: 'סגירה' }).getAttribute('href')).toBe('/site?season=s26');
  });

  /* The item table is the editor's own now, drawn from the map being edited
     (its tests hold it); the page draws none beside it. */
  it('leaves the item table to the editor', async () => {
    siteView.mockResolvedValue(view([item({ id: 'a' })]));
    loadDoc.mockResolvedValue(loaded(['a']));
    await renderPage();
    expect(screen.getByTestId('editor')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('draws no stat tiles and no outside banner: the checks bar and the inspector say it now', async () => {
    siteView.mockResolvedValue(view([item({ id: 'out', xCm: 2500, outside: true })]));
    loadDoc.mockResolvedValue(loaded(['out']));
    await renderPage();
    expect(screen.queryByRole('region', { name: 'פריטים מחוץ למגרש' })).toBeNull();
    expect(screen.queryByText('שטח המגרש')).toBeNull();
  });

  it('selects the item ?peek= names when the map loads, and opens nothing over it — not even for ?act=remove', async () => {
    siteView.mockResolvedValue(view([item({ id: 'a' })]));
    loadDoc.mockResolvedValue(loaded(['a']));
    resolveSeason.mockResolvedValue({ seasons: [S26], current: { ...S26, startsOn: new Date('2026-06-03T22:30:00Z') } });
    await renderPage({ peek: 'a', act: 'remove' });
    const editor = screen.getByTestId('editor');
    expect(editor.getAttribute('data-selection')).toBe('a');
    // The gate day, as the calendar date it is in Israel.
    expect(editor.getAttribute('data-sun')).toBe('2026-06-04');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('selects nothing for a ?peek= that is not on this map, and passes no day when the season has none', async () => {
    siteView.mockResolvedValue(view([item({ id: 'a' })]));
    loadDoc.mockResolvedValue(loaded(['a']));
    await renderPage({ peek: 'z' });
    const editor = screen.getByTestId('editor');
    expect(editor.getAttribute('data-selection')).toBe('');
    expect(editor.getAttribute('data-sun')).toBe('');
  });

  it('opens the plot settings over the editor, north included', async () => {
    siteView.mockResolvedValue(view([item({ id: 'a' })]));
    loadDoc.mockResolvedValue(loaded(['a']));
    await renderPage({ act: 'plot' });
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByRole('heading', { name: 'הגדרות המגרש' })).toBeTruthy();
    expect((drawer.getByLabelText('כיוון הצפון') as HTMLInputElement).value).toBe('0');
    expect(drawer.getByRole('link', { name: 'סגירה' }).getAttribute('href')).toBe('/site?season=s26');
    expect(screen.getByTestId('editor')).toBeTruthy();
  });

  /* Keyed on the plan: another season's map is another editor, so one
     season's name can never sit over another season's frozen map. Never on
     the version: the page re-renders after the plot drawer saves, and a
     remount then would throw away edits the queue has not sent yet. */
  it('remounts the editor for another season’s map, and never for a newer version of the same one', async () => {
    siteView.mockResolvedValue(view([item({ id: 'a' }), item({ id: 'b' })]));
    loadDoc.mockResolvedValue(loaded(['a', 'b'], 'p1', 4));
    const { rerender } = await renderPage();
    const first = screen.getByTestId('editor').getAttribute('data-mount');

    loadDoc.mockResolvedValue(loaded(['a', 'b'], 'p1', 5));
    rerender(await pageFor());
    expect(screen.getByTestId('editor-map').textContent).toBe('editor:2:v5');
    expect(screen.getByTestId('editor').getAttribute('data-mount')).toBe(first);

    resolveSeason.mockResolvedValue({ seasons: [S26, S25], current: S25 });
    siteView.mockResolvedValue({
      ...view([item({ id: 'c', planId: 'p2' })]),
      plan: { ...PLAN, id: 'p2', seasonId: 's25' },
    });
    loadDoc.mockResolvedValue(loaded(['c'], 'p2', 1));
    rerender(await pageFor({ season: 's25' }));
    const editor = screen.getByTestId('editor');
    expect(editor.getAttribute('data-season')).toBe('ברן 25');
    expect(screen.getByTestId('editor-map').textContent).toBe('editor:1:v1');
    expect(editor.getAttribute('data-mount')).not.toBe(first);
  });

  /* `loadDoc` answers null only if the plan was there for `siteView` and not
     found a moment later. The board used to be the fallback; it retired, and a
     404 would say the page does not exist, which is not true. So the page says
     what it found — no more than that: no code path deletes a map, so it does
     not claim one changed or went — and what a reload will show, and keeps
     what it did read readable. */
  it('says the map was not found, and what a reload will show — never a crash', async () => {
    siteView.mockResolvedValue(view([item({ id: 'a' })]));
    loadDoc.mockResolvedValue(null);
    // The old flag too: nothing on this fallback may carry it on (integration I's minor).
    await renderPage({ editor: '3d', act: 'plot' });

    const region = screen.getByRole('region', { name: 'המפה לא נמצאה' });
    const notice = within(region);
    expect(notice.getByText('המפה לא נמצאה כשנפתחה לעריכה.')).toBeTruthy();
    expect(region.textContent).toMatch(/טעינה מחדש תקרא אותה שוב: אם היא שם, היא תיפתח לעריכה; אם לא, יוצע ליצור מפה לשנה הזו\./);
    expect(region.textContent).not.toMatch(/השתנתה|נמחקה/);
    expect(notice.getByRole('link', { name: 'טעינה מחדש' }).getAttribute('href')).toBe('/site?season=s26');
    // What was read a moment ago stays readable, and says it was typed by hand (R11).
    const table = within(screen.getByRole('table', { name: 'הפריטים במפה' }));
    // A name, not a link: there is no map here to select it on.
    expect(table.getByText('אוהל 1')).toBeTruthy();
    expect(table.queryByRole('link', { name: 'אוהל 1' })).toBeNull();
    expect(table.getAllByRole('img', { name: 'מקור: נרשם ידנית' })).toHaveLength(1);
    // No editor over a map that is not there, and no drawer that would save into it.
    expect(screen.queryByTestId('editor')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'מפת הקאמפ' })).toBeTruthy();
  });

  it('is not found for a signed-in non-admin', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    await expect(renderPage()).rejects.toThrow();
  });
});
