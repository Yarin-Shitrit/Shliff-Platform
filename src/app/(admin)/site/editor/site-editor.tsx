'use client';

/**
 * מפת הקאמפ's editor (spec §4, §10): one store, one scene, and the panels
 * floating over it.
 *
 * The page loads the rows once and hands them over. From then on the store is
 * what the screen shows and every edit is saved in the background (§6.1) —
 * there is no `router.refresh()` here, which is what stopped items jumping.
 *
 * `three` is reached only through `SceneView`, loaded with `next/dynamic` and
 * `ssr: false` — allowed only inside a Client Component
 * (`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`, "Skipping
 * SSR"), which this file is. The scene is driven only through `EditorUi`,
 * `Insets` and the `SceneHandle` ref.
 */

import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type RefAttributes,
} from 'react';
import { SeasonChip, TopBar } from '@/components/shell/top-bar';
import { Button, ButtonLink } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toaster';
import type { SiteItemKind, SiteLineKind } from '@/db/schema/site';
import { formatDateFull } from '@/lib/dates';
import { derive } from '@/lib/site/derive';
import { effectiveSize } from '@/lib/site/defaults';
import { formatSize, snap } from '@/lib/site/geometry';
import { nearestFreeSpot } from '@/lib/site/editor/placement';
import { KIND_GROUP_ORDER, SITE_KINDS, type SiteKindGroup } from '@/lib/site/kinds';
import { LINE_KIND_ORDER, LINE_KINDS, lineLengthCm } from '@/lib/site/lines';
import { findItem, findLine, type EditorDoc, type EditorItem, type EditorLine } from '@/lib/site/editor/model';
import type { SiteOp } from '@/lib/site/editor/ops';
import {
  addLineOps, addOps, duplicateOps, lockOps, moveOps, removeLineOps, removeOps, splitOps, turnOps,
} from '@/lib/site/editor/commands';
import { screenArrowToMap } from '@/lib/site/editor/camera';
import { CAMP_SITE, jerusalemInstant, shadeAtHour, sunPosition } from '@/lib/site/editor/sun';
import { shadeRanking, shadeTimeline } from '@/lib/site/editor/shade-timeline';
import { burnDays, readSunDate } from '@/lib/site/views';
import { loadSiteDocAction, saveSiteChangesAction } from '../actions';
import { SiteLinesTable, SiteTable, type SiteLinesTableRow, type SiteTableRow } from '../site-table';
import { useEditorStore } from './use-editor-store';
import { SCENE_PALETTE, type SceneTheme } from './scene/palette';
import type { EditorUi, Insets, SceneHandle, SceneViewProps, ViewInfo } from './scene/scene-view';
import { shortcutFor, ZOOM_IN, type Arrow, type Shortcut } from './keyboard';
import { isolate, LOCKED_ALL_NOTICE, LOCKED_NOTICE } from './notices';
import { forgetUnsaved, isStaleBuild, keepUnsaved, readUnsaved, SITE_UPDATED } from './unsaved-work';
import { Toolbar } from './panels/toolbar';
import { ConflictBanner, SaveErrorBanner, SaveStatus } from './panels/save-status';
import { LibraryPanel } from './panels/library-panel';
import { ObjectsPanel } from './panels/objects-panel';
import { SidePanel, type SideTab } from './panels/side-panel';
import { PlotInspector } from './panels/inspector-plot';
import { ItemInspector } from './panels/inspector-item';
import { LineInspector, LinesInspector } from './panels/inspector-line';
import { MultiInspector } from './panels/inspector-multi';
import { SelectionActions } from './panels/selection-actions';
import { ChecksBar } from './panels/checks-bar';
import { Minimap } from './panels/minimap';
import { ViewControls } from './panels/view-controls';
import { SelectionBar } from './panels/selection-bar';
import { ShortcutsCard } from './panels/shortcuts-card';
import { SunCard } from './panels/sun-card';
import chrome from './panels/panel.module.css';
import inspectorStyles from './panels/inspector.module.css';
import actionStyles from './panels/selection-actions.module.css';
import styles from './editor.module.css';

const SceneView = dynamic<SceneViewProps & RefAttributes<SceneHandle>>(
  () => import('./scene/scene-view').then((loaded) => loaded.SceneView),
  { ssr: false },
);

export interface SiteEditorProps {
  initial: { doc: EditorDoc; version: number };
  /** `?peek=<id>`: selected when the map loads (spec §12). The page has checked it is on this map. */
  initialSelection: string | null;
  /** The season a build task's link in the item table goes to. */
  seasonId: string;
  seasonName: string;
  /** The gate day, `YYYY-MM-DD` in Israel (`sunDateOf`); null when the season has none (§11). */
  sunDate: string | null;
  /**
   * The burn's last day, written as `sunDate` is. Seasons have no end date
   * yet (ruling SIM3), so the page passes none and the burn is the gate day
   * alone; once `seasons.ends_on` exists, passing it gives every day a chip
   * and lets shade by hour play through them all.
   */
  sunEndDate?: string | null;
  buildTasks: ReadonlyArray<{ id: string; title: string }>;
  /** The plot drawer: size, grid and north. */
  plotHref: string;
  /** The shell's drawer for this season's opening date — the gate day the sun is worked out for (SD4). */
  seasonDateHref: string;
}

/**
 * The floating panels' footprint (§10, the mock): 12px from every edge, the
 * side panel 256px wide, the inspector 292px, the checks bar along the top and
 * the view controls along the bottom. The scene fits and flies inside what
 * they leave.
 *
 * Physical, because the scene's screen is. The page is `dir="rtl"`
 * (`src/app/layout.tsx`), so the side panel — at the inline start — is on the
 * right, and the inspector on the left.
 */
const GAP = 12;
const SIDE_PANEL_W = 256;
const INSPECTOR_W = 292;
const INSETS: Insets = {
  right: SIDE_PANEL_W + GAP * 2,
  left: INSPECTOR_W + GAP * 2,
  top: 56,
  bottom: 64,
};

/** The mock's opening state: 3D, labels on, snapping on, 14:00 for the sun. */
const INITIAL_UI: EditorUi = {
  tool: 'select', mode: '3d', labels: true, sun: false, netsHidden: false, snap: true,
  hiddenGroups: [], hour: 14, theme: 'light',
};

/** An undo toast pressed after a newer edit landed under it (the toast waits while the lead is inside it). */
const STALE_UNDO = 'לא בוטל: אחרי הפעולה הזו נעשו במפה שינויים נוספים.';

