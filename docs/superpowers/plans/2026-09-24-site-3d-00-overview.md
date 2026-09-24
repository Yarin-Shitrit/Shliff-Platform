# מפת הקאמפ in 3D — Implementation Plan (overview)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SVG board on `/site` with a `three`-based editor — plan and 3D views of one scene — that saves in versioned background batches, never overlaps labels, sizes multi-selections per kind, and shows shade by hour.

**Architecture:** Pure TypeScript editor core in `src/lib/site/editor/` (ops, commands, history, snapping, camera maths, label layout, sun); a thin `three` adapter in `src/app/(admin)/site/editor/scene/`; React panels in `src/app/(admin)/site/editor/panels/`; one server action that applies a batch of ops in a transaction against a plan version. The new editor mounts behind `?editor=3d` from Task 20 until Task 26 makes it the page.

**Tech Stack:** Next.js 16.3.4 (App Router), React 19.2.8, TypeScript, drizzle-orm 0.45 + drizzle-kit 0.31, `three@0.186.1`, vitest 5 + Testing Library + pglite, CSS Modules on `src/app/tokens.css`.

**Spec:** `docs/superpowers/specs/2026-09-24-site-map-3d-editor-design.md` — read it first; the plan argues from it.

**Mock:** <https://claude.ai/artifact/JAXMTZecw7xQNBKWThVUSP> — layout, copy and behaviour.

## The plan files

| File | Tasks | Ends with |
|---|---|---|
| `2026-09-24-site-3d-01-data.md` | 1–7 | dependency in, migration `0012`, `applySiteOps` + `saveSiteChangesAction` tested against pglite |
| `2026-09-24-site-3d-02-core.md` | 8–14 | every pure editor module tested: model, ops, commands, history, snapping, placement, camera, label layout, sun |
| `2026-09-24-site-3d-03-store-scene.md` | 15–20 | save queue, editor store, meshes, scene sync, camera rig, picking, gestures, `SceneView` mounted at `/site?editor=3d` and checked in a browser |
| `2026-09-24-site-3d-04-panels-page.md` | 21–27 | every panel, the page switched over, old board retired, browser verification, PR ready |

Execute in order. Each task commits on its own. Each file's tasks assume the previous file is done.

## Where to work

- Worktree: `/Users/yarin/GitProjects/Shliff_Platform-lanes/site-3d`, branch `feat/site-map-3d` (already created from `origin/main` at `60e1850`; the spec is committed there as `091f337`, `9a24c76`).
- **Never work in `/Users/yarin/GitProjects/Shliff_Platform`** — another session's branch lives there, and the git index is shared per tree (`CLAUDE.md`, "Traps").
- Use `/usr/bin/git` for `log`; `git status`, `diff`, `add`, `commit` are fine. Stage by path; never `git add -A`.

## Global Constraints

Every task's requirements include these. Copied from the spec and `CLAUDE.md`.

