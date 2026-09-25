import * as THREE from 'three';
import type { SiteItemKind } from '@/db/schema/site';
import { effectiveSize, itemHeight } from '@/lib/site/defaults';
import { toPlaced } from '@/lib/site/derive';
import {
  fitRect, groundAt, interpolate, orbit, panBy, project, pxPerCm, zoomAt,
  type CameraState, type ScreenBox, type Vec3, type ViewMode, type Viewport,
} from '@/lib/site/editor/camera';
import { moveOps, setRectOps } from '@/lib/site/editor/commands';
import { layoutLabels, type LabelInput, type PlacedLabel } from '@/lib/site/editor/label-layout';
import { findItem, findLine, rectOf, underlayOf, type EditorItem } from '@/lib/site/editor/model';
import { landingRule, type Landing } from '@/lib/site/editor/placement';
import { placeOps } from '@/lib/site/editor/underlay-commands';
import { pathOf } from '@/lib/site/lines';
import { snapMove, snapResize, type GuideLine } from '@/lib/site/editor/snapping';
import { CAMP_SITE, jerusalemInstant, sunDirection, sunPosition } from '@/lib/site/editor/sun';
import {
  formatMetres, formatSize, gapObstacles, gapsAround, groundRect, unionRect, type Gap, type Handle, type Rect,
} from '@/lib/site/geometry';
import { SITE_KINDS, type SiteKindGroup } from '@/lib/site/kinds';
import {
  imageToMap, isOnImage, mapToImage, moveBy, type ImagePoint, type MapPoint, type UnderlayPlacement,
} from '@/lib/site/underlay';
import { MAX_UNDERLAY_TEXTURE_PX, underlayUrl } from '@/lib/site/underlay-limits';
import { readSunDate } from '@/lib/site/views';
import { LOCKED_NOTICE } from '../notices';
import { CameraRig } from './camera-rig';
import { Gestures, type GestureIntent, type GestureWorld, type PointerInput } from './gestures';
import type { LabelsLayerHandle } from './labels-layer';
import { buildGround, CM, directionOf, disposeObject, worldOf } from './meshes';
import { OverlayLayer, type OverlayClasses, type OverlayModel } from './overlay';
import { SCENE_LIGHT, SCENE_PALETTE } from './palette';
import { pickItemId } from './picking';
import { isShown, SceneSync } from './scene-sync';
import { loadUnderlayImage, UNDERLAY_LIFT_CM, UnderlayLayer } from './underlay-mesh';
import { classifyPick, UnderlayGestures, type UnderlayIntent } from './underlay-tool';
import type { SceneViewProps, ViewInfo } from './scene-view';

/**
 * Everything `SceneView` does that is not React: the renderer, the scene,
 * the camera and its animations, pointer input, snapping previews, the
 * overlay marks, the labels, and the picture under the map with its two
 * tools. React renders the DOM once; from then on
 * the engine reads the latest props through `props()` and draws a frame
 * only when something changed.
 */

export interface EngineOptions {
  /** The latest props; read at the moment they are needed, never cached. */
  props: () => SceneViewProps;
  labels: () => LabelsLayerHandle | null;
  classes: OverlayClasses & { canvas: string };
}

type RectCm = { xCm: number; yCm: number; widthCm: number; depthCm: number };

/** Hebrew, for the toast the editor shows (`onNotice`). The locked notice is `../notices.ts`'s, shared with the panels. */
export const CONTEXT_LOST_NOTICE = 'התצוגה התלת־ממדית נעצרה לרגע. היא תחזור מעצמה.';

/**
 * The browser could not give a WebGL context: the one failure `SceneView`
 * reports as missing 3D graphics. Anything that breaks later is another
 * failure, and says so differently. The message is for developers only.
 */
export class NoWebGLError extends Error {
  constructor(cause: unknown) {
    super('WebGL is not available', { cause });
    this.name = 'NoWebGLError';
  }
}

/** What a drag does once it is past the click threshold: from then until it settles, the view is moving. */
const MOTION: ReadonlySet<GestureIntent['type']> = new Set(['panBy', 'orbitBy', 'movePreview', 'resizePreview', 'marquee']);

/** Measured at the label's CSS size and weight (`scene.module.css` `.label`). */
const LABEL_FONT_PX = 12.5;
const LABEL_PAD_PX = 18;
const LABEL_HEIGHT = 22;
/** How long the view must be still before it counts as settled. */
const SETTLE_MS = 160;
/** ViewInfo at most ten times a second while moving. */
const VIEW_EVERY_MS = 100;
/** Snap guides pull within this many screen pixels, whatever the zoom. */
const SNAP_PX = 9;
const HANDLE_HIT_PX = 7;
/** Toward the light when the sun is not modelled: from the north-west, high. */
const DEFAULT_LIGHT: Vec3 = [-0.42, -0.58, 0.7];

const HANDLE_AT: Record<Handle, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function baseLabel(label: string): string {
  return label.replace(/\s*\d+$/, '').trim();
}

function toRect(r: RectCm): Rect {
  return { x: r.xCm, y: r.yCm, width: r.widthCm, depth: r.depthCm };
}

