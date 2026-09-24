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
import {
  useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type RefAttributes,
} from 'react';
import { SeasonChip, TopBar } from '@/components/shell/top-bar';
import { Button, ButtonLink } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toaster';
import type { SiteItemKind } from '@/db/schema/site';
import { effectiveSize } from '@/lib/site/defaults';
import { formatSize, snap } from '@/lib/site/geometry';
import { nearestFreeSpot } from '@/lib/site/editor/placement';
import { KIND_GROUP_ORDER, SITE_KINDS, type SiteKindGroup } from '@/lib/site/kinds';
import { findItem, type EditorDoc, type EditorItem } from '@/lib/site/editor/model';
import type { SiteOp } from '@/lib/site/editor/ops';
import { addOps, duplicateOps, lockOps, moveOps, removeOps, turnOps } from '@/lib/site/editor/commands';
import { screenArrowToMap } from '@/lib/site/editor/camera';
import { CAMP_SITE, jerusalemInstant, shadeAtHour, sunPosition } from '@/lib/site/editor/sun';
import { shadeTimeline } from '@/lib/site/editor/shade-timeline';
import { burnDays, readSunDate } from '@/lib/site/views';
import { loadSiteDocAction, saveSiteChangesAction } from '../actions';
import { useEditorStore } from './use-editor-store';
import { SCENE_PALETTE, type SceneTheme } from './scene/palette';
import type { EditorUi, Insets, SceneHandle, SceneViewProps, ViewInfo } from './scene/scene-view';
import { shortcutFor, ZOOM_IN, type Arrow, type Shortcut } from './keyboard';
import { LOCKED_ALL_NOTICE, LOCKED_NOTICE } from './notices';
import { Toolbar } from './panels/toolbar';
import { ConflictBanner, SaveErrorBanner, SaveStatus } from './panels/save-status';
import { LibraryPanel } from './panels/library-panel';
import { ObjectsPanel } from './panels/objects-panel';
import { SidePanel, type SideTab } from './panels/side-panel';
import { PlotInspector } from './panels/inspector-plot';
import { ItemInspector } from './panels/inspector-item';
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
import styles from './editor.module.css';

const SceneView = dynamic<SceneViewProps & RefAttributes<SceneHandle>>(
  () => import('./scene/scene-view').then((loaded) => loaded.SceneView),
  { ssr: false },
);