/** The plot settings were saved while edits here still waited to be saved (review minor). */
const PLOT_SAVED_UNDER_EDITS = 'הגדרות המגרש נשמרו, ויש כאן שינויים שעוד לא נשמרו. אפשר לשמור אותם מעל המפה המעודכנת, או לטעון אותה בלעדיהם.';

/** An in-app link away from the editor while saving is stopped (review I3). */
const LEAVE_UNSAVED = 'השינויים האחרונים עוד לא נשמרו, ומעבר לדף אחר יאבד אותם. לעבור בכל זאת?';

/** Until the scene reports: no scale bar (`pxPerM` 0), no selection box, nothing moving. */
const INITIAL_VIEW: ViewInfo = {
  yaw: 0, zoomPct: 100, pxPerM: 0, groundCorners: [], selectionBox: null, moving: false,
};

/* The theme is the page's (A13): `data-theme` on <html> when the reader chose
   one, else the OS preference — the same reading as `theme-toggle.tsx`. The
   server cannot know it, so it renders light and the client corrects it. */
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readTheme(): SceneTheme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'dark' || chosen === 'light') return chosen;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function subscribeTheme(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  media.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', onChange);
  };
}

function serverTheme(): SceneTheme {
  return 'light';
}

/* Under 900 px the table is the view (spec §7) and the scene is not even
   mounted, so a phone holds no WebGL context. The server cannot know the
   width; it renders the wide page, and the stylesheet shows the table in its
   place below 900 px until the client decides (`editor.module.css`). A range,
   so this and the stylesheet's `(width < 900px)` leave no width between them. */
const WIDE_QUERY = '(width >= 900px)';

function readWide(): boolean {
  return window.matchMedia(WIDE_QUERY).matches;
}

function subscribeWide(onChange: () => void): () => void {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener('change', onChange);
  return () => { media.removeEventListener('change', onChange); };
}

/**
 * Whether this browser can give WebGL 2, asked once per page load. WebGL 2
 * and nothing less: three's `WebGLRenderer` (r186) needs it, so a browser with
 * only WebGL 1 cannot draw the map either. `SceneView` says so in its own
 * words when it cannot, but tells nobody; the editor needs to know, to put the
 * item table under that notice. The context made to ask is let go at once.
 */
let webglAnswer: boolean | null = null;

function readWebgl(): boolean {
  if (webglAnswer === null) {
    try {
      const context = document.createElement('canvas').getContext('webgl2');
      webglAnswer = context !== null;
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webglAnswer = false;
    }
  }
  return webglAnswer;
}

/** Whether a browser can give WebGL does not change while the page is open. */
function subscribeNever(): () => void {
  return () => {};
}

/** The server renders the wide page with the map; the client corrects both once it can ask. */
function serverYes(): boolean {
  return true;
}

/* Whether this render is the client's own, past hydration: false on the
   server and while hydrating, true after — and from the start on a page the
   client renders itself. */
function clientYes(): boolean {
  return true;
}

function serverNo(): boolean {
  return false;
}

/* What the item table says it is for, above it (the table is the view only
   where the map is not). On a wide screen without WebGL the scene's own
   notice, just above, has already said what the browser lacks. */
const NARROW_NEEDS = 'את המפה עורכים במסך ברוחב 900 פיקסלים לפחות.';
const NARROW_NO_WEBGL_NEEDS = 'את המפה עורכים במסך ברוחב 900 פיקסלים לפחות, בדפדפן עם גרפיקה תלת־ממדית פעילה.';

/* "ייצוא תמונה" (spec §10). The picture is the scene's canvas; the labels are
   DOM, so they are not in it — said once the file is saved, until the engine
   draws them in (a later task). */
const EXPORTED = 'התמונה נשמרה, בלי התוויות שעל המפה.';
const EXPORT_FAILED = 'לא הצלחנו לשמור תמונה של המפה. אפשר לנסות שוב.';

/** How long a picture's blob URL outlives the click — long after any browser has started the download (FileSaver.js waits 40 s). */
const REVOKE_AFTER_MS = 40_000;

/**
 * Today as `YYYY-MM-DD`, the day it is in Israel, for a file name. Made by the
 * platform's one date helper (`formatDateFull`, `DD/MM/YYYY` in the camp's
 * timezone) and reordered: a file name cannot carry a slash.
 */
function todayInIsrael(): string {
  const [day, month, year] = formatDateFull(new Date()).split('/');
  return `${year}-${month}-${day}`;
}

/** The scene's group colours, handed to every panel as custom properties. */
function paletteVars(theme: SceneTheme): CSSProperties {
  const palette = SCENE_PALETTE[theme];
  const vars: Record<string, string> = {
    '--scene-plot': palette.plot,
    '--scene-outside': palette.outside,
    '--scene-fence': palette.fence,
  };
  for (const group of KIND_GROUP_ORDER) vars[`--group-${group}`] = palette.groups[group];
  for (const kind of LINE_KIND_ORDER) vars[`--line-${kind}`] = palette.lines[kind];
  return vars as CSSProperties;
}

/** The scene reports up to ten times a second while the view moves (plan 03); the panels re-render only when something changed. */
function sameView(a: ViewInfo, b: ViewInfo): boolean {
  const boxA = a.selectionBox;
  const boxB = b.selectionBox;
  const sameBox = boxA === null || boxB === null
    ? boxA === boxB
    : boxA.l === boxB.l && boxA.t === boxB.t && boxA.r === boxB.r && boxA.b === boxB.b;
  return a.yaw === b.yaw && a.zoomPct === b.zoomPct && a.pxPerM === b.pxPerM && a.moving === b.moving
    && sameBox
    && a.groundCorners.length === b.groundCorners.length
    && a.groundCorners.every(([x, y], index) => x === b.groundCorners[index][0] && y === b.groundCorners[index][1]);
}