export class SceneEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig = new CameraRig();
  private sync = new SceneSync();
  private ground: THREE.Group | null = null;
  private groundKey = '';
  private readonly hemisphere = new THREE.HemisphereLight(SCENE_LIGHT.sky, SCENE_LIGHT.ground, 2.2);
  private readonly light = new THREE.DirectionalLight(SCENE_LIGHT.sun, 1.4);
  private sunOn = false;
  private readonly gestures: Gestures;
  /** Null until the constructor has made it, and again once disposed. */
  private overlay: OverlayLayer | null = null;
  private readonly resizeObserver: ResizeObserver | null;
  /** The pixel ratio the canvas is drawn at (0 until the first resize), and the query that reports the screen's changing. */
  private pixelRatio = 0;
  private ratioQuery: MediaQueryList | null = null;
  private readonly text: CanvasRenderingContext2D | null;
  private readonly font: string;

  private viewport: Viewport = { width: 0, height: 0 };
  private cam: CameraState | null = null;
  /**
   * The view is the automatic whole-plot fit — the first one, or the last F —
   * and nobody has framed it since. While it is, a resize fits the plot to
   * the new stage (Ruling X1: fully fit). Any hand on the camera (orbit, pan,
   * zoom, turn, a jump, a fly-to) clears it, and then a resize keeps the
   * lead's view. A switch between plan and 3D is not framing and keeps it.
   */
  private autoFit = true;
  /** What the editor asked for, and what is drawn — 3D while the switch to plan animates. */
  private mode: ViewMode;
  private drawMode: ViewMode;
  private animation: { from: CameraState; to: CameraState; start: number; duration: number; then?: () => void } | null = null;
  private frameId = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMotion = -Infinity;
  private lastView = -Infinity;
  private lastCameraKey = '';
  /** A drag past the click threshold is under way: the view counts as moving until it ends. */
  private dragging = false;
  /** The pointer the open gesture belongs to; only its events feed it. Null when no gesture is open. */
  private gesturePointer: number | null = null;
  private viewDirty = true;
  private sceneDirty = true;
  private labelsDirty = true;
  private alive = true;
  private lost = false;

  /** `ui.hiddenGroups` as a set, rebuilt only when the array changes. */
  private hiddenFrom: readonly SiteKindGroup[] | null = null;
  private hidden: ReadonlySet<SiteKindGroup> = new Set();

  private hover: string | null = null;
  private preview = new Map<string, RectCm>();
  private resizing: string | null = null;
  private guides: GuideLine[] = [];
  private gaps: Gap[] = [];
  private marquee: ScreenBox | null = null;
  private measuring: { from: [number, number]; to: [number, number] } | null = null;
  private ghost: { kind: SiteItemKind; xCm: number; yCm: number } | null = null;
  private ghostObject: THREE.Group | null = null;
  private handles: Array<{ handle: Handle; x: number; y: number }> = [];
  /** The item the last frame drew `handles` for. */
  private handlesOf: string | null = null;
  private placed: PlacedLabel[] = [];
  private slots = new Map<string, string>();
  private anchors = new Map<string, [number, number]>();
  private seen: {
    doc: unknown; selection: unknown; flags: unknown; ui: string; light: string; insets: string; tool: string; marks: string;
    underlayView: string;
  } = {
    doc: null, selection: null, flags: null, ui: '', light: '', insets: '', tool: '', marks: '', underlayView: '',
  };

  /**
   * The picture under the map (spec §19). Made with the engine, before the
   * constructor's body runs, so `teardown` can always free it, even after a
   * constructor that failed halfway. Its callbacks read the engine only when
   * they run.
   */
  private readonly underlay = new UnderlayLayer({
    load: loadUnderlayImage,
    maxSide: () => Math.min(MAX_UNDERLAY_TEXTURE_PX, this.maxTextureSize()),
    onStatus: (status) => {
      if (this.alive) this.options.props().onUnderlay?.({ type: 'status', status });
    },
    onLoaded: () => {
      this.sceneDirty = true;
      this.requestFrame();
    },
  });
  /** The picture's two tools' pointer machine (`underlay-tool.ts`); `gestures` sees the tool as 'select' meanwhile. */
  private readonly underlayGestures = new UnderlayGestures({
    tool: () => (this.options.props().ui.tool === 'align' ? 'align' : 'calibrate'),
    mode: () => this.drawMode,
    groundAt: (x, y) => (this.cam === null ? null : groundAt(this.cam, this.viewport, this.drawMode, x, y)),
    onImage: (ground) => this.imagePointAt(ground) !== null,
  });
  /** Where an alignment drag has the picture right now; the store is not touched until the drop. */
  private underlayPreview: UnderlayPlacement | null = null;

  constructor(private readonly stage: HTMLElement, private readonly options: EngineOptions) {
    const canvas = document.createElement('canvas');
    canvas.className = options.classes.canvas;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'מפת הקאמפ');
    this.canvas = canvas;
    // First, so a browser without WebGL throws before anything is attached.
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    } catch (cause) {
      throw new NoWebGLError(cause);
    }

    try {
      // The pixel ratio is `resize`'s, which reads it every time (see there).
      this.renderer.shadowMap.enabled = true;
      stage.appendChild(canvas);
      this.overlay = new OverlayLayer(stage, options.classes);

      this.light.shadow.mapSize.set(2048, 2048);
      this.scene.add(this.hemisphere, this.light, this.light.target, this.sync.root, this.underlay.root);

      const props = options.props();
      this.mode = props.ui.mode;
      this.drawMode = props.ui.mode;
      this.font = `500 ${LABEL_FONT_PX}px ${getComputedStyle(stage).fontFamily || 'system-ui, sans-serif'}`;
      this.text = document.createElement('canvas').getContext('2d');
      if (this.text !== null) this.text.font = this.font;

      const world: GestureWorld = {
        // The picture's tools have their own pointer machine; to this one, they are the selection tool.
        tool: () => (this.options.props().ui.tool === 'measure' ? 'measure' : 'select'),
        mode: () => this.drawMode,
        handleAt: (x, y) => this.handleAt(x, y),
        labelAt: (x, y) => this.labelAt(x, y),
        itemAt: (x, y) => this.itemAt(x, y),
        groundAt: (x, y) => (this.cam === null ? null : groundAt(this.cam, this.viewport, this.drawMode, x, y)),
        selection: () => this.options.props().store.selection,
      };
      this.gestures = new Gestures(world);

      canvas.addEventListener('pointerdown', this.onPointerDown);
      canvas.addEventListener('pointermove', this.onPointerMove);
      canvas.addEventListener('pointerup', this.onPointerUp);
      canvas.addEventListener('pointercancel', this.onPointerCancel);
      canvas.addEventListener('lostpointercapture', this.onPointerCancel);
      canvas.addEventListener('pointerleave', this.onPointerLeave);
      canvas.addEventListener('wheel', this.onWheel, { passive: false });
      canvas.addEventListener('dblclick', this.onDoubleClick);
      canvas.addEventListener('contextmenu', this.onContextMenu);
      canvas.addEventListener('webglcontextlost', this.onContextLost);
      canvas.addEventListener('webglcontextrestored', this.onContextRestored);
      window.addEventListener('blur', this.onBlur);

      this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { this.resize(); });
      this.resizeObserver?.observe(stage);
      this.watchRatio();
      this.update();
      this.resize();

      // Labels are measured in the page's font; a web font that arrives later measures differently.
      // `document.fonts` is missing in some environments (jsdom), and the promise may settle after dispose.
      document.fonts?.ready.then(() => { this.remeasure(); }, () => {});
    } catch (error) {
      // The renderer exists: its context is given back now, not whenever the collector gets to it.
      this.teardown();
      throw error;
    }
  }

  /* ── from React ─────────────────────────────────────────────────────── */

  /**
   * Called after every render of `SceneView`. Marks dirty only what changed,
   * and asks for a frame only then (or for a change of view mode, which
   * animates): a render that changed nothing the scene shows draws nothing.
   */
  update(): void {
    const { store, ui, insets, sunDate, underlayMarks } = this.options.props();
    const plot = store.doc.plot;
    const uiKey = [
      ui.tool, ui.labels, ui.sun, ui.netsHidden, ui.snap, ui.hiddenGroups.join(','), ui.theme,
    ].join('|');
    /* How this viewer sees the picture (review U1), apart from `uiKey` as the
       light is: a fade or a hide re-places one plane, and neither rebuilds the
       scene nor lays the labels out again. */
    const underlayViewKey = `${ui.underlay.shown}|${ui.underlay.opacity}`;
    const marksKey = (underlayMarks ?? []).map(([u, v]) => `${u},${v}`).join(';');
    /* What only the light reads (SIM2 fix round 1): shade by hour plays the
       hour up to ten times a second, and a new hour or day moves the sun and
       nothing else — no rebuild, no new label layout. `applyLight` marks the
       scene dirty itself when the sun comes on or goes off. The plot's size is
       here because the shadows cover the plot, so they follow a resize. */
    const lightKey = [ui.sun, ui.hour, sunDate, plot.northDeg, plot.widthCm, plot.depthCm].join('|');
    const insetsKey = `${insets.left},${insets.top},${insets.right},${insets.bottom}`;
    let changed = false;
    if (store.doc !== this.seen.doc || store.flags !== this.seen.flags || store.selection !== this.seen.selection) {
      this.sceneDirty = true;
      this.labelsDirty = true;
      this.viewDirty = true;
      changed = true;
    }
    if (uiKey !== this.seen.ui) {
      this.sceneDirty = true;
      this.labelsDirty = true;
      changed = true;
    }
    if (uiKey !== this.seen.ui || lightKey !== this.seen.light) {
      this.applyLight();
      changed = true;
    }
    if (insetsKey !== this.seen.insets) {
      this.labelsDirty = true;
      this.viewDirty = true;
      changed = true;
    }
    if (marksKey !== this.seen.marks) changed = true;
    if (underlayViewKey !== this.seen.underlayView) {
      this.syncUnderlay();
      changed = true;
    }
    if (ui.tool !== this.seen.tool) {
      // The measure and calibration tools' crosshair; back to the plain arrow until the next hover says otherwise.
      this.canvas.style.cursor = ui.tool === 'measure' || ui.tool === 'calibrate' ? 'crosshair' : 'default';
      // A drag of the picture does not outlive its tool.
      this.underlayGestures.cancel();
      if (this.underlayPreview !== null) {
        this.underlayPreview = null;
        this.sceneDirty = true;
        changed = true;
      }
    }
    this.seen = {
      doc: store.doc, selection: store.selection, flags: store.flags, ui: uiKey, light: lightKey, insets: insetsKey, tool: ui.tool,
      marks: marksKey, underlayView: underlayViewKey,
    };
    if (ui.tool !== 'measure' && this.measuring !== null && !this.gestures.active) {
      this.measuring = null;
      changed = true;
    }
    if (ui.mode !== this.mode) this.switchMode(ui.mode);
    if (changed) this.requestFrame();
  }

  dispose(): void {
    this.teardown();
  }

  /**
   * Lets go of everything: frames, timers, listeners, GPU memory, the
   * context, the DOM. Also what a constructor that failed halfway calls, so
   * nothing here may assume the constructor finished.
   */
  private teardown(): void {
    this.alive = false;
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.resizeObserver?.disconnect();
    this.ratioQuery?.removeEventListener('change', this.onRatioChange);
    this.ratioQuery = null;
    const canvas = this.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('lostpointercapture', this.onPointerCancel);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('dblclick', this.onDoubleClick);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    window.removeEventListener('blur', this.onBlur);
    this.sync.dispose();
    this.underlay.dispose();
    if (this.ground !== null) disposeObject(this.ground);
    this.setGhost(null);
    this.renderer.dispose();
    // This canvas is never reused, so its context is given back at once.
    this.renderer.forceContextLoss();
    this.overlay?.dispose();
    this.overlay = null;
    canvas.remove();
  }

  /** The web font has arrived: labels are measured in it from now on, and laid out again. */
  private remeasure(): void {
    if (!this.alive) return;
    if (this.text !== null) this.text.font = this.font;
    this.labelsDirty = true;
    this.requestFrame();
  }

  /* ── SceneHandle ────────────────────────────────────────────────────── */

  /* Each command below first lands whatever animation is running
     (`stopAnimation`) and only then works out where to go: halfway through
     a switch to plan, "fit" means the plan fit, from the plan camera. */

  fitAll(): void {
    if (this.cam === null) return;
    this.stopAnimation();
    this.autoFit = true;
    const pitch = this.drawMode === 'plan' ? 90 : this.cam.pitch;
    this.animate(fitRect(null, this.cam.yaw, pitch, this.viewport, this.drawMode, this.safe(), this.plot()), 420);
  }

  fitIds(ids: readonly string[]): void {
    if (this.cam === null) return;
    this.stopAnimation();
    this.autoFit = false;
    const { doc } = this.options.props().store;
    const rects = doc.items.filter((entry) => ids.includes(entry.id)).map(rectOf);
    // A line frames as the box around its whole run, walls and bends included.
    for (const line of doc.lines) {
      if (!ids.includes(line.id)) continue;
      const path = pathOf(doc, line);
      if (path === null) continue;
      const xs = path.map((p) => p[0]);
      const ys = path.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      rects.push({ x, y, width: Math.max(...xs) - x, depth: Math.max(...ys) - y });
    }
    const rect = unionRect(rects);
    if (rect === null) return;
    const pad = 250;
    const padded = { x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, depth: rect.depth + pad * 2 };
    const pitch = this.drawMode === 'plan' ? 90 : this.cam.pitch;
    const to = fitRect(padded, this.cam.yaw, pitch, this.viewport, this.drawMode, this.safe(), this.plot());
    this.animate({ ...to, distance: Math.max(to.distance, 900) }, 520);
  }

  zoomBy(factor: number): void {
    if (this.cam === null) return;
    this.stopAnimation();
    this.autoFit = false;
    const safe = this.safe();
    this.animate(zoomAt(this.cam, this.viewport, this.drawMode, (safe.l + safe.r) / 2, (safe.t + safe.b) / 2, factor), 200);
  }

  /** A quarter turn in plan, an eighth in 3D. */
  rotateView(dir: 1 | -1): void {
    if (this.cam === null) return;
    this.stopAnimation();
    this.autoFit = false;
    const step = this.drawMode === 'plan' ? 90 : 45;
    this.animate({ ...this.cam, yaw: Math.round(this.cam.yaw / step) * step + dir * step }, 380);
  }

  /**
   * True north to the top of the screen (spec §5, the view controls'
   * compass) — not the map's own up edge, which points to compass bearing
   * `plot.northDeg`.
   *
   * The sign: at yaw θ, screen-up on the ground is the map direction
   * (−sin θ, −cos θ) (`camera.ts`; the picture is turned θ clockwise, the
   * map's up showing θ clockwise of the screen's top). True north on the map
   * is (−sin northDeg, −cos northDeg) (`sun.ts`, `mapDirection(0, northDeg)`):
   * `northDeg` counter-clockwise of the map's up. They agree when
   * θ = northDeg. With `northDeg` 0 this is yaw 0, as it always was.
   */
  northUp(): void {
    if (this.cam === null) return;
    this.stopAnimation();
    this.autoFit = false;
    const { northDeg } = this.options.props().store.doc.plot;
    this.animate({ ...this.cam, yaw: ((northDeg % 360) + 360) % 360 }, 380);
  }

  centreGround(): [number, number] | null {
    if (this.cam === null) return null;
    const safe = this.safe();
    return groundAt(this.cam, this.viewport, this.drawMode, (safe.l + safe.r) / 2, (safe.t + safe.b) / 2);
  }

  groundAtClient(clientX: number, clientY: number): [number, number] | null {
    if (this.cam === null) return null;
    const { x, y } = this.local({ clientX, clientY });
    if (x < 0 || y < 0 || x > this.viewport.width || y > this.viewport.height) return null;
    return groundAt(this.cam, this.viewport, this.drawMode, x, y);
  }

  /** The library's drag preview: `xCm`, `yCm` are the new item's north-west corner. */
  setGhost(ghost: { kind: SiteItemKind; xCm: number; yCm: number } | null): void {
    this.ghost = ghost;
    if (this.ghostObject !== null) {
      this.scene.remove(this.ghostObject);
      disposeObject(this.ghostObject);
      this.ghostObject = null;
    }
    if (ghost !== null && this.alive) {
      const { store, ui } = this.options.props();
      const size = effectiveSize(ghost.kind, store.doc.defaults);
      const ok = this.ghostVerdict() === 'ok';
      const palette = SCENE_PALETTE[ui.theme];
      // The box's sides in three's axes: the one map→three swap is `directionOf`'s.
      const sides = directionOf([size.widthCm * CM, size.depthCm * CM, size.heightCm * CM]);
      const geometry = new THREE.BoxGeometry(sides.x, sides.y, sides.z);
      const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: ok ? palette.selected : palette.bad, transparent: true, opacity: 0.22, depthWrite: false,
      }));
      body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: ok ? palette.selected : palette.bad })));
      body.position.copy(worldOf(size.widthCm / 2, size.depthCm / 2, size.heightCm / 2));
      const group = new THREE.Group();
      group.add(body);
      group.position.copy(worldOf(ghost.xCm, ghost.yCm, 0));
      this.ghostObject = group;
      this.scene.add(group);
    }
    this.requestFrame();
  }

  jumpTo(xCm: number, yCm: number): void {
    const centre = this.centreGround();
    if (this.cam === null || centre === null) return;
    this.stopAnimation();
    this.setCamera(panBy(this.cam, xCm - centre[0], yCm - centre[1]));
  }

  /**
   * The current view as a PNG blob, drawn fresh first. A blob, not a data
   * URL: Chromium refuses to download a data URL much over 2 MB, and a
   * full-screen PNG at a high pixel ratio is several. Null when there is no
   * view yet, the context is lost, or the browser cannot make the file. The
   * labels are DOM (`LabelsLayer`), not WebGL, so they are not in it.
   */
  exportPng(): Promise<Blob | null> {
    const cam = this.cam;
    if (cam === null || this.lost) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        this.renderer.render(this.scene, this.rig.apply(cam, this.viewport, this.drawMode));
        // `preserveDrawingBuffer` keeps that frame on the canvas until the blob is read.
        this.canvas.toBlob((blob) => { resolve(blob); }, 'image/png');
      } catch {
        resolve(null);
      }
    });
  }

  /** The picture's card's "ניסיון נוסף": load the picture again after it failed or went missing. */
  retryUnderlay(): void {
    this.underlay.retry();
  }

  /* ── frames ─────────────────────────────────────────────────────────── */

  private requestFrame(): void {
    if (this.frameId !== 0 || !this.alive) return;
    this.frameId = requestAnimationFrame(this.frame);
  }

  /* The clock is `performance.now()`, not the frame's timestamp: animations
     start and pointer motion is stamped with it, so every time compared
     here is on one clock. */
  private readonly frame = (): void => {
    this.frameId = 0;
    if (!this.alive || this.lost || this.cam === null) return;
    const now = performance.now();
    const props = this.options.props();
    const animating = this.stepAnimation(now);
    const camera = this.rig.apply(this.cam, this.viewport, this.drawMode);

    const cameraKey = `${this.drawMode}|${this.viewport.width}x${this.viewport.height}|${Object.values(this.cam).join(',')}`;
    if (cameraKey !== this.lastCameraKey) {
      // The first placement of the camera is not motion; everything after it is.
      if (this.lastCameraKey !== '') this.markMotion(now);
      this.lastCameraKey = cameraKey;
      this.labelsDirty = true;
    }
    if (this.sceneDirty) {
      this.syncScene();
      this.sceneDirty = false;
    }
    const minor = this.ground?.getObjectByName('gridMinor');
    if (minor !== undefined) minor.visible = pxPerCm(this.cam, this.viewport) * props.store.doc.plot.gridCm >= 6;

    this.renderer.render(this.scene, camera);
    this.handles = this.computeHandles();
    if (this.labelsDirty) {
      this.layoutLabels();
      this.labelsDirty = false;
    }
    this.overlay?.draw(this.overlayModel());

    const moving = this.isMoving(now);
    if (moving) {
      this.viewDirty = true;
      if (now - this.lastView >= VIEW_EVERY_MS) this.emitView(now, true);
    } else if (this.viewDirty) {
      this.emitView(now, false);
    }
    if (animating) this.requestFrame();
  };

  /** A press that has not passed the click threshold is not motion: a click never hides the selection bar. */
  private isMoving(now: number): boolean {
    return this.animation !== null || this.dragging || now - this.lastMotion < SETTLE_MS;
  }

  /** Motion happened; once it has stopped for `SETTLE_MS`, report the settled view once. */
  private markMotion(now: number): void {
    this.lastMotion = now;
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.viewDirty = true;
      this.requestFrame();
    }, SETTLE_MS + 20);
  }

  private emitView(now: number, moving: boolean): void {
    this.lastView = now;
    this.viewDirty = moving;
    this.options.props().onView(this.viewInfo(moving));
  }

  private viewInfo(moving: boolean): ViewInfo {
    const cam = this.cam as CameraState;
    const safe = this.safe();
    const fit = fitRect(null, cam.yaw, this.drawMode === 'plan' ? 90 : cam.pitch, this.viewport, this.drawMode, safe, this.plot());
    const corners: Array<[number, number]> = [];
    for (const [x, y] of [[safe.l, safe.t], [safe.r, safe.t], [safe.r, safe.b], [safe.l, safe.b]]) {
      const ground = groundAt(cam, this.viewport, this.drawMode, x, y);
      if (ground !== null) corners.push(ground);
    }
    return {
      yaw: ((cam.yaw % 360) + 360) % 360,
      zoomPct: Math.round((fit.distance / cam.distance) * 100),
      pxPerM: pxPerCm(cam, this.viewport) * 100,
      groundCorners: corners,
      selectionBox: moving ? null : this.selectionBox(),
      moving,
    };
  }

  /* ── camera ─────────────────────────────────────────────────────────── */

  /**
   * The canvas follows the stage's CSS size and the screen's pixel density,
   * read afresh each time: a page zoom changes both, and a window moved to
   * another screen changes only the density (`watchRatio`). Capped at 2×,
   * as the engine always drew.
   */
  private resize(): void {
    const rect = this.stage.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width === 0 || height === 0) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (width === this.viewport.width && height === this.viewport.height && ratio === this.pixelRatio) return;
    if (ratio !== this.pixelRatio) {
      this.pixelRatio = ratio;
      this.renderer.setPixelRatio(ratio);
    }
    this.viewport = { width, height };
    this.renderer.setSize(width, height, false);
    if (this.cam === null) {
      const plan = this.drawMode === 'plan';
      this.cam = fitRect(null, plan ? 0 : -26, plan ? 90 : 50, this.viewport, this.drawMode, this.safe(), this.plot());
    } else if (this.autoFit) {
      this.refit();
    }
    this.labelsDirty = true;
    this.viewDirty = true;
    this.requestFrame();
  }

  /**
   * A query that matches the screen's density now, and so reports the first
   * change away from it — which no resize does when the CSS size stays put.
   * It is one density's query, so each change arms a new one.
   */
  private watchRatio(): void {
    this.ratioQuery?.removeEventListener('change', this.onRatioChange);
    this.ratioQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      : null;
    this.ratioQuery?.addEventListener('change', this.onRatioChange);
  }

  private readonly onRatioChange = (): void => {
    if (!this.alive) return;
    this.watchRatio();
    this.resize();
  };

  private safe(): ScreenBox {
    const { insets } = this.options.props();
    const box = { l: insets.left, t: insets.top, r: this.viewport.width - insets.right, b: this.viewport.height - insets.bottom };
    return box.r - box.l < 80 || box.b - box.t < 80 ? { l: 0, t: 0, r: this.viewport.width, b: this.viewport.height } : box;
  }

  private plot(): { widthCm: number; depthCm: number } {
    const { plot } = this.options.props().store.doc;
    return { widthCm: plot.widthCm, depthCm: plot.depthCm };
  }

  /** The camera set directly — a pan, an orbit, a wheel, a jump: always a hand on the view. */
  private setCamera(next: CameraState): void {
    this.cam = next;
    this.autoFit = false;
    this.requestFrame();
  }

  /**
   * The automatic fit again, for the stage as it is now, at the angle the view
   * has or is heading to. An animation under way (the first F, a switch of
   * mode) keeps running and lands on the new fit instead of the old one.
   */
  private refit(): void {
    const running = this.animation;
    const from = running?.to ?? this.cam;
    if (from === null) return;
    const pitch = this.drawMode === 'plan' ? 90 : from.pitch;
    const fit = fitRect(null, from.yaw, pitch, this.viewport, this.drawMode, this.safe(), this.plot());
    if (running !== null) this.animation = { ...running, to: fit };
    else this.cam = fit;
  }

  private animate(to: CameraState, duration: number, then?: () => void): void {
    if (this.cam === null) return;
    this.stopAnimation();
    this.animation = { from: this.cam, to, start: performance.now(), duration, then };
    this.requestFrame();
  }

  /** A hand on the map ends an animation; a mode switch still lands where it was going. */
  private stopAnimation(): void {
    const running = this.animation;
    if (running === null) return;
    this.animation = null;
    if (running.then !== undefined) {
      this.cam = running.to;
      running.then();
    }
  }

  private stepAnimation(now: number): boolean {
    const running = this.animation;
    if (running === null) return false;
    const t = Math.min(1, Math.max(0, (now - running.start) / running.duration));
    this.cam = interpolate(running.from, running.to, ease(t));
    if (t < 1) return true;
    this.animation = null;
    this.cam = running.to;
    running.then?.();
    return false;
  }

  /**
   * Plan is 3D seen from straight above (spec §7): going to plan tilts the
   * perspective camera to 90° and only then swaps in the orthographic one, so
   * the picture never jumps; going to 3D swaps first and then tilts down.
   *
   * A switch still under way is overtaken, not finished: its landing (the
   * swap of cameras, the report that it settled) belongs to a mode the
   * editor no longer wants, so it is dropped and the new switch goes on from
   * wherever the camera is. `stopAnimation` would land it instead — right
   * for a hand on the map, wrong here.
   */
  private switchMode(next: ViewMode): void {
    this.mode = next;
    if (this.cam === null) {
      this.drawMode = next;
      return;
    }
    this.animation = null;
    const settle = () => this.options.props().onModeSettled?.(next);
    this.drawMode = '3d';
    if (next === 'plan') {
      const to = { ...this.cam, pitch: 90, yaw: Math.round(this.cam.yaw / 90) * 90 };
      this.animate(to, 520, () => {
        this.drawMode = 'plan';
        settle();
      });
    } else {
      this.animate({ ...this.cam, pitch: 50, yaw: this.cam.yaw - 26 }, 520, settle);
    }
  }

  /* ── the scene ──────────────────────────────────────────────────────── */

  /** The hidden groups as a set, for `isShown` (`scene-sync.ts`), the one rule for what the scene holds. */
  private hiddenGroups(): ReadonlySet<SiteKindGroup> {
    const { hiddenGroups } = this.options.props().ui;
    if (hiddenGroups !== this.hiddenFrom) {
      this.hiddenFrom = hiddenGroups;
      this.hidden = new Set(hiddenGroups);
    }
    return this.hidden;
  }

  private visible(item: EditorItem): boolean {
    return isShown(item, this.hiddenGroups(), this.options.props().ui.netsHidden);
  }

  /** Where an item is drawn now: its drag preview if it has one, else the store's. */
  private drawn(item: EditorItem): RectCm {
    return this.preview.get(item.id) ?? { xCm: item.xCm, yCm: item.yCm, widthCm: item.widthCm, depthCm: item.depthCm };
  }

  private syncScene(): void {
    const { store, ui } = this.options.props();
    const plot = store.doc.plot;
    const key = `${plot.widthCm}x${plot.depthCm}:${plot.gridCm}:${ui.theme}`;
    if (key !== this.groundKey) {
      if (this.ground !== null) {
        this.scene.remove(this.ground);
        disposeObject(this.ground);
      }
      this.ground = buildGround(plot, ui.theme);
      this.scene.add(this.ground);
      this.groundKey = key;
      this.scene.background = new THREE.Color(SCENE_PALETTE[ui.theme].outside);
    }
    this.sync.sync({
      doc: store.doc,
      preview: this.preview,
      selection: new Set(store.selection),
      hover: this.hover,
      flags: store.flags,
      hiddenGroups: this.hiddenGroups(),
      netsHidden: ui.netsHidden,
      theme: ui.theme,
      sun: this.sunOn,
    });
    this.syncUnderlay();
  }

  /** The picture: its file, where it lies (or is being dragged to), and how this viewer sees it. */
  private syncUnderlay(): void {
    const { store, ui } = this.options.props();
    const underlay = underlayOf(store.doc);
    this.underlay.sync({
      url: underlay === null ? null : underlayUrl(store.doc.plot.id, underlay.storageKey),
      placement: this.underlayPreview ?? underlay,
      shown: ui.underlay.shown,
      opacity: ui.underlay.opacity,
    });
  }

  /**
   * The directional light: the sun at the chosen hour when shade by hour is
   * on (spec §11), else a fixed key light. The meshes read only whether the
   * sun is on — real shadows, or the drawn patches — so the scene is rebuilt
   * only when that flips, not for every new hour.
   */
  private applyLight(): void {
    const { store, ui, sunDate } = this.options.props();
    const plot = store.doc.plot;
    const wasOn = this.sunOn;
    let toward: Vec3 = DEFAULT_LIGHT;
    let sunDown = false;
    this.sunOn = false;
    // The one check of a day (`readSunDate`, P15): a date the calendar does not have is no date, never a guessed one.
    const day = readSunDate(sunDate);
    if (ui.sun && day !== null) {
      const sun = sunPosition(jerusalemInstant(day, ui.hour), CAMP_SITE.latitude, CAMP_SITE.longitude);
      if (sun.elevationDeg > 0) {
        toward = sunDirection(sun, plot.northDeg);
        this.sunOn = true;
      } else {
        sunDown = true;
      }
    }
    const centre = worldOf(plot.widthCm / 2, plot.depthCm / 2, 0);
    const radius = (Math.hypot(plot.widthCm, plot.depthCm) * CM) / 2 + 10;
    const direction = directionOf(toward).normalize();
    this.light.position.copy(centre).addScaledVector(direction, radius * 3);
    this.light.target.position.copy(centre);
    this.light.target.updateMatrixWorld();
    this.light.castShadow = this.sunOn;
    const shadow = this.light.shadow.camera;
    shadow.left = -radius;
    shadow.right = radius;
    shadow.top = radius;
    shadow.bottom = -radius;
    shadow.near = 0.5;
    shadow.far = radius * 6;
    shadow.updateProjectionMatrix();
    this.light.intensity = sunDown ? 0 : this.sunOn ? 2.4 : 1.4;
    this.hemisphere.intensity = this.sunOn ? 1.3 : sunDown ? 0.9 : 2.2;
    if (this.sunOn !== wasOn) this.sceneDirty = true;
  }

  /* ── what is where on screen ────────────────────────────────────────── */

  private local(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private screen(x: number, y: number, z: number): [number, number] | null {
    if (this.cam === null) return null;
    const at = project(this.cam, this.viewport, this.drawMode, [x, y, z]);
    return at === null ? null : [at.x, at.y];
  }

  /** The screen box of a footprint raised to a height; null when any corner is behind the camera. */
  private screenBox(rect: RectCm, heightCm: number): ScreenBox | null {
    let box: ScreenBox | null = null;
    for (const z of [0, heightCm]) {
      for (const [x, y] of [[rect.xCm, rect.yCm], [rect.xCm + rect.widthCm, rect.yCm],
        [rect.xCm, rect.yCm + rect.depthCm], [rect.xCm + rect.widthCm, rect.yCm + rect.depthCm]]) {
        const at = this.screen(x, y, z);
        if (at === null) return null;
        box = box === null
          ? { l: at[0], t: at[1], r: at[0], b: at[1] }
          : { l: Math.min(box.l, at[0]), t: Math.min(box.t, at[1]), r: Math.max(box.r, at[0]), b: Math.max(box.b, at[1]) };
      }
    }
    return box;
  }

  private selectionBox(): ScreenBox | null {
    const { store } = this.options.props();
    let box: ScreenBox | null = null;
    for (const id of store.selection) {
      const item = findItem(store.doc, id);
      if (item === undefined || !this.visible(item)) continue;
      const one = this.screenBox(this.drawn(item), itemHeight(item, store.doc.defaults));
      if (one === null) continue;
      box = box === null ? one : { l: Math.min(box.l, one.l), t: Math.min(box.t, one.t), r: Math.max(box.r, one.r), b: Math.max(box.b, one.b) };
    }
    return box;
  }

  private itemAt(x: number, y: number): { id: string; isNet: boolean; locked: boolean; line?: boolean } | null {
    if (this.cam === null) return null;
    const { store } = this.options.props();
    const camera = this.rig.apply(this.cam, this.viewport, this.drawMode);
    const id = pickItemId(camera, this.sync, x, y, this.viewport);
    if (id === null) return null;
    const item = findItem(store.doc, id);
    if (item !== undefined) return { id: item.id, isNet: SITE_KINDS[item.kind].shape === 'net', locked: item.locked };
    // A pipe or a cable: selectable, never dragged (its ends are).
    return findLine(store.doc, id) === undefined ? null : { id, isNet: false, locked: false, line: true };
  }

  private labelAt(x: number, y: number): { ids: string[]; group: boolean } | null {
    for (let i = this.placed.length - 1; i >= 0; i -= 1) {
      const { rect, ids, group } = this.placed[i];
      if (x >= rect.l && x <= rect.r && y >= rect.t && y <= rect.b) return { ids, group };
    }
    return null;
  }

  /** The one selected item that may have handles now: visible and unlocked, else none. */
  private handleOwner(): EditorItem | null {
    const { store } = this.options.props();
    if (store.selection.length !== 1) return null;
    const item = findItem(store.doc, store.selection[0]);
    return item === undefined || item.locked || !this.visible(item) ? null : item;
  }

  /**
   * A handle under the pointer — asked of the store as it is now, not of the
   * handles the last frame drew: an item locked since then has none, so a
   * drag on it falls through to the item and says it is locked.
   */
  private handleAt(x: number, y: number): Handle | null {
    const owner = this.handleOwner();
    if (owner === null || owner.id !== this.handlesOf) return null;
    for (const entry of this.handles) {
      if (Math.abs(entry.x - x) <= HANDLE_HIT_PX && Math.abs(entry.y - y) <= HANDLE_HIT_PX) return entry.handle;
    }
    return null;
  }

  /** The GPU's largest texture side. The tests' stand-in renderers have none, and are taken at 4096. */
  private maxTextureSize(): number {
    const { capabilities } = this.renderer as { capabilities?: { maxTextureSize?: number } };
    return capabilities?.maxTextureSize ?? MAX_UNDERLAY_TEXTURE_PX;
  }

  private underlayTool(): boolean {
    const { tool } = this.options.props().ui;
    return tool === 'calibrate' || tool === 'align';
  }

  /** The picture point under a ground point, or null where no picture is drawn. */
  private imagePointAt(ground: MapPoint): ImagePoint | null {
    const underlay = underlayOf(this.options.props().store.doc);
    const aspect = this.underlay.aspect;
    if (underlay === null || aspect === null) return null;
    const point = mapToImage(this.underlayPreview ?? underlay, aspect, ground);
    return isOnImage(point) ? point : null;
  }

  /** Where a picture point is on screen, or null. */
  private screenOfImagePoint(point: ImagePoint): { x: number; y: number } | null {
    const underlay = underlayOf(this.options.props().store.doc);
    const aspect = this.underlay.aspect;
    if (underlay === null || aspect === null) return null;
    const [x, y] = imageToMap(this.underlayPreview ?? underlay, aspect, point);
    const at = this.screen(x, y, UNDERLAY_LIFT_CM);
    return at === null ? null : { x: at[0], y: at[1] };
  }

  /** Eight handles on the ground around the one selected, unlocked, visible item — none while the camera flies. */
  private computeHandles(): Array<{ handle: Handle; x: number; y: number }> {
    const item = this.animation === null ? this.handleOwner() : null;
    this.handlesOf = item?.id ?? null;
    if (item === null) return [];
    const rect = this.drawn(item);
    const out: Array<{ handle: Handle; x: number; y: number }> = [];
    for (const [handle, [fx, fy]] of Object.entries(HANDLE_AT) as Array<[Handle, [number, number]]>) {
      const at = this.screen(rect.xCm + fx * rect.widthCm, rect.yCm + fy * rect.depthCm, 0);
      if (at !== null) out.push({ handle, x: at[0], y: at[1] });
    }
    return out;
  }

  /* ── labels ─────────────────────────────────────────────────────────── */

  private labelWidth(text: string): number {
    const measured = this.text?.measureText(text).width ?? text.length * 7;
    return Math.ceil(measured) + LABEL_PAD_PX;
  }

  /**
   * The caller's half of the layout (`label-layout.ts`, spec §9): which items
   * get a label, its text, anchor, priority and group key. Selected, hovered
   * and flagged items and nets are never grouped, and every one of the first
   * three outranks any item that could be grouped.
   */
  private layoutLabels(): void {
    const layer = this.options.labels();
    const { store, ui } = this.options.props();
    this.anchors.clear();
    if (!ui.labels || this.cam === null) {
      this.placed = [];
      layer?.update([], new Set());
      return;
    }
    const selection = new Set(store.selection);
    const { flags } = store;
    const inputs: LabelInput[] = [];
    for (const item of store.doc.items) {
      if (!this.visible(item)) continue;
      const rect = this.drawn(item);
      const height = itemHeight(item, store.doc.defaults);
      const isNet = SITE_KINDS[item.kind].shape === 'net';
      const box = this.screenBox(rect, height);
      if (box === null) continue;
      const selected = selection.has(item.id);
      const hovered = this.hover === item.id;
      // Under three pixels on screen, only the selected or hovered item keeps a label (spec §9.6).
      if (Math.max(box.r - box.l, box.b - box.t) < 3 && !selected && !hovered) continue;
      // A net's label hangs from the middle of its north edge, never over the lounge under it.
      const anchor = isNet
        ? this.screen(rect.xCm + rect.widthCm / 2, rect.yCm, height)
        : this.screen(rect.xCm + rect.widthCm / 2, rect.yCm + rect.depthCm / 2, height);
      if (anchor === null) continue;
      const issue = flags.outside.has(item.id) || flags.overlapping.has(item.id) || flags.partly.has(item.id);
      const text = selected && selection.size === 1 ? `${item.label} · ${formatSize(rect.widthCm, rect.depthCm)}` : item.label;
      // Selected, hovered and flagged items, and nets, are always labelled on their own (spec §9.4).
      const groupable = !isNet && !selected && !hovered && !issue;
      const area = (rect.widthCm * rect.depthCm) / 100;
      inputs.push({
        id: item.id, text, width: this.labelWidth(text), height: LABEL_HEIGHT, anchor, box,
        priority: (selected ? 4e9 : 0) + (hovered ? 2e9 : 0) + (issue ? 1e9 : 0) + (isNet ? 0 : 1e8) + area,
        groupKey: groupable ? `${item.kind}|${baseLabel(item.label)}` : null,
        groupNoun: groupable ? SITE_KINDS[item.kind].plural : null,
        isNet,
      });
      this.anchors.set(item.id, anchor);
    }
    this.placed = layoutLabels(inputs, {
      bounds: this.safe(),
      obstacles: this.handles.map((h) => ({ l: h.x - HANDLE_HIT_PX, t: h.y - HANDLE_HIT_PX, r: h.x + HANDLE_HIT_PX, b: h.y + HANDLE_HIT_PX })),
      previous: this.slots,
      measure: (text) => this.labelWidth(text),
      labelHeight: LABEL_HEIGHT,
    });
    this.slots = new Map(this.placed.map((label) => [label.key, label.slot]));
    layer?.update(this.placed, selection);
  }

  /* ── overlay ────────────────────────────────────────────────────────── */

  private overlayModel(): OverlayModel {
    const model: OverlayModel = { handles: this.handles, lines: [], dots: [], pills: [], marquee: this.marquee };
    const line = (from: [number, number], to: [number, number], kind: 'guide' | 'gap' | 'measure') => {
      const a = this.screen(from[0], from[1], 1);
      const b = this.screen(to[0], to[1], 1);
      if (a !== null && b !== null) model.lines.push({ from: a, to: b, kind });
      return a !== null && b !== null ? [a, b] as const : null;
    };
    for (const guide of this.guides) line(guide.from, guide.to, 'guide');
    for (const gap of this.gaps) {
      const drawn = line(gap.from, gap.to, 'gap');
      if (drawn !== null) {
        model.pills.push({ x: (drawn[0][0] + drawn[1][0]) / 2, y: (drawn[0][1] + drawn[1][1]) / 2, text: formatMetres(gap.lengthCm), tone: 'guide' });
      }
    }
    if (this.measuring !== null) {
      const drawn = line(this.measuring.from, this.measuring.to, 'measure');
      if (drawn !== null) {
        const length = Math.hypot(this.measuring.to[0] - this.measuring.from[0], this.measuring.to[1] - this.measuring.from[1]);
        model.dots.push({ x: drawn[0][0], y: drawn[0][1], kind: 'measure' }, { x: drawn[1][0], y: drawn[1][1], kind: 'measure' });
        model.pills.push({ x: (drawn[0][0] + drawn[1][0]) / 2, y: (drawn[0][1] + drawn[1][1]) / 2 - 14, text: formatMetres(length), tone: 'guide' });
      }
    }
    // Calibration marks (spec §18): the points marked so far while calibrating, the saved pair while the card is open.
    const marks = (this.options.props().underlayMarks ?? [])
      .map((point) => this.screenOfImagePoint(point))
      .filter((at): at is { x: number; y: number } => at !== null);
    if (marks.length === 2) {
      model.lines.push({ from: [marks[0].x, marks[0].y], to: [marks[1].x, marks[1].y], kind: 'measure' });
    }
    for (const at of marks) model.dots.push({ x: at.x, y: at.y, kind: 'measure' });
    for (const label of this.placed) {
      if (!label.group) continue;
      for (const id of label.ids) {
        const at = this.anchors.get(id);
        if (at !== undefined) model.dots.push({ x: at[0], y: at[1], kind: 'member' });
      }
    }
    const { store } = this.options.props();
    if (this.resizing !== null) {
      const rect = this.preview.get(this.resizing);
      const item = findItem(store.doc, this.resizing);
      if (rect !== undefined && item !== undefined) {
        const at = this.screen(rect.xCm + rect.widthCm / 2, rect.yCm + rect.depthCm / 2, itemHeight(item, store.doc.defaults));
        if (at !== null) model.pills.push({ x: at[0], y: at[1] - 18, text: formatSize(rect.widthCm, rect.depthCm), tone: 'focus' });
      }
    }
    if (this.ghost !== null) {
      const size = effectiveSize(this.ghost.kind, store.doc.defaults);
      const at = this.screen(this.ghost.xCm + size.widthCm / 2, this.ghost.yCm + size.depthCm / 2, size.heightCm);
      const verdict = this.ghostVerdict();
      const text = verdict === 'outside' ? 'מחוץ לגדר'
        : verdict === 'overlapping' ? 'חפיפה עם פריט אחר'
          : verdict === 'ropes' ? 'בשטח החבלים של רשת צל'
            : `${SITE_KINDS[this.ghost.kind].label} · ${formatSize(size.widthCm, size.depthCm)}`;
      if (at !== null) model.pills.push({ x: at[0], y: at[1] - 16, text, tone: verdict === 'ok' ? 'focus' : 'bad' });
    }
    return model;
  }

  /**
   * Whether a new item dropped where the ghost is would land clear:
   * `landingRule`, the one rule the library's click and a copy use too — a
   * net's ropes inside the fence, and nothing in a net's rope band.
   */
  private ghostVerdict(): Landing {
    const ghost = this.ghost;
    if (ghost === null) return 'ok';
    const { doc } = this.options.props().store;
    const size = effectiveSize(ghost.kind, doc.defaults);
    // A new item follows its kind's height and the camp's rope angle, as `addOps` makes it.
    return landingRule(doc)(
      { kind: ghost.kind, heightCm: null, ropeAngleDeg: null },
      { x: ghost.xCm, y: ghost.yCm, width: size.widthCm, depth: size.depthCm },
    );
  }

  /* ── intents ────────────────────────────────────────────────────────── */

  private apply(intents: readonly GestureIntent[]): void {
    if (intents.length === 0) return;
    const props = this.options.props();
    const { store } = props;
    for (const intent of intents) {
      switch (intent.type) {
        case 'select':
          store.select(intent.ids);
          break;
        case 'toggleSelect':
          store.select(store.selection.includes(intent.id)
            ? store.selection.filter((id) => id !== intent.id)
            : [...store.selection, intent.id]);
          break;
        case 'clearSelection':
          store.select([]);
          this.measuring = null;
          break;
        case 'panBy':
          if (this.cam !== null) this.setCamera(panBy(this.cam, intent.dxCm, intent.dyCm));
          break;
        case 'orbitBy':
          if (this.cam !== null && this.drawMode === '3d') this.setCamera(orbit(this.cam, intent.dYaw, intent.dPitch));
          break;
        case 'movePreview':
          this.previewMove(intent.ids, intent.dxCm, intent.dyCm, intent.free);
          break;
        case 'moveCommit': {
          const snapped = this.snapMoveOf(intent.ids, intent.dxCm, intent.dyCm, intent.free);
          this.clearPreview();
          // Only what the command made: a drop where it started is no edit at all.
          const ops = snapped === null ? [] : moveOps(store.doc, intent.ids, snapped.dxCm, snapped.dyCm);
          if (ops.length > 0) store.run('הזזה', ops);
          break;
        }
        case 'resizePreview': {
          const rect = this.snapResizeOf(intent.id, intent.handle, intent.dxCm, intent.dyCm, intent.free);
          if (rect !== null) {
            this.preview = new Map([[intent.id, rect]]);
            this.resizing = intent.id;
            this.sceneDirty = true;
            this.labelsDirty = true;
          }
          break;
        }
        case 'resizeCommit': {
          const rect = this.snapResizeOf(intent.id, intent.handle, intent.dxCm, intent.dyCm, intent.free);
          this.clearPreview();
          const ops = rect === null ? [] : setRectOps(store.doc, intent.id, rect);
          if (ops.length > 0) store.run('שינוי גודל', ops);
          break;
        }
        case 'marquee': {
          this.marquee = intent.box;
          const inside = this.itemsInside(intent.box).filter((id) => !intent.base.includes(id));
          store.select([...intent.base, ...inside]);
          break;
        }
        case 'marqueeEnd':
          this.marquee = null;
          break;
        case 'measure':
          this.measuring = { from: intent.from, to: intent.to };
          break;
        case 'zoomToIds':
          this.fitIds(intent.ids);
          break;
        case 'lockedNotice':
          props.onNotice(LOCKED_NOTICE);
          break;
        case 'hover':
          this.canvas.style.cursor = intent.cursor;
          if (intent.id !== this.hover) {
            this.hover = intent.id;
            this.sceneDirty = true;
            this.labelsDirty = true;
          }
          break;
      }
    }
    // Past the click threshold, a drag is motion until it ends (`endDrag`), even while the pointer rests.
    if (this.gestures.active && intents.some((intent) => MOTION.has(intent.type))) {
      this.dragging = true;
      this.markMotion(performance.now());
    }
    this.requestFrame();
  }

  /** The picture's tools' intents (`underlay-tool.ts`). A drop is one edit, through the same `store.run` as a move. */
  private applyUnderlay(intents: readonly UnderlayIntent[]): void {
    if (intents.length === 0) return;
    const { store } = this.options.props();
    let motion = false;
    for (const intent of intents) {
      switch (intent.type) {
        case 'panBy':
          if (this.cam !== null) this.setCamera(panBy(this.cam, intent.dxCm, intent.dyCm));
          motion = true;
          break;
        case 'orbitBy':
          if (this.cam !== null && this.drawMode === '3d') this.setCamera(orbit(this.cam, intent.dYaw, intent.dPitch));
          motion = true;
          break;
        case 'cursor':
          this.canvas.style.cursor = intent.cursor;
          break;
        case 'pick':
          this.pickOnImage(intent.x, intent.y, intent.ground);
          break;
        case 'movePreview': {
          const underlay = underlayOf(store.doc);
          this.underlayPreview = underlay === null ? null : moveBy(underlay, intent.dxCm, intent.dyCm);
          this.sceneDirty = true;
          motion = true;
          break;
        }
        case 'moveCommit': {
          const underlay = underlayOf(store.doc);
          this.underlayPreview = null;
          this.sceneDirty = true;
          // Only what the command made: a drop where it started is no edit at all.
          const ops = underlay === null ? [] : placeOps(store.doc, moveBy(underlay, intent.dxCm, intent.dyCm));
          if (ops.length > 0) store.run('הזזת תמונת הרקע', ops);
          break;
        }
      }
    }
    if (motion && this.underlayGestures.active) {
      this.dragging = true;
      this.markMotion(performance.now());
    }
    this.requestFrame();
  }

  /**
   * A click while calibrating (spec §18.3): a point on the picture, or the
   * reason it is not one — off the picture, or too near the first point to
   * measure by — which the card says in Hebrew. Before the picture can be
   * shown — still loading, or failed — there is nothing yet to mark, and the
   * card says that instead (review U1).
   */
  private pickOnImage(x: number, y: number, ground: MapPoint): void {
    const props = this.options.props();
    const underlay = underlayOf(props.store.doc);
    const aspect = this.underlay.aspect;
    if (underlay === null) return;
    if (aspect === null) {
      props.onUnderlay?.({ type: 'notReady' });
      return;
    }
    const point = mapToImage(underlay, aspect, ground);
    const marks = props.underlayMarks ?? [];
    const first = marks.length === 1 ? this.screenOfImagePoint(marks[0]) : null;
    const verdict = classifyPick(point, { x, y }, first);
    if (verdict !== 'point') {
      props.onUnderlay?.({ type: verdict });
      return;
    }
    // Six decimals: a millionth of the picture is far finer than a click, and keeps the saved JSON short.
    const round = (n: number) => Math.round(n * 1e6) / 1e6;
    props.onUnderlay?.({ type: 'point', uv: [round(point[0]), round(point[1])] });
  }

  /** The drag is over, however it ended: a view that was moving settles from now. */
  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.markMotion(performance.now());
  }

  /**
   * A gesture that will not finish: the browser cancelled the pointer or took
   * its capture away, a second finger landed, or the window lost focus.
   * Nothing is saved, and nothing it previewed stays on the map.
   */
  private abandon(): void {
    this.gesturePointer = null;
    const open = this.gestures.active || this.preview.size > 0 || this.marquee !== null || this.guides.length > 0
      || this.underlayGestures.active || this.underlayPreview !== null;
    if (!open) return;
    this.apply(this.gestures.cancel());
    this.underlayGestures.cancel();
    this.underlayPreview = null;
    this.marquee = null;
    this.clearPreview();
    this.endDrag();
    this.requestFrame();
  }

  private snapMoveOf(ids: readonly string[], dxCm: number, dyCm: number, free: boolean) {
    const { store, ui } = this.options.props();
    const moving = store.doc.items.filter((entry) => ids.includes(entry.id) && !entry.locked);
    const union = unionRect(moving.map(rectOf));
    if (union === null || this.cam === null) return null;
    const others = store.doc.items
      .filter((entry) => !ids.includes(entry.id) && this.visible(entry) && SITE_KINDS[entry.kind].shape !== 'net')
      .map(rectOf);
    const snapped = snapMove({
      moving: union, others, plot: this.plot(), dxCm, dyCm,
      gridCm: store.doc.plot.gridCm,
      thresholdCm: SNAP_PX / pxPerCm(this.cam, this.viewport),
      free: free || !ui.snap,
    });
    return { ...snapped, moving, others };
  }

  private previewMove(ids: readonly string[], dxCm: number, dyCm: number, free: boolean): void {
    const snapped = this.snapMoveOf(ids, dxCm, dyCm, free);
    if (snapped === null) return;
    this.preview = new Map(snapped.moving.map((entry) => [entry.id, {
      xCm: entry.xCm + snapped.dxCm, yCm: entry.yCm + snapped.dyCm, widthCm: entry.widthCm, depthCm: entry.depthCm,
    }]));
    this.guides = snapped.guides;
    const only = snapped.moving.length === 1 ? this.preview.get(snapped.moving[0].id) : undefined;
    this.gaps = only === undefined ? [] : this.gapsOf(ids, snapped.moving[0], only);
    this.sceneDirty = true;
    this.labelsDirty = true;
  }

  /**
   * The gap readouts around one dragged item — the "walkway" (spec §3,
   * §14): from its footprint (a net's reaches its stakes) to every solid
   * item, and to the rope footprint of every net it is not under
   * (`gapObstacles`). Snapping still ignores nets (`snapMoveOf`).
   */
  private gapsOf(ids: readonly string[], item: EditorItem, at: RectCm): Gap[] {
    const { store } = this.options.props();
    const { defaults } = store.doc;
    const others = store.doc.items
      .filter((entry) => !ids.includes(entry.id) && this.visible(entry))
      .map((entry) => toPlaced(entry, defaults));
    const moving = toPlaced({ ...item, ...at }, defaults);
    return gapsAround(groundRect(moving), gapObstacles(others, toRect(at)), this.plot());
  }

  private snapResizeOf(id: string, handle: Handle, dxCm: number, dyCm: number, free: boolean): RectCm | null {
    const { store, ui } = this.options.props();
    const item = findItem(store.doc, id);
    if (item === undefined || item.locked) return null;
    const rect = snapResize(rectOf(item), handle, dxCm, dyCm, store.doc.plot.gridCm, free || !ui.snap);
    return { xCm: rect.x, yCm: rect.y, widthCm: rect.width, depthCm: rect.depth };
  }

  private clearPreview(): void {
    this.preview = new Map();
    this.resizing = null;
    this.guides = [];
    this.gaps = [];
    this.sceneDirty = true;
    this.labelsDirty = true;
  }

  /** Items whose middle is inside the box; a net only when all of it is (as the mock). */
  private itemsInside(box: ScreenBox): string[] {
    const { store } = this.options.props();
    const inside = (at: [number, number] | null) => at !== null && at[0] >= box.l && at[0] <= box.r && at[1] >= box.t && at[1] <= box.b;
    return store.doc.items.filter((item) => {
      if (!this.visible(item)) return false;
      if (SITE_KINDS[item.kind].shape === 'net') {
        return [[item.xCm, item.yCm], [item.xCm + item.widthCm, item.yCm], [item.xCm, item.yCm + item.depthCm],
          [item.xCm + item.widthCm, item.yCm + item.depthCm]].every(([x, y]) => inside(this.screen(x, y, 0)));
      }
      return inside(this.screen(item.xCm + item.widthCm / 2, item.yCm + item.depthCm / 2, 0));
    }).map((item) => item.id);
  }

  /* ── DOM events ─────────────────────────────────────────────────────── */

  private pointer(event: PointerEvent): PointerInput {
    const { x, y } = this.local(event);
    return { x, y, button: event.button, shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey };
  }

  /* The map follows one pointer at a time. A gesture belongs to the pointer
     that started it (its `pointerId`): only that pointer's moves and release
     feed it. `isPrimary` alone is not enough, because a mouse, a pen and a
     touch are each primary for their own type at once. With no gesture
     open, the primary pointer of any type hovers and may start one.

     Another pointer pressing mid-gesture ends that gesture unsaved and
     starts nothing of its own. A second finger is a pinch or a slip, a
     touch during a pen drag is a palm or a slip, and none of them is the
     drop of what was being dragged. */

  /** Whether this event is the map's to follow: the open gesture's pointer, or, with none open, a primary one. */
  private follows(event: PointerEvent): boolean {
    return this.gesturePointer === null ? event.isPrimary : event.pointerId === this.gesturePointer;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.cam === null) return;
    const open = this.gesturePointer;
    // Any press while a gesture is open ends it: another pointer's, or its own again (its release never came).
    this.abandon();
    if (open !== null && event.pointerId !== open) return;
    if (!event.isPrimary) return;
    this.stopAnimation();
    const input = this.pointer(event);
    if (this.underlayTool()) this.applyUnderlay(this.underlayGestures.down(input));
    else this.apply(this.gestures.down(input));
    if (!this.gestures.active && !this.underlayGestures.active) return;
    this.gesturePointer = event.pointerId;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer cannot be captured; the drag still works inside the canvas.
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.cam === null || !this.follows(event)) return;
    const input = this.pointer(event);
    if (this.underlayGestures.active || (this.underlayTool() && !this.gestures.active)) {
      this.applyUnderlay(this.underlayGestures.move(input));
    } else {
      this.apply(this.gestures.move(input));
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.follows(event)) return;
    // The gesture ends — and commits — before the capture is let go: a browser
    // may fire lostpointercapture inside releasePointerCapture, and that must
    // find nothing open to abandon. (It lets go after pointerup anyway.)
    const input = this.pointer(event);
    if (this.underlayGestures.active) this.applyUnderlay(this.underlayGestures.up(input));
    else this.apply(this.gestures.up(input));
    this.gesturePointer = null;
    this.endDrag();
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Already released, or never captured.
    }
  };

  /** `pointercancel` and `lostpointercapture` of the gesture's own pointer: the gesture will not finish. */
  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.gesturePointer !== null && event.pointerId !== this.gesturePointer) return;
    this.abandon();
  };

  /**
   * A drag whose window loses focus never sees its release. It is abandoned,
   * and the pointer it captured — by the id it was pressed with — is let go,
   * so that pointer's later events are not the map's (review minor).
   */
  private readonly onBlur = (): void => {
    const held = this.gesturePointer;
    this.abandon();
    if (held === null) return;
    try {
      this.canvas.releasePointerCapture(held);
    } catch {
      // Already released, or never captured.
    }
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (!event.isPrimary) return;
    this.apply(this.gestures.leave());
  };

  /** Wheel and trackpad pinch (a wheel with Ctrl) zoom toward the pointer. */
  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.cam === null) return;
    this.stopAnimation();
    const { x, y } = this.local(event);
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const factor = Math.exp(delta * (event.ctrlKey ? 0.01 : 0.0016));
    this.setCamera(zoomAt(this.cam, this.viewport, this.drawMode, x, y, factor));
  };

  /** Double-click flies to the item (spec §8). */
  private readonly onDoubleClick = (event: MouseEvent): void => {
    // Calibrating or aligning, a double-click is two clicks on the picture, not a flight to an item.
    if (this.underlayTool()) return;
    const { x, y } = this.local(event);
    const hit = this.itemAt(x, y);
    if (hit === null) return;
    this.options.props().store.select([hit.id]);
    this.fitIds([hit.id]);
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.options.props().onNotice(CONTEXT_LOST_NOTICE);
  };

  /** three restores its own state; the scene is rebuilt from the store (spec §17). */
  private readonly onContextRestored = (): void => {
    this.lost = false;
    this.scene.remove(this.sync.root);
    this.sync.dispose();
    this.sync = new SceneSync();
    this.scene.add(this.sync.root);
    // The kept picture goes up again as a new texture (spec §19).
    this.underlay.rebuild();
    if (this.ground !== null) {
      this.scene.remove(this.ground);
      disposeObject(this.ground);
      this.ground = null;
      this.groundKey = '';
    }
    this.sceneDirty = true;
    this.labelsDirty = true;
    this.viewDirty = true;
    this.requestFrame();
  };
}