export interface SiteEditorProps {
  initial: { doc: EditorDoc; version: number };
  /** `?peek=<id>`: selected when the map loads (spec §12). The page has checked it is on this map. */
  initialSelection: string | null;
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

/** An undo toast pressed after a newer edit (a race: a newer edit takes the toast away). */
const STALE_UNDO = 'הפעולה הזו כבר לא האחרונה, ולכן לא בוטלה מכאן.';

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

/** The scene's group colours, handed to every panel as custom properties. */
function paletteVars(theme: SceneTheme): CSSProperties {
  const palette = SCENE_PALETTE[theme];
  const vars: Record<string, string> = {
    '--scene-plot': palette.plot,
    '--scene-outside': palette.outside,
    '--scene-fence': palette.fence,
  };
  for (const group of KIND_GROUP_ORDER) vars[`--group-${group}`] = palette.groups[group];
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
  const { initial, initialSelection, seasonName, sunDate, sunEndDate = null, plotHref, seasonDateHref } = props;
  const planId = initial.doc.plot.id;
  const { show } = useToast();
  const store = useEditorStore({
    doc: initial.doc,
    version: initial.version,
    selection: initialSelection === null ? [] : [initialSelection],
    save: (baseVersion, ops) => saveSiteChangesAction(planId, baseVersion, ops),
    load: () => loadSiteDocAction(planId),
  });
  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);
  const [ui, setUi] = useState<EditorUi>(INITIAL_UI);
  const [view, setView] = useState<ViewInfo>(INITIAL_VIEW);
  const [keysOpen, setKeysOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [tab, setTab] = useState<SideTab>('library');
  /** The burn day a chip picked for shade by hour; null is the gate day. */
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const stageRef = useRef<HTMLElement>(null);
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
  const burnEnd = readSunDate(sunEndDate);
  const days = useMemo(() => burnDays(gateDay, burnEnd), [gateDay, burnEnd]);
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

  /* A newer map from the server — the plot drawer's save bumps the version
     (`setPlot`) and refreshes the page. The store keeps its first `init`
     (§6.1), so the editor takes the newer map itself: with nothing waiting
     to be saved, by the reload a conflict offers; with edits waiting, by
     asking, as a conflict does. While a batch is in flight its answer
     decides. Never by remounting, which would drop unsaved edits. */
  const serverAhead = initial.version > store.save.version && store.save.status !== 'saving';
  const plotMovedUnderEdits = serverAhead && store.save.pending > 0;
  const takingUp = useRef<number | null>(null);
  useEffect(() => {
    if (!serverAhead || store.save.pending > 0 || takingUp.current === initial.version) return;
    takingUp.current = initial.version;
    historyMoved(); // the reload clears the history: no undo toast may outlive it (P6)
    void store.resolveConflict('theirs');
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

  function historyMoved(): void {
    historyMark.current += 1;
    for (const dismiss of undoToasts.current) dismiss();
    undoToasts.current.clear();
  }

  /**
   * The one door every edit goes through — the panels, the keys, the
   * inspector's typed values and the scene's drags alike — so no edit can
   * leave an older undo toast standing (P6).
   */
  function runEdit(label: string, ops: SiteOp[], selection?: string[]): void {
    if (ops.length === 0) {
      if (selection !== undefined) store.select(selection);
      return;
    }
    historyMoved();
    store.run(label, ops, selection);
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

  /** No confirmation (§8): it goes, and the toast offers it back. Locked items stay, and are counted. */
  function removeSelection(): void {
    const items = selected();
    if (items.length === 0) return;
    const ops = removeOps(store.doc, store.selection);
    if (ops.length === 0) {
      lockedNotice(items.length);
      return;
    }
    const gone = new Set(ops.flatMap((op) => (op.type === 'remove' ? [op.id] : [])));
    const kept = items.filter((item) => !gone.has(item.id));
    runEdit('הסרה', ops, kept.map((item) => item.id));
    const first = items.find((item) => gone.has(item.id));
    const said = gone.size === 1 && first !== undefined
      ? `הפריט ${first.label} הוסר מהמפה`
      : `${gone.size} פריטים הוסרו מהמפה`;
    const stayed = kept.length === 0 ? ''
      : kept.length === 1 ? '. פריט נעול אחד נשאר במקומו'
        : `. ${kept.length} פריטים נעולים נשארו במקומם`;
    saidWithUndo(`${said}${stayed}`);
  }

  function duplicateSelection(): void {
    const items = selected();
    const { ops, ids } = duplicateOps(store.doc, store.selection, () => crypto.randomUUID());
    if (ops.length === 0) return;
    runEdit('שכפול', ops, ids);
    saidWithUndo(items.length === 1 ? `נוצר עותק של ${items[0].label}` : `נוצרו ${ids.length} עותקים`);
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
    runEdit(locking ? 'נעילה' : 'שחרור נעילה', ops);
    /* Ruling P12: the toast counts what changed — an item already locked (or
       already free) is not in `ops`, so it is neither counted nor named. */
    const only = ops.length === 1 && ops[0].type === 'update' ? findItem(store.doc, ops[0].id) : undefined;
    const one = only === undefined ? null : only.label;
    saidWithUndo(locking
      ? (one === null ? `${ops.length} פריטים ננעלו` : `הפריט ${one} ננעל`)
      : (one === null ? `הנעילה של ${ops.length} פריטים שוחררה` : `הנעילה של ${one} שוחררה`));
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
    // Through a fixed noun: "הוספת" + the kind's name would read "הוספת אחר" for the kind אחר.
    runEdit(`הוספת פריט מסוג ${SITE_KINDS[kind].label}`, ops, [id]);
    saidWithUndo(`הפריט ${added.item.label} נוסף למפה`);
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
   * (ruling G2). Anything about to select items shows their group, or the
   * nets, first.
   */
  function revealFor(ids: readonly string[]): void {
    const items = ids
      .map((id) => findItem(store.doc, id))
      .filter((item): item is EditorItem => item !== undefined);
    const groups = new Set(items.map((item) => SITE_KINDS[item.kind].group));
    const patch: Partial<EditorUi> = {};
    if (ui.hiddenGroups.some((group) => groups.has(group))) {
      patch.hiddenGroups = ui.hiddenGroups.filter((group) => !groups.has(group));
    }
    if (ui.netsHidden && items.some((item) => item.kind === 'shade')) patch.netsHidden = false;
    if (patch.hiddenGroups !== undefined || patch.netsHidden !== undefined) patchUi(patch);
  }

  /**
   * The one way a figure or a problem selects the items it names (§13):
   * shown first (G2), then selected and flown to. The list's group counts,
   * the inspectors and the checks bar all come through here, so no path can
   * select a hidden item. An empty list clears the selection.
   */
  function pickIds(ids: string[]): void {
    revealFor(ids);
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
      revealFor([id]);
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
          footer={actions}
        />
      );
    }
    return (
      <MultiInspector
        key={items.map((item) => item.id).join(' ')}
        doc={store.doc}
        ids={items.map((item) => item.id)}
        onRun={runEdit}
        onPickIds={pickIds}
        onClear={() => { store.select([]); }}
        footer={actions}
      />
    );
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
   * a size, a name, the hour slider — is the box's, never the map's.
   */
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.defaultPrevented || isTyping(event.target)) return;
    const shortcut = shortcutFor(event);
    if (shortcut === null) return;
    event.preventDefault();
    runShortcut(shortcut);
  }

  async function resolve(choice: 'theirs' | 'mine'): Promise<void> {
    historyMoved(); // 'theirs' clears the history; 'mine' rebuilds the map under it
    setResolving(true);
    try {
      await store.resolveConflict(choice);
    } finally {
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

  const editor = (
    <div className={styles.editorArea}>
      {store.conflict === null && !plotMovedUnderEdits ? null : (
        <ConflictBanner
          busy={resolving}
          onTheirs={() => { void resolve('theirs'); }}
          onMine={() => { void resolve('mine'); }}
        />
      )}
      {saveError === null ? null : (
        <SaveErrorBanner
          id={reasonId}
          message={saveError}
          busy={resolving}
          onReload={refused ? () => { void resolve('theirs'); } : undefined}
        />
      )}
      {store.notice === null ? null : (
        <div className={styles.banner} role="status">
          <p className={styles.bannerText}>{store.notice}</p>
          <Button size="sm" tone="ghost" onClick={() => { store.dismissNotice(); }}>הבנתי</Button>
        </div>
      )}
      <Toolbar
        ui={fullUi}
        onUi={patchUi}
        canUndo={store.canUndo}
        canRedo={store.canRedo}
        onUndo={undo}
        onRedo={redo}
      />
      <section className={styles.stage} aria-label="מפת הקאמפ" tabIndex={-1} ref={stageRef}>
        <div className={styles.scene}>
          <SceneView
            ref={sceneRef}
            store={sceneStore}
            ui={sceneUi}
            insets={INSETS}
            sunDate={sunDay}
            onView={onView}
            onNotice={onNotice}
          />
        </div>
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
              endDay={burnEnd}
              day={sunDay}
              onDay={setPickedDay}
              samples={sunSamples}
              hasNets={hasNets}
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
              onRetry={() => { store.retrySave(); }}
            />
            <ButtonLink size="sm" href={plotHref}>
              <Icon name="grid" size={14} />
              הגדרות המגרש
            </ButtonLink>
          </>
        )}
      />
      {editor}
    </div>
  );
}