/** A key pressed in a box being typed in is the box's, never a shortcut. */
function isTyping(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable === true
    || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

export function SiteEditor(props: SiteEditorProps): ReactElement {
  const {
    initial, initialSelection, seasonId, seasonName, sunDate, sunEndDate = null, buildTasks, plotHref, seasonDateHref,
  } = props;
  const planId = initial.doc.plot.id;
  const { show } = useToast();
  /* Review I2: a save that reached an older build (a deploy replaced it)
     only a page refresh can get past. Until then what is unsaved is kept in
     this tab, and the page after the refresh replays it (`carried`). */
  const [staleBuild, setStaleBuild] = useState(false);
  const [carried] = useState(() => (typeof window === 'undefined' ? [] : readUnsaved(planId)));
  const store = useEditorStore({
    doc: initial.doc,
    version: initial.version,
    selection: initialSelection === null ? [] : [initialSelection],
    save: async (baseVersion, ops) => {
      try {
        return await saveSiteChangesAction(planId, baseVersion, ops);
      } catch (error) {
        if (!isStaleBuild(error)) throw error; // a dropped connection stays the queue's to say
        setStaleBuild(true);
        return { ok: false, reason: 'refused', error: SITE_UPDATED };
      }
    },
    /* The reload a conflict's or a refusal's answer starts meets the same
       stale build (#25 fix round, Important 3): said the same way, and the
       work kept the same way, instead of "the map could not be loaded"
       again and again with the question still up. */
    load: async () => {
      try {
        return await loadSiteDocAction(planId);
      } catch (error) {
        if (!isStaleBuild(error)) throw error; // the store says a failed load in its own words
        setStaleBuild(true);
        return { ok: false, error: SITE_UPDATED };
      }
    },
    pending: carried,
  });
  // Taken once: a later refresh must not replay the same edits again.
  useEffect(() => { forgetUnsaved(planId); }, [planId]);

  /* Review I3: while saving is stopped with edits unsent, an in-app link to
     another page would unmount the editor and drop them without a word — the
     browser asks before a full page leave (the store's beforeunload), but a
     client-side navigation never reaches it. So a link that leaves this
     editor asks first. One that keeps it mounted (the same page and season,
     a drawer opening) does not; nor a new tab, a download or another site. */
  const halted = store.save.pending > 0 && (store.save.status === 'error' || store.save.status === 'conflict');
  useEffect(() => {
    if (!halted) return;
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download')) return;
      if (link.target !== '' && link.target !== '_self') return;
      const here = new URL(window.location.href);
      const to = new URL(link.href, here);
      if (to.origin !== here.origin) return;
      /* No `season` in an address is this editor's own: the sidebar's link
         to this page carries none, the page's drawer links carry the id
         (#25 fix round, Important 5 — comparing the two asked "leave?"
         before opening a drawer). */
      const seasonOf = (url: URL) => url.searchParams.get('season') ?? seasonId;
      if (to.pathname === here.pathname && seasonOf(to) === seasonOf(here)) return;
      if (window.confirm(LEAVE_UNSAVED)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('click', onClick, true);
    return () => { document.removeEventListener('click', onClick, true); };
  }, [halted, seasonId]);
  // While the build is stale, what is unsaved is kept for the page after the refresh.
  useEffect(() => { if (staleBuild) keepUnsaved(planId, store.pendingOps()); });
  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);
  const wide = useSyncExternalStore(subscribeWide, readWide, serverYes);
  const webgl = useSyncExternalStore(subscribeNever, readWebgl, serverYes);
  /** The table is the view: a screen under 900 px, or a browser without WebGL. No map is shown. */
  const tableMode = !wide || !webgl;
  /* The table beside the editor's shell, for the stylesheet to show under
     900 px: drawn until the client knows the width, then only while narrow —
     a wide screen carries no hidden copy of it. */
  const hydrated = useSyncExternalStore(subscribeNever, clientYes, serverNo);
  const narrowTable = !hydrated || !wide;
  const [ui, setUi] = useState<EditorUi>(INITIAL_UI);
  const [view, setView] = useState<ViewInfo>(INITIAL_VIEW);
  const [keysOpen, setKeysOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [tab, setTab] = useState<SideTab>('library');
  /** The burn day a chip picked for shade by hour; null is the gate day. */
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  /* The stage's size, so the selection bar stays on it (`placeBar`). Null
     until measured, and where `ResizeObserver` is missing. */
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setStageSize((previous) => (previous?.width === width && previous.height === height ? previous : { width, height }));
    });
    observer.observe(stage);
    return () => { observer.disconnect(); };
  }, []);
  const reasonId = useId();
  const sceneRef = useRef<SceneHandle>(null);
  const flownToPeek = useRef(false);

  /* Ruling P6: an undo toast undoes only its own history entry. Every change
     to the history made from this editor — an edit from any panel, the keys
     or the scene, an undo, a redo, a reload — moves the mark on and takes the
     open undo toasts away, since their ביטול would now undo something else.
     `canUndo` is the store's, as of the last render, read when ביטול is
     pressed. All three are written only in handlers and effects. */
  const historyMark = useRef(0);
  const undoToasts = useRef(new Set<() => void>());
  const canUndo = useRef(store.canUndo);
  useEffect(() => { canUndo.current = store.canUndo; });
  useEffect(() => {
    const open = undoToasts.current;
    // A toast outliving this editor (a season switch) would undo into a map no longer shown.
    return () => { for (const dismiss of open) dismiss(); };
  }, []);

  /* The day the sun is worked out for: a real `YYYY-MM-DD` gate day or none
     (`readSunDate`, the one check of that shape). Everything below that needs
     a day — the scene, and the sun card — takes this, never `sunDate` itself. */
  const gateDay = readSunDate(sunDate);
  const fullUi = useMemo<EditorUi>(() => ({ ...ui, theme }), [ui, theme]);
  /* The sun is drawn only for a real day (spec §13): with no gate date the
     toggle opens the card's invitation, and the scene lights no sun. */
  const sceneUi = useMemo<EditorUi>(() => ({ ...fullUi, sun: fullUi.sun && gateDay !== null }), [fullUi, gateDay]);
  const vars = useMemo(() => paletteVars(theme), [theme]);

  /* The day shade by hour shows (SIM2): one of the burn's days, from the gate
     day to its last — the gate day alone while the last day is unknown
     (SIM3). A chip picks it; a picked day that is no longer one of the burn's
     (the opening date moved) gives way to the gate day. Derived, never
     guessed: no gate day, no day. */
  const lastDay = readSunDate(sunEndDate);
  const days = useMemo(() => burnDays(gateDay, lastDay), [gateDay, lastDay]);
  const sunDay = pickedDay !== null && days.includes(pickedDay) ? pickedDay : gateDay;

  /* Shade by hour (spec §11): the sun at the chosen hour of that day, over
     the camp's pin, counted with the map's north. Only for a day
     `readSunDate` accepted (`gateDay`, P15) — no day is no sun, never a guess. */
  const sun = ui.sun && sunDay !== null
    ? sunPosition(jerusalemInstant(sunDay, ui.hour), CAMP_SITE.latitude, CAMP_SITE.longitude)
    : null;
  const sunSummary = sun === null ? null : shadeAtHour(store.doc, sun);
  /* The day's shade, a sample a quarter hour, for the card's strip and its
     sentence: worked out once for each day and each map, and only while the
     card is open — never again for a new hour, so playback does not pay for
     it on every step. */
  const sunSamples = useMemo(
    () => (ui.sun && sunDay !== null ? shadeTimeline(store.doc, [sunDay], 15) : []),
    [ui.sun, sunDay, store.doc],
  );
  const hasNets = store.doc.items.some((item) => item.kind === 'shade');
  /* The tents by their minutes in shade (MST), over the map on screen: one
     function per map, so the card works the ranking out again only when the
     map, the days or the end hour change — never for a new hour. */
  const rankTents = useCallback(
    (dates: readonly string[], endHour: number) => shadeRanking(store.doc, dates, 15, { endHour }),
    [store.doc],
  );

  /* The item table's rows: the map being edited, with its flags worked out by
     `derive` — the rule the server uses — so the table shows what changed
     since the page loaded, not the page's own read. */
  const tableShown = narrowTable || !webgl;
  const tableRows = useMemo<SiteTableRow[]>(() => {
    if (!tableShown) return [];
    const titles = new Map(buildTasks.map((task) => [task.id, task.title]));
    return derive(store.doc.plot, store.doc.items).items.map((item) => ({
      ...item,
      taskTitle: item.taskId === null ? null : titles.get(item.taskId) ?? null,
    }));
  }, [tableShown, store.doc, buildTasks]);
  /* The pipes and cables under them, the same way: their ends' names and
     their length as the map now stands (`lines.ts`), not as the page read it. */
  const lineRows = useMemo<SiteLinesTableRow[]>(() => {
    if (!tableShown) return [];
    const labelOf = (id: string) => findItem(store.doc, id)?.label ?? '';
    return store.doc.lines.map((line) => ({
      id: line.id, kind: line.kind, label: line.label,
      fromLabel: labelOf(line.fromId), toLabel: labelOf(line.toId),
      lengthCm: lineLengthCm(store.doc, line), pointsCm: line.points,
    }));
  }, [tableShown, store.doc]);

  /* A newer map from the server — the plot drawer's save bumps the version
     (`setPlot`) and refreshes the page. The store keeps its first `init`
     (§6.1), so the editor takes the newer map itself: with nothing waiting
     to be saved, through 'mine' — the server's map, with anything the lead
     does while it loads replayed on top under the same lock and
     missing-item checks (hotfix H1; 'theirs' emptied the queue and lost
     those edits). With edits already waiting, by asking, as a conflict does.
     While a batch is in flight its answer decides. Never by remounting,
     which would drop unsaved edits. While the editor takes the map up it
     asks nothing: an edit made meanwhile is kept, not a question. */
  const serverAhead = initial.version > store.save.version && store.save.status !== 'saving';
  const plotMovedUnderEdits = serverAhead && store.save.pending > 0 && !resolving;
  const takingUp = useRef<number | null>(null);
  useEffect(() => {
    if (!serverAhead || store.save.pending > 0 || takingUp.current === initial.version) return;
    takingUp.current = initial.version;
    void resolve('mine');
  });

  const onView = useCallback((info: ViewInfo) => {
    setView((previous) => (sameView(previous, info) ? previous : info));
    // The first report means the scene is up: fly to the item a deep link named.
    if (!flownToPeek.current) {
      flownToPeek.current = true;
      if (initialSelection !== null) sceneRef.current?.fitIds([initialSelection]);
    }
  }, [initialSelection]);

  const onNotice = useCallback((message: string) => {
    show({ message, tone: 'bad' });
  }, [show]);

  function patchUi(patch: Partial<EditorUi>): void {
    setUi((current) => ({ ...current, ...patch }));
    // A hidden net cannot stay selected: nobody could see it being moved.
    if (patch.netsHidden === true) {
      store.select(store.selection.filter((id) => findItem(store.doc, id)?.kind !== 'shade'));
    }
  }

  // ── edits ─────────────────────────────────────────────────────────────
  /** The selected items that still exist — an undo can take one away. */
  function selected(): EditorItem[] {
    return store.selection
      .map((id) => findItem(store.doc, id))
      .filter((item): item is EditorItem => item !== undefined);
  }

  /** The selected pipes and cables that still exist. */
  function selectedLines(): EditorLine[] {
    return store.selection
      .map((id) => findLine(store.doc, id))
      .filter((line): line is EditorLine => line !== undefined);
  }

  function historyMoved(): void {
    historyMark.current += 1;
    for (const dismiss of undoToasts.current) dismiss();
    undoToasts.current.clear();
  }

  /**
   * The one door every edit goes through — the panels, the keys, the
   * inspector's typed values and the scene's drags alike — so no edit can
   * leave an older undo toast standing (P6). True when the store recorded a
   * step: the ops meet the map as it is now, which can be newer than the one
   * they were built from, so an edit says what it did only when it did.
   */
  function runEdit(label: string, ops: SiteOp[], selection?: string[]): boolean {
    if (ops.length === 0) {
      if (selection !== undefined) store.select(selection);
      return false;
    }
    historyMoved();
    return store.run(label, ops, selection);
  }

  function undo(): void {
    historyMoved();
    store.undo();
  }

  function redo(): void {
    historyMoved();
    store.redo();
  }

  /**
   * What an edit that can be taken back says (spec §8, §10): a toast whose
   * ביטול undoes this edit's own history entry and nothing else (P6). It
   * keeps the mark its edit left; while that mark is still the latest and the
   * store has an entry to take back, the entry on top is this edit's. A
   * newer edit takes the toast away, so a stale ביטול is only reachable in a
   * race — and then it says so rather than undoing someone else's entry.
   */
  function saidWithUndo(message: string): void {
    const mark = historyMark.current;
    const dismiss = show({
      message,
      tone: 'ok',
      undo: {
        label: 'ביטול',
        run: async () => {
          if (historyMark.current !== mark || !canUndo.current) return { ok: false, error: STALE_UNDO };
          undo();
          return { ok: true };
        },
      },
    });
    undoToasts.current.add(dismiss);
  }

  /** Everything asked about is locked: nothing moved, and the lead is told why (§8, P14). */
  function lockedNotice(count: number): void {
    show({ message: count === 1 ? LOCKED_NOTICE : LOCKED_ALL_NOTICE, tone: 'bad' });
  }

  /**
   * No confirmation (§8): it goes, and the toast offers it back. Locked items
   * stay, and are counted. A selected pipe or cable goes too, and an item
   * takes its own lines with it (`removeOps`), each once.
   */
  function removeSelection(): void {
    const items = selected();
    const lines = selectedLines();
    if (items.length === 0 && lines.length === 0) return;
    const itemOps = removeOps(store.doc, store.selection);
    const withItems = new Set(itemOps.flatMap((op) => (op.type === 'removeLine' ? [op.id] : [])));
    const lineOps = removeLineOps(store.doc, lines.map((line) => line.id)).filter((op) => op.type !== 'removeLine' || !withItems.has(op.id));
    const ops = [...lineOps, ...itemOps];
    if (ops.length === 0) {
      lockedNotice(items.length);
      return;
    }
    const gone = new Set(ops.flatMap((op) => (op.type === 'remove' ? [op.id] : [])));
    const goneLines = ops.filter((op) => op.type === 'removeLine').length;
    const kept = items.filter((item) => !gone.has(item.id));
    if (!runEdit('הסרה', ops, kept.map((item) => item.id))) return;
    if (gone.size === 0) {
      saidWithUndo(goneLines === 1 ? `הקו ${isolate(lines[0].label)} הוסר מהמפה` : `${goneLines} קווים הוסרו מהמפה`);
      return;
    }
    const first = items.find((item) => gone.has(item.id));
    const said = gone.size === 1 && first !== undefined
      ? `הפריט ${isolate(first.label)} הוסר מהמפה`
      : `${gone.size} פריטים הוסרו מהמפה`;
    const stayed = kept.length === 0 ? ''
      : kept.length === 1 ? '. פריט נעול אחד נשאר במקומו'
        : `. ${kept.length} פריטים נעולים נשארו במקומם`;
    const wires = goneLines === 0 ? '' : goneLines === 1 ? ', עם הקו שהיה מחובר אליו' : `, עם ${goneLines} הקווים שהיו מחוברים`;
    saidWithUndo(`${said}${wires}${stayed}`);
  }

  /** A new pipe or cable between two items (`lines.ts`), selected once it lands so its panel opens. */
  function addLine(kind: SiteLineKind, fromId: string, toId: string): void {
    const id = crypto.randomUUID();
    const ops = addLineOps(store.doc, kind, fromId, toId, id);
    const added = ops.find((op): op is Extract<SiteOp, { type: 'addLine' }> => op.type === 'addLine');
    if (added === undefined) {
      // The panel offers only ends the rules allow, so this is a race with another lead's edit, not a mistake.
      show({ message: `אי אפשר לחבר את שני הפריטים האלה ב${LINE_KINDS[kind].label}. אולי אחד מהם השתנה בינתיים.`, tone: 'bad' });
      return;
    }
    if (!runEdit(`הוספת ${LINE_KINDS[kind].label}`, ops, [id])) return;
    // Behind a fixed noun, as a removed line is said: no verb agrees with a name.
    saidWithUndo(`הקו ${isolate(added.line.label)} נוסף למפה`);
  }

  /** A splitter fed from `fromId`, with a run to each of `toIds` (`splitOps`); the splitter is selected so it can be dragged at once. */
  function splitTo(kind: SiteLineKind, fromId: string, toIds: string[]): void {
    const ids = { splitter: crypto.randomUUID(), lines: [...toIds, fromId].map(() => crypto.randomUUID()) };
    const { ops, splitterId } = splitOps(store.doc, kind, fromId, toIds, ids);
    if (splitterId === null) {
      show({ message: 'אי אפשר לפצל כאן: אין במגרש משבצת פנויה למפצל, או שאחד הפריטים השתנה בינתיים.', tone: 'bad' });
      return;
    }
    runEdit('חיבור דרך מפצל', ops, [splitterId]);
    saidWithUndo(`נוסף מפצל עם ${toIds.length + 1} ${LINE_KINDS[kind].plural}`);
  }

  function duplicateSelection(): void {
    const items = selected();
    const { ops, ids } = duplicateOps(store.doc, store.selection, () => crypto.randomUUID());
    if (ops.length === 0) return;
    if (!runEdit('שכפול', ops, ids)) return;
    saidWithUndo(items.length === 1 ? `נוצר עותק של ${isolate(items[0].label)}` : `נוצרו ${ids.length} עותקים`);
  }

  /** A square turns into itself (no ops); only an all-locked selection is told it is locked. */
  function turnSelection(): void {
    const items = selected();
    const ops = turnOps(store.doc, store.selection);
    if (ops.length === 0) {
      if (items.length > 0 && items.every((item) => item.locked)) lockedNotice(items.length);
      return;
    }
    runEdit('סיבוב', ops);
  }

  function toggleLock(): void {
    const items = selected();
    if (items.length === 0) return;
    const locking = !items.every((item) => item.locked);
    const ops = lockOps(store.doc, store.selection, locking);
    if (ops.length === 0) return;
    if (!runEdit(locking ? 'נעילה' : 'שחרור נעילה', ops)) return;
    /* Ruling P12: the toast counts what changed — an item already locked (or
       already free) is not in `ops`, so it is neither counted nor named. */
    const only = ops.length === 1 && ops[0].type === 'update' ? findItem(store.doc, ops[0].id) : undefined;
    const one = only === undefined ? null : only.label;
    saidWithUndo(locking
      ? (one === null ? `${ops.length} פריטים ננעלו` : `הפריט ${isolate(one)} ננעל`)
      : (one === null ? `הנעילה של ${ops.length} פריטים שוחררה` : `הנעילה של ${isolate(one)} שוחררה`));
  }

  /** Arrows follow the screen, so "up" is away from the viewer however the view is turned (§8). */
  function nudge(arrow: Arrow, big: boolean): void {
    const items = selected();
    if (items.length === 0) return;
    const [ux, uy] = screenArrowToMap(view.yaw, arrow);
    const step = big ? 100 : store.doc.plot.gridCm;
    const ops = moveOps(store.doc, store.selection, Math.round(ux * step), Math.round(uy * step));
    if (ops.length === 0) {
      if (items.every((item) => item.locked)) lockedNotice(items.length);
      return;
    }
    runEdit('הזזה', ops);
  }

  /** A new item of `kind` with its north-west corner at `at`, selected once it lands. */
  function addAt(kind: SiteItemKind, at: { xCm: number; yCm: number }): void {
    const id = crypto.randomUUID();
    const ops = addOps(store.doc, kind, at, id);
    const added = ops.find((op): op is Extract<SiteOp, { type: 'add' }> => op.type === 'add');
    if (added === undefined) return;
    // The new item is selected, so its group — or the nets — is shown first (G2).
    revealFor([kind]);
    // Through a fixed noun: "הוספת" + the kind's name would read "הוספת אחר" for the kind אחר.
    if (!runEdit(`הוספת פריט מסוג ${SITE_KINDS[kind].label}`, ops, [id])) return;
    saidWithUndo(`הפריט ${isolate(added.item.label)} נוסף למפה`);
  }
  // ── end of edits ──────────────────────────────────────────────────────

  /** Over the scene itself, and not over a panel floating on it (`data-panel`). */
  function overScene(clientX: number, clientY: number): boolean {
    const hit = document.elementFromPoint(clientX, clientY);
    return hit !== null && stageRef.current !== null && stageRef.current.contains(hit)
      && hit.closest('[data-panel]') === null;
  }

  /** Where a kind dragged to this point lands: centred on the pointer, on the grid unless snapping is off. */
  function placeAt(kind: SiteItemKind, clientX: number, clientY: number): { xCm: number; yCm: number } | null {
    if (!overScene(clientX, clientY)) return null;
    const ground = sceneRef.current?.groundAtClient(clientX, clientY) ?? null;
    if (ground === null) return null;
    const size = effectiveSize(kind, store.doc.defaults);
    const step = ui.snap ? store.doc.plot.gridCm : 0;
    return { xCm: snap(ground[0] - size.widthCm / 2, step), yCm: snap(ground[1] - size.depthCm / 2, step) };
  }

  function dragKind(kind: SiteItemKind, clientX: number, clientY: number): void {
    const at = placeAt(kind, clientX, clientY);
    sceneRef.current?.setGhost(at === null ? null : { kind, ...at });
  }

  function dropKind(kind: SiteItemKind, clientX: number, clientY: number): void {
    sceneRef.current?.setGhost(null);
    const at = placeAt(kind, clientX, clientY);
    if (at !== null) addAt(kind, at);
  }

  /** A click in the library: the free spot nearest the middle of the view (§8). None free: say so, add nothing. */
  function activateKind(kind: SiteItemKind): void {
    const size = effectiveSize(kind, store.doc.defaults);
    const centre = sceneRef.current?.centreGround() ?? null;
    const near = centre === null
      ? { xCm: store.doc.plot.widthCm / 2, yCm: store.doc.plot.depthCm / 2 }
      : { xCm: centre[0], yCm: centre[1] };
    const spot = nearestFreeSpot(store.doc, kind, size, near);
    if (spot === null) {
      show({
        // Through a fixed noun: "ל" + the kind's name would read "לאחר" for the kind אחר.
        message: `אין במגרש מקום פנוי לפריט מסוג ${SITE_KINDS[kind].label} במידות ${formatSize(size.widthCm, size.depthCm)}.`,
        tone: 'bad',
      });
      return;
    }
    addAt(kind, spot);
  }

  /**
   * A hidden item is never selected — the rule `patchUi` keeps for the nets
   * (ruling G2). Anything about to select items of these kinds shows their
   * group, or the nets, first — an item just added included, which is not in
   * the map yet when this runs.
   */
  function revealFor(kinds: readonly SiteItemKind[]): void {
    const groups = new Set(kinds.map((kind) => SITE_KINDS[kind].group));
    const patch: Partial<EditorUi> = {};
    if (ui.hiddenGroups.some((group) => groups.has(group))) {
      patch.hiddenGroups = ui.hiddenGroups.filter((group) => !groups.has(group));
    }
    if (ui.netsHidden && kinds.includes('shade')) patch.netsHidden = false;
    if (patch.hiddenGroups !== undefined || patch.netsHidden !== undefined) patchUi(patch);
  }

  /** `revealFor` the kinds of these items. */
  function revealIds(ids: readonly string[]): void {
    revealFor(ids
      .map((id) => findItem(store.doc, id)?.kind)
      .filter((kind): kind is SiteItemKind => kind !== undefined));
  }

  /**
   * The one way a figure or a problem selects the items it names (§13):
   * shown first (G2), then selected and flown to. The list's group counts,
   * the inspectors and the checks bar all come through here, so no path can
   * select a hidden item. An empty list clears the selection.
   */
  function pickIds(ids: string[]): void {
    revealIds(ids);
    store.select(ids);
    if (ids.length > 0) sceneRef.current?.fitIds(ids);
  }

  /**
   * A row in the list: selects its item and flies to it; shift or ⌘ adds it
   * to the selection instead, or takes it out when it is already in. An item
   * about to be selected is shown first.
   */
  function pickRow(id: string, additive: boolean): void {
    if (additive && store.selection.includes(id)) {
      store.select(store.selection.filter((other) => other !== id));
      return;
    }
    if (additive) {
      revealIds([id]);
      store.select([...store.selection, id]);
      return;
    }
    pickIds([id]);
  }

  /** A hidden group cannot stay selected, for the same reason a hidden net cannot. */
  function toggleGroup(group: SiteKindGroup): void {
    const hiding = !ui.hiddenGroups.includes(group);
    patchUi({
      hiddenGroups: hiding ? [...ui.hiddenGroups, group] : ui.hiddenGroups.filter((other) => other !== group),
    });
    if (hiding) {
      store.select(store.selection.filter((id) => {
        const item = findItem(store.doc, id);
        return item !== undefined && SITE_KINDS[item.kind].group !== group;
      }));
    }
  }

  function fit(): void {
    if (store.selection.length > 0) sceneRef.current?.fitIds(store.selection);
    else sceneRef.current?.fitAll();
  }

  /** ⌘A: everything that can be seen, but the nets — a net under the lounge is not something to drag with it. */
  function selectAll(): void {
    store.select(store.doc.items
      .filter((item) => item.kind !== 'shade' && !ui.hiddenGroups.includes(SITE_KINDS[item.kind].group))
      .map((item) => item.id));
  }

  /**
   * One of three states (§10): the plot, one item, several items. Every
   * figure in them that names items selects through `pickIds` — shown first,
   * then selected and flown to.
   */
  function renderInspector(): ReactElement {
    const items = selected();
    const lines = selectedLines();
    if (items.length === 0 && lines.length > 0) {
      // Only remove applies to a line: it is turned, copied and locked through its ends.
      const removal = (
        <span className={actionStyles.pushEnd}>
          <Button size="sm" tone="danger" onClick={removeSelection}>
            <Icon name="trash" size={14} />
            הסרה
          </Button>
        </span>
      );
      if (lines.length === 1) {
        return <LineInspector key={lines[0].id} doc={store.doc} line={lines[0]} onRun={runEdit} onPickIds={pickIds} footer={removal} />;
      }
      return <LinesInspector doc={store.doc} lines={lines} onPickIds={pickIds} footer={removal} />;
    }
    if (items.length === 0) {
      return <PlotInspector doc={store.doc} flags={store.flags} plotHref={plotHref} onPickIds={pickIds} />;
    }
    const actions = (
      <SelectionActions
        labelled
        locked={items.every((item) => item.locked)}
        onTurn={turnSelection}
        onDuplicate={duplicateSelection}
        onLock={toggleLock}
        onRemove={removeSelection}
      />
    );
    if (items.length === 1) {
      return (
        <ItemInspector
          key={items[0].id}
          doc={store.doc}
          item={items[0]}
          flags={store.flags}
          buildTasks={props.buildTasks}
          onRun={runEdit}
          onPickIds={pickIds}
          onAddLine={addLine}
          onSplit={splitTo}
          footer={actions}
        />
      );
    }
    return (
      <MultiInspector
        /* Keyed by the kinds, not the ids: a marquee taking in one more tent
           keeps the panel — and what is half-typed in it (review minor). */
        key={[...new Set(items.map((item) => item.kind))].sort().join(' ')}
        doc={store.doc}
        ids={items.map((item) => item.id)}
        onRun={runEdit}
        onPickIds={pickIds}
        onClear={() => { store.select([]); }}
        footer={actions}
      />
    );
  }

  /** "ייצוא תמונה" (spec §10): the current view as a PNG, named for the season and the day. */
  async function exportPicture(): Promise<void> {
    const blob = await (sceneRef.current?.exportPng() ?? Promise.resolve(null));
    if (blob === null) {
      show({ message: EXPORT_FAILED, tone: 'bad' });
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `מפת הקאמפ ${seasonName} ${todayInIsrael()}.png`;
    // On the page for the click — a detached link's click is ignored by some browsers — and off it after.
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); }, REVOKE_AFTER_MS);
    show({ message: EXPORTED, tone: 'ok' });
  }

  function runShortcut(shortcut: Shortcut): void {
    if (typeof shortcut === 'object') {
      nudge(shortcut.arrow, shortcut.big);
      return;
    }
    switch (shortcut) {
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'duplicate': duplicateSelection(); break;
      case 'selectAll': selectAll(); break;
      case 'escape':
        if (keysOpen) {
          setKeysOpen(false);
        } else {
          store.select([]);
          patchUi({ tool: 'select' });
        }
        break;
      case 'remove': removeSelection(); break;
      case 'turn': turnSelection(); break;
      case 'lock': toggleLock(); break;
      case 'toolSelect': patchUi({ tool: 'select' }); break;
      case 'toolMeasure': patchUi({ tool: 'measure' }); break;
      case 'fit': fit(); break;
      case 'plan': patchUi({ mode: 'plan' }); break;
      case '3d': patchUi({ mode: '3d' }); break;
      case 'viewLeft': sceneRef.current?.rotateView(-1); break;
      case 'viewRight': sceneRef.current?.rotateView(1); break;
      case 'zoomIn': sceneRef.current?.zoomBy(ZOOM_IN); break;
      case 'zoomOut': sceneRef.current?.zoomBy(1 / ZOOM_IN); break;
      case 'keys': setKeysOpen((open) => !open); break;
    }
  }

  /**
   * On the editor's root, so a key reaches it from the scene and from every
   * panel (§8). The one gate every shortcut passes: a key typed into a box —
   * a size, a name, the hour slider — is the box's, never the map's. While
   * the table is the view no key is the map's either (ruling P7): nothing
   * acts on a map that is not shown.
   */
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (tableMode || event.defaultPrevented || isTyping(event.target)) return;
    const shortcut = shortcutFor(event);
    if (shortcut === null) return;
    event.preventDefault();
    runShortcut(shortcut);
  }

  async function resolve(choice: 'theirs' | 'mine'): Promise<void> {
    setResolving(true);
    try {
      await store.resolveConflict(choice);
    } finally {
      /* After the await, not before (hotfix H1): the map was replaced under
         every history entry — those made while it loaded too — so no undo
         toast may outlive the reload (P6). */
      historyMoved();
      setResolving(false);
    }
  }

  /* When a save stops, the lead is told why, in Hebrew, beside the top bar's
     retry. Only a refused batch (`errorKind: 'refused'`) also offers the
     reload; a lost connection never does (ruling P8): a reload would throw
     away what was done offline. */
  const saveError = store.save.status === 'error' ? store.save.error : null;
  const refused = store.save.errorKind === 'refused';
  /** The selected items that still exist, once per render for the selection bar. */
  const selectedNow = selected();
  /* The scene's drags and resizes are edits too: through the same door, so
     they take an older undo toast away like any other edit (P6). The store
     is a new object every render anyway; the scene reads it fresh each time. */
  const sceneStore: typeof store = { ...store, run: runEdit };

  const scene = (
    <SceneView
      ref={sceneRef}
      store={sceneStore}
      ui={sceneUi}
      insets={INSETS}
      sunDate={sunDay}
      onView={onView}
      onNotice={onNotice}
    />
  );

  /* What the save asks of the lead. Above the view, whichever it is: a
     conflict or a refused save must be answerable on a laptop narrowed
     mid-session and in a browser without WebGL, where the editor's own shell
     is hidden or never drawn. */
  const refresh = () => {
    // The work is kept for the next page first; then the browser's own warning has nothing to protect.
    keepUnsaved(planId, store.pendingOps());
    store.allowUnload();
    window.location.reload();
  };

  const banners = staleBuild ? (
    /* A deploy replaced this page's build (review I2; the load too, #25 fix
       round, Important 3): every answer the other banners offer calls the
       same missing server actions. One way out, with the work kept for it. */
    <>
      <SaveErrorBanner id={reasonId} message={SITE_UPDATED} busy={false} onRefresh={refresh} />
      {store.notice === null || store.notice === SITE_UPDATED ? null : (
        <div className={styles.banner} role="status">
          <p className={styles.bannerText}>{store.notice}</p>
          <Button size="sm" tone="ghost" onClick={() => { store.dismissNotice(); }}>הבנתי</Button>
        </div>
      )}
    </>
  ) : (
    <>
      {store.conflict === null && !plotMovedUnderEdits ? null : (
        <ConflictBanner
          busy={resolving}
          onTheirs={() => { void resolve('theirs'); }}
          onMine={() => { void resolve('mine'); }}
          /* A newer map the page itself handed down is the lead's own plot
             save (the drawer refreshes the page) — not a change "from
             elsewhere", which only the save queue's conflict can report. */
          message={store.conflict === null ? PLOT_SAVED_UNDER_EDITS : undefined}
        />
      )}
      {saveError === null ? null : (
        <SaveErrorBanner
          id={reasonId}
          message={saveError}
          busy={resolving}
          onReload={refused ? () => { void resolve('theirs'); } : undefined}
          onMine={refused ? () => { void resolve('mine'); } : undefined}
        />
      )}
      {store.notice === null ? null : (
        <div className={styles.banner} role="status">
          <p className={styles.bannerText}>{store.notice}</p>
          <Button size="sm" tone="ghost" onClick={() => { store.dismissNotice(); }}>הבנתי</Button>
        </div>
      )}
    </>
  );

  /** The item table, where the map is not shown: what it cannot do here first, then the map as it is being edited. */
  const tableView = (needs: string | null) => (
    <>
      <p className={styles.tableNote}>
        {needs === null ? null : <>{needs}{' '}</>}
        כאן אפשר לקרוא את הפריטים ולשנות את <Link href={plotHref}>הגדרות המגרש</Link>.
      </p>
      <SiteTable
        items={tableRows}
        season={seasonId}
        empty={<EmptyState kind="nothing-this-season" noun="פריטים במפה" seasonName={seasonName} />}
      />
      {/* The pipes and cables under the items, with their metres — nothing when there are none yet. */}
      <SiteLinesTable lines={lineRows} />
    </>
  );

  const editor = (
    <div className={styles.editorArea}>
      <Toolbar
        ui={fullUi}
        onUi={patchUi}
        canUndo={store.canUndo}
        canRedo={store.canRedo}
        onUndo={undo}
        onRedo={redo}
      />
      <section className={styles.stage} aria-label="מפת הקאמפ" tabIndex={-1} ref={stageRef}>
        {wide ? <div className={styles.scene}>{scene}</div> : null}
        <SidePanel
          tab={tab}
          onTab={setTab}
          count={store.doc.items.length}
          library={(
            <LibraryPanel
              defaults={store.doc.defaults}
              onActivate={activateKind}
              onDragMove={dragKind}
              onDrop={dropKind}
              onDragCancel={() => { sceneRef.current?.setGhost(null); }}
            />
          )}
          objects={(
            <ObjectsPanel
              items={store.doc.items}
              lines={store.doc.lines.map((line) => ({ id: line.id, kind: line.kind, label: line.label, lengthCm: lineLengthCm(store.doc, line) }))}
              selection={store.selection}
              flags={store.flags}
              hiddenGroups={ui.hiddenGroups}
              netsHidden={ui.netsHidden}
              onPick={pickRow}
              onPickIds={pickIds}
              onToggleGroup={toggleGroup}
              onShowLibrary={() => { setTab('library'); }}
            />
          )}
        />
        <section className={cx(chrome.panel, inspectorStyles.inspector)} aria-label="מאפיינים" data-panel="true">
          {renderInspector()}
        </section>
        <ChecksBar doc={store.doc} flags={store.flags} onGo={pickIds} />
        <Minimap
          doc={store.doc}
          flags={store.flags}
          selection={store.selection}
          info={view}
          onJump={(xCm, yCm) => { sceneRef.current?.jumpTo(xCm, yCm); }}
        />
        <ViewControls
          info={view}
          northDeg={store.doc.plot.northDeg}
          keysOpen={keysOpen}
          onZoom={(factor) => { sceneRef.current?.zoomBy(factor); }}
          onFit={fit}
          onRotate={(dir) => { sceneRef.current?.rotateView(dir); }}
          onNorth={() => { sceneRef.current?.northUp(); }}
          onKeys={() => { setKeysOpen((open) => !open); }}
        />
        <SelectionBar
          box={view.moving || selectedNow.length === 0 ? null : view.selectionBox}
          stage={stageSize}
          locked={selectedNow.length > 0 && selectedNow.every((item) => item.locked)}
          onTurn={turnSelection}
          onDuplicate={duplicateSelection}
          onLock={toggleLock}
          onRemove={removeSelection}
        />
        <div className={styles.cards}>
          {ui.sun ? (
            <SunCard
              hour={ui.hour}
              onHour={(hour) => { patchUi({ hour }); }}
              summary={sunSummary}
              northDeg={store.doc.plot.northDeg}
              plotHref={plotHref}
              dateHref={seasonDateHref}
              sunDate={gateDay}
              endDay={lastDay}
              day={sunDay}
              onDay={setPickedDay}
              samples={sunSamples}
              hasNets={hasNets}
              onPickNets={() => {
                pickIds(store.doc.items.filter((item) => item.kind === 'shade').map((item) => item.id));
              }}
              rankTents={rankTents}
              onPickIds={pickIds}
            />
          ) : null}
          {keysOpen ? <ShortcutsCard onClose={() => { setKeysOpen(false); }} /> : null}
        </div>
        {/* floating panels, over the scene */}
      </section>
    </div>
  );

  return (
    <div className={styles.root} style={vars} onKeyDown={onKeyDown}>
      <TopBar
        crumbs={[{ label: 'מפת הקאמפ' }]}
        chip={<SeasonChip seasonName={seasonName} />}
        actions={(
          <>
            <SaveStatus
              snapshot={store.save}
              busy={resolving}
              reasonId={saveError === null ? undefined : reasonId}
              onRetry={staleBuild ? undefined : () => { store.retrySave(); }}
            />
            {/* No canvas, no picture: not in table mode, and — before the
                client has asked the width — not under 900 px either. */}
            {tableMode ? null : (
              <span className={styles.wideOnly}>
                <Button size="sm" onClick={() => { void exportPicture(); }}>
                  <Icon name="download" size={14} />
                  ייצוא תמונה
                </Button>
              </span>
            )}
            <ButtonLink size="sm" href={plotHref}>
              <Icon name="grid" size={14} />
              הגדרות המגרש
            </ButtonLink>
          </>
        )}
      />
      {banners}
      {webgl ? (
        <>
          {editor}
          {/* Hidden by the stylesheet on a wide screen; the view under 900 px. */}
          {narrowTable ? <div className={styles.narrowView}>{tableView(NARROW_NEEDS)}</div> : null}
        </>
      ) : (
        <div className={styles.fallback}>
          {/* Where the map would be: the scene says, in its own words, that it
              needs WebGL. Not under 900 px, where the table is the view anyway. */}
          {wide ? <div className={styles.noScene}>{scene}</div> : null}
          {tableView(wide ? null : NARROW_NO_WEBGL_NEEDS)}
        </div>
      )}
    </div>
  );
}
