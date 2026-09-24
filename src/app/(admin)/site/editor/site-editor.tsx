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
  useCallback, useId, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type RefAttributes,
} from 'react';
import { SeasonChip, TopBar } from '@/components/shell/top-bar';
import { Button, ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toaster';
import type { SiteItemKind } from '@/db/schema/site';
import { effectiveSize } from '@/lib/site/defaults';
import { formatSize, snap } from '@/lib/site/geometry';
import { nearestFreeSpot } from '@/lib/site/editor/placement';
import { KIND_GROUP_ORDER, SITE_KINDS, type SiteKindGroup } from '@/lib/site/kinds';
import { findItem, type EditorDoc, type EditorItem } from '@/lib/site/editor/model';
import { addOps, duplicateOps, lockOps, moveOps, removeOps, turnOps } from '@/lib/site/editor/commands';
import { screenArrowToMap } from '@/lib/site/editor/camera';
import { readSunDate } from '@/lib/site/views';
import { loadSiteDocAction, saveSiteChangesAction } from '../actions';
import { useEditorStore } from './use-editor-store';
import { SCENE_PALETTE, type SceneTheme } from './scene/palette';
import type { EditorUi, Insets, SceneHandle, SceneViewProps, ViewInfo } from './scene/scene-view';
import { shortcutFor, ZOOM_IN, type Arrow, type Shortcut } from './keyboard';
import { Toolbar } from './panels/toolbar';
import { ConflictBanner, SaveErrorBanner, SaveStatus } from './panels/save-status';
import { LibraryPanel } from './panels/library-panel';
import { ObjectsPanel } from './panels/objects-panel';
import { SidePanel, type SideTab } from './panels/side-panel';
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
  buildTasks: ReadonlyArray<{ id: string; title: string }>;
  /** The plot drawer: size, grid and north. */
  plotHref: string;
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
  const { initial, initialSelection, seasonName, sunDate, plotHref } = props;
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
  const stageRef = useRef<HTMLElement>(null);
  const reasonId = useId();
  const sceneRef = useRef<SceneHandle>(null);
  const flownToPeek = useRef(false);

  /* The day the sun is worked out for: a real `YYYY-MM-DD` gate day or none
     (`readSunDate`, the one check of that shape). Everything below that needs
     a day — the scene, and the sun card — takes this, never `sunDate` itself. */
  const gateDay = readSunDate(sunDate);
  const fullUi = useMemo<EditorUi>(() => ({ ...ui, theme }), [ui, theme]);
  /* The sun is drawn only for a real day (spec §13): with no gate date the
     toggle opens the card's invitation, and the scene lights no sun. */
  const sceneUi = useMemo<EditorUi>(() => ({ ...fullUi, sun: fullUi.sun && gateDay !== null }), [fullUi, gateDay]);
  const vars = useMemo(() => paletteVars(theme), [theme]);

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

  function removeSelection(): void {
    const ops = removeOps(store.doc, store.selection);
    if (ops.length === 0) return;
    const gone = new Set(ops.flatMap((op) => (op.type === 'remove' ? [op.id] : [])));
    store.run('הסרה', ops, store.selection.filter((id) => !gone.has(id)));
  }

  function duplicateSelection(): void {
    const { ops, ids } = duplicateOps(store.doc, store.selection, () => crypto.randomUUID());
    if (ops.length === 0) return;
    store.run('שכפול', ops, ids);
  }

  function turnSelection(): void {
    const ops = turnOps(store.doc, store.selection);
    if (ops.length === 0) return;
    store.run('סיבוב', ops);
  }

  function toggleLock(): void {
    const items = selected();
    if (items.length === 0) return;
    const locking = !items.every((item) => item.locked);
    const ops = lockOps(store.doc, store.selection, locking);
    if (ops.length === 0) return;
    store.run(locking ? 'נעילה' : 'שחרור נעילה', ops);
  }

  /** Arrows follow the screen, so "up" is away from the viewer however the view is turned (§8). */
  function nudge(arrow: Arrow, big: boolean): void {
    if (store.selection.length === 0) return;
    const [ux, uy] = screenArrowToMap(view.yaw, arrow);
    const step = big ? 100 : store.doc.plot.gridCm;
    const ops = moveOps(store.doc, store.selection, Math.round(ux * step), Math.round(uy * step));
    if (ops.length === 0) return;
    store.run('הזזה', ops);
  }

  /** A new item of `kind` with its north-west corner at `at`, selected once it lands. */
  function addAt(kind: SiteItemKind, at: { xCm: number; yCm: number }): void {
    const id = crypto.randomUUID();
    const ops = addOps(store.doc, kind, at, id);
    if (ops.length === 0) return;
    // Through a fixed noun: "הוספת" + the kind's name would read "הוספת אחר" for the kind אחר.
    store.run(`הוספת פריט מסוג ${SITE_KINDS[kind].label}`, ops, [id]);
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

  function runShortcut(shortcut: Shortcut): void {
    if (typeof shortcut === 'object') {
      nudge(shortcut.arrow, shortcut.big);
      return;
    }
    switch (shortcut) {
      case 'undo': store.undo(); break;
      case 'redo': store.redo(); break;
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

  const editor = (
    <div className={styles.editorArea}>
      {store.conflict === null ? null : (
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
        onUndo={() => { store.undo(); }}
        onRedo={() => { store.redo(); }}
      />
      <section className={styles.stage} aria-label="מפת הקאמפ" tabIndex={-1} ref={stageRef}>
        <div className={styles.scene}>
          <SceneView
            ref={sceneRef}
            store={store}
            ui={sceneUi}
            insets={INSETS}
            sunDate={gateDay}
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