- **Units:** every stored length is an integer number of centimetres. Metres appear only in typed input and on screen. x grows east, y grows south, z up. The map **never mirrors for RTL**.
- **Dependencies:** exactly `three@0.186.1` (dependency) and `@types/three@0.186.0` (devDependency), pinned without `^`. Nothing else is added — not `@react-three/*`, not `drei`, not Playwright (D1, ruling R1 exception).
- **`three` is imported only** under `src/app/(admin)/site/editor/scene/**` and the three-import guard test (Task 1). Pure modules in `src/lib/site/**` never import `three`, React or the DOM.
- **Hebrew only on screen.** Library code throws English messages with stable prefixes; `src/app/(admin)/site/failure-messages.ts` maps each prefix to Hebrew. No English string reaches a rendered element.
- **Gender-neutral Hebrew:** no gendered imperatives addressing people; no adjective that must agree with a variable noun (write "ברירת המחדל של אוהל", never "אוהל חדש").
- **`'use server'` files export only async functions.** A string constant beside the actions returns 500 on every route (`actions.ts:15-20`).
- **Migration** is `0012`, generated with `npx drizzle-kit generate`, never `drizzle-kit push`. Applying it to Railway is the camp lead's manual step (`docs/deploy.md` §6) — not part of this plan.
- **Colours** come from `src/app/tokens.css` custom properties, except the scene palette in `scene/palette.ts`, which is scoped data (like `charts.module.css`'s `.viz`).
- **Tests** run with the capped command, always with a unique output file:
  `npx vitest run <paths> --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`.
  A non-zero exit with zero failures means workers died, not green. Run only your task's paths; the full suite runs once, in Task 27.
- **Typecheck** with `npx tsc --noEmit`; **lint** with `rtk proxy npx eslint <paths>` (the RTK hook mangles bare `npx eslint`).
- **Read files with the Read tool, not `cat`** — the RTK hook elides lines from `cat` output.

## Review Focus

Inputs and conditions the spec implies that no feature test would naturally hit. Each has its test in the named task.

1. **An edit made while a save is in flight** (the original bug). The second batch must wait, then go out against the version the first returned — never the stale one, never reordered, never lost. → Task 15, `save-queue.test.ts` "queues behind an in-flight save".
2. **Typed sizes the way people type them:** `"2,5"`, `" 3 "`, `"3.25"`, `"abc"`, `""`, `"0"`, `"-1"`, `"1.234"`. Comma is a decimal point; empty means "leave as is"; the rest are refused in Hebrew and never reach the server as `NaN`. → Task 8, `metres.test.ts`.
3. **An undo that names an item that is gone** — removed by the other lead and reloaded after a conflict. Applying an update or remove for a missing id is a no-op that is reported, not a crash. → Task 9, `ops.test.ts` "skips ops on missing items".
4. **A map with no items, and a map whose items are all outside the plot** (after the plot shrank). Fit still frames something sensible, the checks bar says "הכול תקין" or counts the outside ones, labels and the minimap do not throw. → Task 12 (`fitRect` of an empty union), Task 24 (checks bar with an empty doc).
5. **Labels crowded past what fits** — twenty same-kind items in a row at the lowest zoom. No two placed rectangles intersect, every group gets at most one label, and the layout finishes in under 5 ms for 200 inputs. → Task 13, `label-layout.test.ts` "survives a crowd".

## Task index

| # | Task | File |
|---|---|---|
| 1 | Branch ready: `three` in, R1 exception recorded, import guard | 01 |
| 2 | Schema and migration `0012` | 01 |
| 3 | Kind presets gain height, plural and shape; effective defaults | 01 |
| 4 | Geometry: turn about centre, union, gaps | 01 |
| 5 | Editor model types and op validation | 01 |
| 6 | Server readers: plan version and north, item height and lock, kind defaults, `loadDoc` | 01 |
| 7 | `applySiteOps`, `saveSiteChangesAction`, `loadSiteDocAction`, Hebrew refusals | 01 |
| 8 | `metres.ts` — typed metres in, centimetres out | 02 |
| 9 | `ops.ts` — apply, invert, coalesce | 02 |
| 10 | `commands.ts` — every edit as ops | 02 |
| 11 | `history.ts`, `snapping.ts`, `placement.ts` | 02 |
| 12 | `camera.ts` — projection, ground point, fit, zoom, orbit | 02 |
| 13 | `label-layout.ts` | 02 |
| 14 | `sun.ts` | 02 |
| 15 | `save-queue.ts` | 03 |
| 16 | `use-editor-store.ts` | 03 |
| 17 | `palette.ts`, `meshes.ts`, `scene-sync.ts` | 03 |
| 18 | `camera-rig.ts`, `picking.ts` (+ projection cross-check) | 03 |
| 19 | `gestures.ts` | 03 |
| 20 | `SceneView`, `LabelsLayer`, bare editor at `/site?editor=3d`, first browser check | 03 |
| 21 | `SiteEditor` shell: toolbar, save status, conflict banner, keyboard | 04 |
| 22 | Library and objects panels | 04 |
| 23 | Inspector: plot, one item, several items | 04 |
| 24 | Checks bar, view controls, minimap, selection bar, shortcuts card, toasts | 04 |
| 25 | Shade by hour: sun card, sun light, north in the plot drawer | 04 |
| 26 | The page switches over; the board, item drawer and remove page retire; PNG export | 04 |
| 27 | Browser verification, full suite, collab docs, PR body | 04 |

## Interface contract (binding for plans 02–04)

Every module below is named once, here, with its exact exports. A task that
produces one of these implements exactly this surface; a task that consumes one
uses exactly these names. A change to a signature is a change to this section
first. Types from plan 01: `EditorItem`, `EditorPlot`, `EditorDoc`, `rectOf`,
`findItem`, `nextLabel` (`src/lib/site/editor/model.ts`); `ItemPatch`, `SiteOp`,
`SaveResult`, `opRefusal`, `patchRefusal`, `MAX_SIDE_CM`, `MAX_HEIGHT_CM`
(`editor/ops.ts`); `KindSize`, `KindDefaults`, `presetSize`, `effectiveSize`,
`isCustomised`, `itemHeight` (`src/lib/site/defaults.ts`); `SiteKindShape`,
`SITE_KINDS[kind].{label,plural,group,shape,widthCm,depthCm,heightCm}`,
`KIND_ORDER`, `KIND_GROUP_ORDER`, `KIND_GROUP_LABELS`, `SiteKindGroup`
(`kinds.ts`); `Rect {x,y,width,depth}`, `Plot {widthCm,depthCm}`, `Handle`,
`HANDLES`, `resize`, `snap`, `overlap`, `contains`, `overlapPairs`,
`shadedRect`, `metres`, `formatSize`, `turnAboutCentre`, `unionRect`, `Gap`,
`gapsAround` (`geometry.ts`); `derive`, `toPlaced` (`derive.ts`).

### Pure core — `src/lib/site/editor/` (plan 02; no `three`, no React, no DOM)

```ts
// metres.ts — Task 8
/** "2,5" and " 2.5 " → 250. "" → null (leave as is). Up to two decimals, optional leading "-". Anything else → 'invalid'. */
export function parseMetres(text: string): number | null | 'invalid';

// ops.ts — Task 9 adds (Task 5 made the types and refusals)
export function applyOps(doc: EditorDoc, ops: readonly SiteOp[]): { doc: EditorDoc; skipped: SiteOp[] };
  // pure; an update/remove naming a missing id, or an add of an existing id, is skipped and returned — never thrown
export function invertOps(doc: EditorDoc, ops: readonly SiteOp[]): SiteOp[];
  // the ops that take applyOps(doc, ops).doc back to doc, in reverse order
export function coalesceOps(ops: readonly SiteOp[]): SiteOp[];
  // merges updates to one id; add+updates → one add; add…remove → nothing; keeps first-seen order

// commands.ts — Task 10. Every function is pure, returns [] when nothing would change,
// and skips locked items for anything that moves, resizes, turns or removes.
export function moveOps(doc: EditorDoc, ids: readonly string[], dxCm: number, dyCm: number): SiteOp[];
export function setRectOps(doc: EditorDoc, id: string, rect: { xCm: number; yCm: number; widthCm: number; depthCm: number }): SiteOp[];
export function turnOps(doc: EditorDoc, ids: readonly string[]): SiteOp[];                      // turnAboutCentre per item
export function addOps(doc: EditorDoc, kind: SiteItemKind, at: { xCm: number; yCm: number }, id: string): SiteOp[];
  // effectiveSize(kind, doc.defaults); heightCm null; insetCm from the size (nets); sort = max+1; label = nextLabel
export function removeOps(doc: EditorDoc, ids: readonly string[]): SiteOp[];
export function duplicateOps(doc: EditorDoc, ids: readonly string[], newId: () => string): { ops: SiteOp[]; ids: string[] };
  // shifts the group east by its width + 100, else south, west, north, else (+100,+100); copies unlocked; labels via nextLabel
export function lockOps(doc: EditorDoc, ids: readonly string[], locked: boolean): SiteOp[];
export function patchOps(doc: EditorDoc, id: string, patch: ItemPatch): SiteOp[];
  // [] when the patch changes nothing, or touches xCm/yCm/widthCm/depthCm/kind/insetCm on a locked item without locked:false
export function resizeKindOps(doc: EditorDoc, ids: readonly string[], kind: SiteItemKind,
  size: { widthCm?: number; depthCm?: number; heightCm?: number }): SiteOp[];                    // each resized about its own centre
export function resetSizeOps(doc: EditorDoc, ids: readonly string[]): SiteOp[];                 // back to effectiveSize, heightCm → null
export function setKindDefaultOps(doc: EditorDoc, kind: SiteItemKind, size: KindSize | null): SiteOp[];
export type Alignment = 'west' | 'centreX' | 'east' | 'north' | 'centreY' | 'south';
export function alignOps(doc: EditorDoc, ids: readonly string[], how: Alignment): SiteOp[];     // needs ≥ 2 unlocked
export function distributeOps(doc: EditorDoc, ids: readonly string[], axis: 'x' | 'y'): SiteOp[]; // needs ≥ 3 unlocked
export function rowOps(doc: EditorDoc, ids: readonly string[], gapCm: number): SiteOp[];        // west→east from the union's corner
export function uniformSize(doc: EditorDoc, ids: readonly string[], kind: SiteItemKind):
  { widthCm: number | null; depthCm: number | null; heightCm: number | null };                 // null = mixed; heights via itemHeight

// history.ts — Task 11
export interface HistoryEntry { label: string; ops: SiteOp[]; inverse: SiteOp[] }
export interface History { past: HistoryEntry[]; future: HistoryEntry[] }
export const EMPTY_HISTORY: History;
export function record(history: History, entry: HistoryEntry, limit?: number): History;        // default 100; clears future
export function undo(history: History): { history: History; ops: SiteOp[]; label: string } | null;  // ops = entry.inverse
export function redo(history: History): { history: History; ops: SiteOp[]; label: string } | null;  // ops = entry.ops

// snapping.ts — Task 11
export interface GuideLine { from: [number, number]; to: [number, number] }
export interface SnapInput { moving: Rect; others: readonly Rect[]; plot: Plot; dxCm: number; dyCm: number;
  gridCm: number; thresholdCm: number; free: boolean }
export interface SnapResult { dxCm: number; dyCm: number; guides: GuideLine[] }
export function snapMove(input: SnapInput): SnapResult;       // grid first, then the nearest edge/centre within threshold; free → raw, rounded
export function snapResize(rect: Rect, handle: Handle, dxCm: number, dyCm: number, gridCm: number, free: boolean): Rect;

// placement.ts — Task 11
export function nearestFreeSpot(doc: EditorDoc, kind: SiteItemKind, size: { widthCm: number; depthCm: number },
  near: { xCm: number; yCm: number }): { xCm: number; yCm: number } | null;    // grid steps; nets ignore obstacles

// camera.ts — Task 12. Map coordinates: cm, x east, y south, z up. Angles in degrees.
export type ViewMode = 'plan' | '3d';
export type Vec3 = [number, number, number];
export interface CameraState { targetX: number; targetY: number; distance: number; yaw: number; pitch: number }
export interface Viewport { width: number; height: number }
export interface ScreenBox { l: number; t: number; r: number; b: number }
export const FOV_DEG = 30, PITCH_MIN = 18, PITCH_MAX = 89, DISTANCE_MIN = 250, DISTANCE_MAX = 40_000;
export interface CameraFrame { eye: Vec3; target: Vec3; right: Vec3; up: Vec3; forward: Vec3; focalPx: number; orthoHalfHeight: number }
export function cameraFrame(state: CameraState, viewport: Viewport, mode: ViewMode): CameraFrame;
  // plan: pitch treated as 90, orthographic, orthoHalfHeight = distance · tan(FOV/2); yaw 0 = north up
export function project(state: CameraState, viewport: Viewport, mode: ViewMode, point: Vec3): { x: number; y: number; depth: number } | null;
export function groundAt(state: CameraState, viewport: Viewport, mode: ViewMode, sx: number, sy: number, planeZ?: number): [number, number] | null;
export function zoomAt(state: CameraState, viewport: Viewport, mode: ViewMode, sx: number, sy: number, factor: number): CameraState;
export function panBy(state: CameraState, dxCm: number, dyCm: number): CameraState;
export function orbit(state: CameraState, dYaw: number, dPitch: number): CameraState;             // pitch clamped to [PITCH_MIN, PITCH_MAX]
export function fitRect(rect: Rect | null, yaw: number, pitch: number, viewport: Viewport, mode: ViewMode,
  safe: ScreenBox, plot: Plot): CameraState;                                                        // null → the plot
export function interpolate(a: CameraState, b: CameraState, t: number): CameraState;              // shortest yaw, log distance
export function screenArrowToMap(yaw: number, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'): [number, number];
export function pxPerCm(state: CameraState, viewport: Viewport): number;

// label-layout.ts — Task 13
export interface LabelInput { id: string; text: string; width: number; height: number; anchor: [number, number];
  box: ScreenBox; priority: number; groupKey: string | null; groupNoun: string | null; isNet: boolean }
export interface PlacedLabel { key: string; ids: string[]; text: string; rect: ScreenBox; anchor: [number, number];
  leader: boolean; group: boolean; slot: string }
export interface LayoutOptions { bounds: ScreenBox; obstacles: readonly ScreenBox[]; previous: ReadonlyMap<string, string>;
  measure: (text: string) => number; labelHeight: number }
export function layoutLabels(inputs: readonly LabelInput[], options: LayoutOptions): PlacedLabel[];
  // group text is `${count} ${groupNoun}`; slots 'in','n','s','e','w','ne','nw','se','sw','nn','ss'; previous: key → slot

// sun.ts — Task 14
export const CAMP_SITE: { readonly latitude: 30.6154; readonly longitude: 34.7988 };
export interface SunPosition { azimuthDeg: number; elevationDeg: number }
export function sunPosition(instant: Date, latitude: number, longitude: number): SunPosition;
export function jerusalemInstant(date: string, hour: number): Date;               // 'YYYY-MM-DD', fractional clock hour in Asia/Jerusalem
export function mapDirection(bearingDeg: number, northDeg: number): [number, number];  // unit map vector for a compass bearing
export function sunDirection(sun: SunPosition, northDeg: number): Vec3;             // unit vector toward the sun
export function shadowOffset(sun: SunPosition, northDeg: number, heightCm: number): { dxCm: number; dyCm: number } | null;
export interface ShadeAtHour { under: number; full: number; partial: number; sun: number }
export function shadeAtHour(doc: EditorDoc, sun: SunPosition): ShadeAtHour | null;  // null when the sun is down
```

### Store and scene — `src/app/(admin)/site/editor/` (plan 03)

```ts
// save-queue.ts — Task 15 (no React)
export type SaveFn = (baseVersion: number, ops: SiteOp[]) => Promise<SaveResult>;
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';
export interface QueueSnapshot { status: SaveStatus; version: number; pending: number; error: string | null }
export interface SaveQueueOptions { send: SaveFn; version: number; delayMs?: number;           // default 500
  onChange: (snapshot: QueueSnapshot) => void;
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void } }
export class SaveQueue {
  constructor(options: SaveQueueOptions);
  enqueue(ops: readonly SiteOp[]): void;        // coalesces; schedules a send after delayMs
  flush(): Promise<void>;                        // sends now; one request in flight, later ops wait and go against the returned version
  retry(): Promise<void>;                        // after 'error'
  reset(version: number): void;                  // 'theirs': drop pending, adopt version, status 'saved'
  rebase(version: number, keep: readonly SiteOp[]): void;  // 'mine': pending := keep, version := version, flush
  pendingOps(): SiteOp[];
  readonly snapshot: QueueSnapshot;
  dispose(): void;
}
// A network failure (send throws) → status 'error', error 'השמירה נכשלה, אולי אין חיבור. אפשר לנסות שוב.'

// use-editor-store.ts — Task 16
export interface EditorFlags { outside: Set<string>; overlapping: Set<string>; partly: Set<string>; pairs: Array<[string, string]> }
export interface EditorStoreInit { doc: EditorDoc; version: number; selection?: string[]; save: SaveFn;
  load: () => Promise<ActionResult<{ doc: EditorDoc; version: number }>> }
export interface EditorStore {
  doc: EditorDoc; selection: string[]; flags: EditorFlags;
  canUndo: boolean; canRedo: boolean;
  save: QueueSnapshot; conflict: { version: number } | null; notice: string | null;
  run(label: string, ops: SiteOp[], selection?: string[]): void;   // applies, records history (with invertOps), enqueues
  undo(): string | null; redo(): string | null;                   // the entry's label, for a toast
  select(ids: string[]): void;
  resolveConflict(choice: 'theirs' | 'mine'): Promise<void>;
  retrySave(): void;
  dismissNotice(): void;
}
export function useEditorStore(init: EditorStoreInit): EditorStore;

// scene/palette.ts — Task 17 (scoped scene colours, light and dark)
export type SceneTheme = 'light' | 'dark';
export const SCENE_PALETTE: Record<SceneTheme, { outside: string; plot: string; gridMinor: string; gridMajor: string;
  fence: string; edge: string; selected: string; hover: string; bad: string; warn: string; cloth: string; clothEdge: string;
  shadeGround: string; guide: string; groups: Record<SiteKindGroup, string> }>;

// scene/meshes.ts — Task 17
export const CM: 0.01;
export function worldOf(xCm: number, yCm: number, zCm: number): THREE.Vector3;   // three: (x, z, y) in metres
export interface ItemLook { theme: SceneTheme; state: 'normal' | 'hover' | 'selected'; issue: 'none' | 'outside' | 'overlapping' }
export function geometryKey(item: EditorItem, heightCm: number): string;
export function buildItemObject(item: EditorItem, heightCm: number, look: ItemLook): THREE.Group;  // userData { id, isNet, key }
export function restyleItemObject(object: THREE.Group, look: ItemLook): void;
export function buildGround(plot: EditorPlot, theme: SceneTheme): THREE.Group;
export function disposeObject(object: THREE.Object3D): void;

// scene/scene-sync.ts — Task 17
export interface SyncInput { doc: EditorDoc;
  preview: ReadonlyMap<string, { xCm: number; yCm: number; widthCm: number; depthCm: number }>;
  selection: ReadonlySet<string>; hover: string | null;
  flags: { outside: ReadonlySet<string>; overlapping: ReadonlySet<string> };
  hiddenGroups: ReadonlySet<SiteKindGroup>; netsHidden: boolean; theme: SceneTheme }
export class SceneSync { readonly root: THREE.Group; sync(input: SyncInput): void; objectOf(id: string): THREE.Group | undefined;
  solidObjects(): THREE.Object3D[]; netObjects(): THREE.Object3D[]; dispose(): void }

// scene/camera-rig.ts — Task 18
export class CameraRig { readonly perspective: THREE.PerspectiveCamera; readonly orthographic: THREE.OrthographicCamera;
  apply(state: CameraState, viewport: Viewport, mode: ViewMode): THREE.Camera }
// scene/picking.ts — Task 18
export function pickItemId(camera: THREE.Camera, sync: SceneSync, sx: number, sy: number, viewport: Viewport): string | null;  // solids first, then nets

// scene/gestures.ts — Task 19 (no three import needed; pure state machine)
export interface PointerInput { x: number; y: number; button: number; shift: boolean; meta: boolean; ctrl: boolean; alt: boolean }
export interface GestureWorld { tool(): 'select' | 'measure'; mode(): ViewMode; handleAt(x: number, y: number): Handle | null;
  labelAt(x: number, y: number): { ids: string[]; group: boolean } | null;
  itemAt(x: number, y: number): { id: string; isNet: boolean; locked: boolean } | null;
  groundAt(x: number, y: number): [number, number] | null; selection(): readonly string[] }
export type GestureIntent =
  | { type: 'select'; ids: string[] } | { type: 'toggleSelect'; id: string } | { type: 'clearSelection' }
  | { type: 'panBy'; dxCm: number; dyCm: number } | { type: 'orbitBy'; dYaw: number; dPitch: number }
  | { type: 'movePreview'; ids: string[]; dxCm: number; dyCm: number; free: boolean }
  | { type: 'moveCommit'; ids: string[]; dxCm: number; dyCm: number; free: boolean }
  | { type: 'resizePreview'; id: string; handle: Handle; dxCm: number; dyCm: number; free: boolean }
  | { type: 'resizeCommit'; id: string; handle: Handle; dxCm: number; dyCm: number; free: boolean }
  | { type: 'marquee'; box: ScreenBox; base: string[] } | { type: 'marqueeEnd' }
  | { type: 'measure'; from: [number, number]; to: [number, number] }
  | { type: 'zoomToIds'; ids: string[] } | { type: 'lockedNotice' }
  | { type: 'hover'; id: string | null; cursor: string };
export class Gestures { constructor(world: GestureWorld); down(p: PointerInput): GestureIntent[]; move(p: PointerInput): GestureIntent[];
  up(p: PointerInput): GestureIntent[]; cancel(): GestureIntent[] }

// scene/scene-view.tsx — Task 20 (loaded with next/dynamic, ssr:false, from site-editor.tsx)
export interface EditorUi { tool: 'select' | 'measure'; mode: ViewMode; labels: boolean; sun: boolean; netsHidden: boolean;
  snap: boolean; hiddenGroups: SiteKindGroup[]; hour: number; theme: SceneTheme }
export interface ViewInfo { yaw: number; zoomPct: number; pxPerM: number; groundCorners: Array<[number, number]>;
  selectionBox: ScreenBox | null; moving: boolean }
export interface Insets { left: number; right: number; top: number; bottom: number }
export interface SceneHandle { fitAll(): void; fitIds(ids: readonly string[]): void; zoomBy(factor: number): void;
  rotateView(dir: 1 | -1): void; northUp(): void; centreGround(): [number, number] | null;
  groundAtClient(clientX: number, clientY: number): [number, number] | null;
  setGhost(ghost: { kind: SiteItemKind; xCm: number; yCm: number } | null): void; jumpTo(xCm: number, yCm: number): void;
  exportPng(): string | null }
export interface SceneViewProps { store: EditorStore; ui: EditorUi; insets: Insets; sunDate: string | null;
  onView: (info: ViewInfo) => void; onNotice: (message: string) => void; onModeSettled?: (mode: ViewMode) => void }
export const SceneView: React.ForwardRefExoticComponent<SceneViewProps & React.RefAttributes<SceneHandle>>;
// scene/labels-layer.tsx — Task 20
export interface LabelsLayerHandle { update(placed: readonly PlacedLabel[], selection: ReadonlySet<string>): void }
export const LabelsLayer: React.ForwardRefExoticComponent<React.RefAttributes<LabelsLayerHandle>>;
```

### Panels and page — `src/app/(admin)/site/editor/` (plan 04)

```ts
// keyboard.ts — Task 21 (pure; reads KeyboardEvent.code so a Hebrew layout works)
export type Shortcut = 'undo' | 'redo' | 'duplicate' | 'selectAll' | 'escape' | 'remove' | 'turn' | 'lock'
  | 'toolSelect' | 'toolMeasure' | 'fit' | 'plan' | '3d' | 'viewLeft' | 'viewRight' | 'zoomIn' | 'zoomOut' | 'keys'
  | { arrow: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'; big: boolean };
export function shortcutFor(event: { code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): Shortcut | null; // null whenever Alt is held — Alt combinations stay the browser's (Task 21 review)

// site-editor.tsx — Task 21 (client; the only importer of SceneView, via next/dynamic ssr:false)
export interface SiteEditorProps { initial: { doc: EditorDoc; version: number }; initialSelection: string | null;
  seasonName: string; sunDate: string | null; buildTasks: ReadonlyArray<{ id: string; title: string }>;
  plotHref: string; seasonDateHref: string } // seasonDateHref: `views.ts` seasonDateHref — the shell's ?act=season-date drawer (SD4)
export function SiteEditor(props: SiteEditorProps): ReactElement;

// panels/*.tsx — Tasks 21–25, one component per file, all client:
// editor-icons.tsx   EditorIcon({ name: EditorIconName; size?: 14 | 16 }), EditorIconName =
//   'undo'|'redo'|'turn'|'lock'|'magnet'|'ruler'|'pointer'|'cube'|'plan'|'tag'|'eyeOff'|'minus'|'fit'|'rotateLeft'|'rotateRight'
//   |'help'|'alignWest'|'alignCentreX'|'alignEast'|'alignNorth'|'alignCentreY'|'alignSouth'|'distributeX'|'distributeY'|'row'
// toolbar.tsx        Toolbar({ ui, onUi, canUndo, canRedo, onUndo, onRedo })
// save-status.tsx    SaveStatus({ snapshot, onRetry }), ConflictBanner({ busy, onTheirs, onMine })
// library-panel.tsx  LibraryPanel({ defaults, onActivate(kind), onDragMove(kind, clientX, clientY), onDrop(kind, clientX, clientY), onDragCancel() })
// objects-panel.tsx  ObjectsPanel({ items, selection, flags, hiddenGroups, netsHidden, onPick(id, additive), onPickIds(ids), onToggleGroup(group), onShowLibrary?() })
//                    — a group's count is a button selecting the rows it counts (G1); netsHidden marks a net's row hidden (G2);
//                      onShowLibrary gives the empty list's invitation its button. SiteEditor passes its one pickIds, which
//                      shows hidden groups and nets before it selects and fits — the inspectors and the checks bar use it too.
// side-panel.tsx     SidePanel({ tab, onTab, library: ReactNode, objects: ReactNode, count })
// inspector-plot.tsx PlotInspector({ doc, flags, plotHref, onPickIds(ids) })
// inspector-item.tsx ItemInspector({ doc, item, flags, buildTasks, onRun(label, ops), onPickIds(ids) })
// inspector-multi.tsx MultiInspector({ doc, ids, onRun(label, ops), onPickIds(ids) })   — onPickIds required: a kind's chip selects that kind (P9)
// checks-bar.tsx     ChecksBar({ doc, flags, onGo(ids) })
// view-controls.tsx  ViewControls({ info, northDeg, keysOpen, onZoom(factor), onFit(), onRotate(dir), onNorth(), onKeys() })
//                    — northDeg required (N1): the needle is drawn at yaw − northDeg, pointing to true north
// minimap.tsx        Minimap({ doc, flags, selection, info, onJump(xCm, yCm) })       — SVG, testable in jsdom
// selection-bar.tsx  SelectionBar({ box, locked, onTurn, onDuplicate, onLock, onRemove })
//                    — wraps SelectionActions({ locked, labelled, onTurn, onDuplicate, onLock, onRemove }), no prop added:
//                      the bar's inverted colours reach its buttons by element (`.selBar button`)
// shortcuts-card.tsx ShortcutsCard({ onClose })
// sun-card.tsx       SunCard({ hour, onHour, summary, northDeg, plotHref, dateHref, sunDate })
//                    — dateHref: the season's opening date (SD4); with no day the card invites one and links there,
//                      with a day the date itself links there
// Styles (rulings W2, W10): editor.module.css holds the shell only (layout, tool row, save state, banners, the .cards
// stack); each panel keeps its own panels/<name>.module.css; the chrome they share (.panel .body .card .cardHead .hint
// .meta .invite .link .g_* .swatch .stack .search .searchInput .issueDot .iconButton) is panels/panel.module.css.
```

### Amendments recorded after plan 02 was written (additive; binding)

- `metres.ts` also exports `readMetres(text, range): MetresReading` (returns a Hebrew refusal, never throws), `MetresRange`, `SIDE_RANGE`, `HEIGHT_RANGE`, `POSITION_RANGE`, `GAP_RANGE`, `NOT_A_LENGTH`. Panels use `readMetres` for every typed length — no panel writes its own length refusal. `parseMetres` accepts ".5" and strips bidi marks.
- `addOps`: `at` is the new item's north-west corner.
- `duplicateOps`: a locked item may be copied; the copy is unlocked and keeps `taskId` and `notes`.
- `rowOps` needs ≥ 2 unlocked items, like `alignOps`.
- `patchOps` normalises like the server's `patchSet` (trimmed label, blank notes → null, net ⇔ inset) and drops unchanged fields before the lock check.
- `resizeKindOps` does not write a height equal to the one the item already shows (keeps "ברירת מחדל"); `resetSizeOps` also resets a net's inset.
- `record()` ignores an entry with no ops (and keeps the redo stack).
- `layoutLabels`: higher `priority` places first, ties in input order; a group's key is `group:<sorted ids>`; grouping needs `groupKey`, `groupNoun` and `isNet: false`; the caller drops items under 3 px and appends the selected item's size to its text; a crowded group may end with no label.
- `camera`: plan-mode `project` never returns null; yaw normalised to [0, 360); `fitRect` clamps pitch, keeps 300 cm of height in view in 3D, and uses the whole viewport when `safe` is empty.
- `sun`: `jerusalemInstant` reads DST from the tz database via `Intl`; a malformed date throws `a sun date must be YYYY-MM-DD` (callers pass `startsOn`, so only a code bug reaches it).
- `applyOps` inserts an add in (sort, id) order, so an undone removal returns to its place. The server keeps the client's `sort` on add (ruling during Task 7; `newItemRefusal` requires a whole number ≥ 0), so client and server agree on draw order.
- One lock rule, in one file: `ops.ts` exports `LOCKED_FIELDS` (`xCm`, `yCm`, `widthCm`, `depthCm`, `heightCm`, `kind`, `insetCm`) and `lockRefusal(locked, patch)`. `commands.ts` (`patchOps` and every geometry command) and `plan.ts` both use them; neither declares its own list. Height counts as a size, so a locked item's height cannot change.
- An empty batch saves nothing and keeps the version; `setPlot` bumps the version, so an editor open during a plot change gets a conflict instead of saving over a stale plot. `saveSiteChangesAction` does not call `revalidatePath`.
- Test files do not import fixtures from other test files (that re-registers their tests); each has its own small fixture.

### Amendments recorded after plan 03 was written (additive; binding)

- `save-queue.ts` also exports `NETWORK_FAILURE` (the Hebrew network-failure message). After a conflict `snapshot.version` is the server's version, and `retry()` is inert until `reset`/`rebase`.
- `EditorStore.conflict` is derived from `save.status`; `resolveConflict('theirs')` doubles as "reload" after a refused batch. The `beforeunload` guard is armed while `save.pending > 0` (covers refused/conflict too, spec §6.3).
- `palette.ts` gains `ember`, `contact`, `SCENE_ALPHA`, `SCENE_LIGHT`. `ItemLook.sun?` / `SyncInput.sun?` hide the drawn shade patches when real sun shadows are on. Parts carry `userData` tags; `userData.pick === false` makes a part click-through. Hidden groups and hidden nets are removed and disposed, not made invisible (three's raycaster ignores `visible`).
- `Gestures` gains `active`; double-click and wheel are engine-level (the contract's inputs cannot carry them); a click on a label selects, a drag from a label pans; `moveOps` skips locked items in a moving selection.
- `scene-view.tsx` exports `NO_WEBGL` (the Hebrew notice). Its imperative work lives in `scene/engine.ts` and `scene/overlay.ts`. `setGhost({ xCm, yCm })` is the new item's north-west corner (same as `addOps`'s `at`). The item table under the no-WebGL notice is plan 04's job.
- Labels: the scene code drops items under 3 px and appends the selected item's size; a net's label anchors at the middle of its north edge. A `sunDate` that is not `YYYY-MM-DD` is treated as no date.
- Browser checks: there is no local auth bypass — the checker asks the camp lead to sign in (or for local admin credentials) and stops if `shliff-pg` is down, if migration `0012` is not applied locally, or if no season has a map. Browser checks never save to the shared development database.

### Amendments recorded after plan 04 was written (additive; binding)

- `keyboard.ts` also exports `Arrow` and `ZOOM_IN = 0.8` (a distance multiplier — under 1 is closer, as `zoomAt` expects). Q turns the view right and E left (as in the mock).
- `SiteEditorProps.fallback?: ReactNode` carries the item table. `SiteEditor` probes WebGL once; without it, it renders `SceneView` (for its `NO_WEBGL` notice) with the table under it. It never imports `NO_WEBGL` statically — a static import of `scene-view.tsx` would put `three` in the page's first bundle.
- A newer `initial.version` after a plot save: `SiteEditor` is never keyed; with nothing pending it calls `resolveConflict('theirs')`, with pending ops it shows the conflict banner, with a batch in flight it waits for the answer (Task 25).
- `SiteEditor` exposes `SCENE_PALETTE` as `--group-*` / `--scene-*` CSS variables (a static import of `palette.ts`, which must stay free of `three`).
- New panel pieces: `SaveErrorBanner({ message, busy, onReload })`, `panels/selection-actions.tsx` (shared by the inspector footer and `SelectionBar`), `ItemInspector.footer?`, `MultiInspector.footer?`/`onClear?`, `panels/north.ts` (`northText`), pure helpers `scaleFor`, `minimapBounds`, `minimapPoint`, `hourText`; `views.ts` gains `sunDateOf` and `seasonDateHref`; `failure-messages.ts` gains `NORTH_INVALID`.
- Toasts keep the kit's dwell (10 s with an undo), not the spec's 5 s — one timing across the platform. An undo toast undoes only its own history entry (P6): every history change `SiteEditor` makes (an edit from any panel, the keys or the scene — the scene is handed the store with its `run` routed through the same door — an undo, a redo, a reload) takes the open undo toasts away, through the kit's `show`, which returns a dismiss function; a stale ביטול says so instead of undoing. The lock toast counts `ops.length` (P12); the locked sentence is `notices.ts` `LOCKED_NOTICE`, with `LOCKED_ALL_NOTICE` beside it for an all-locked selection (P14).
- The plot drawer is titled "הגדרות המגרש" (it now holds north too).
- An existing season's gate date (`seasons.startsOn`) is edited in the shell's `?act=season-date` drawer (rulings SD1–SD3, the separate season-opening-date branch). The sun card links there (SD4) through `views.ts` `seasonDateHref` / `SEASON_DATE_ACT`: its no-date state invites the date, and a shown date links to it. Until that branch is on main the link opens nothing.
- Task 27's browser check blocks every mutating server action with `page.route` (proven by a test edit) unless the camp lead approves writes; the two-tab conflict check runs only with that approval.

### Amendment recorded during plan 03 execution (Task 15 review)

- `QueueSnapshot` gains `errorKind: 'network' | 'refused' | null`. The top bar offers retry for `network` and the reload for `refused` (plan 04 ruling P8 reads it). `pending === pendingOps().length`, and a batch that failed on the network stays pending (and is resent unchanged against its own base version) until it is answered. A `flush()` begun before `dispose()` finishes sending what waited behind an in-flight batch.
