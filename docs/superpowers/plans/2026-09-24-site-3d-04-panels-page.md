# מפת הקאמפ in 3D — Plan 04: panels and page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every panel around the scene, make the editor the `/site` page, retire the SVG board and its drawers, and verify the whole editor in a browser before the PR.

**Architecture:** `SiteEditor` (a Client Component) owns the store (`useEditorStore`), the `EditorUi` state and the keyboard. It loads `SceneView` through `next/dynamic` with SSR off and drives it only through `EditorUi`, `Insets` and the `SceneHandle` ref. Each panel is one client component under `editor/panels/`, fed from the store and answering with ops built by the pure commands of `src/lib/site/editor/commands.ts`. The page stays a Server Component that loads the map once.

**Tech Stack:** Next.js 16.3.4 (App Router), React 19.2.8, TypeScript, vitest 5 + Testing Library (jsdom), CSS Modules on `src/app/tokens.css`, the Playwright MCP for the browser check (not a dependency).

**Spec:** `docs/superpowers/specs/2026-09-24-site-map-3d-editor-design.md` — §8 (interaction and keyboard), §10 (panels), §11 (shade by hour), §12 (what stays and retires), §13 (the product's rules). **Overview, Review Focus and the binding interface contract:** `2026-09-24-site-3d-00-overview.md`. **Before this file:** plans 01–03 are done, and `/site?editor=3d` renders plan 03's temporary `ScenePreview` (Task 20).

## Global Constraints

Every task's requirements include these. Copied from the overview and `CLAUDE.md`, plus the UI rules this file adds.

- **Units:** every stored length is an integer number of centimetres; metres appear only in typed input and on screen. x grows east, y south. **The map never mirrors for RTL** — neither does a position taken from the scene's screen (the selection bar's `left`/`top`) or an icon that names a compass side (align west is west).
- **Dependencies:** nothing is added. `three` is imported only under `src/app/(admin)/site/editor/scene/**`; the panels and `site-editor.tsx` import from `scene/` only types and `scene/palette.ts` (Task 21 Step 2 proves `palette.ts` has no `three` import).
- **`next/dynamic` with `ssr: false`** only inside a Client Component (`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`, "Skipping SSR") — `site-editor.tsx` is the only such place.
- **Hebrew only on screen.** Every string a lead reads is Hebrew, including `aria-label`, `title` and placeholders. Keycaps use glyphs (`⇧ ⌘ ⌥ ⌫`) and single letters; `esc` is the one Latin word `copy-sweep.test.tsx` allows.
- **Gender-neutral Hebrew:** no gendered imperative; no verb or adjective that must agree with a variable noun. A toast names the item through a fixed noun — "הפריט אוהל 3 נוסף למפה", never "אוהל 3 נוסף"; "לשמור גם כברירת המחדל של אוהל", never "אוהל חדש".
- **Real controls:** `<button>`, `<label>`, `<input>`, `<select>`. Every icon-only button has an `aria-label` (the kit `Button`'s `iconLabel`). A switch carries `aria-pressed` with a label that does not change.
- **CSS:** logical properties only (`inset-inline-start`, `padding-block`, `inline-size`); colours only from `tokens.css`, except the scene's group colours, which `SiteEditor` hands down from `scene/palette.ts` as `--group-*` custom properties (scoped data, like `.viz` in `charts.module.css`). Never `outline: none` (`a11y-sweep.test.tsx`).
- **Every figure links to what changes it; every number says where it came from:** the plot's size, grid and north link to the plot drawer; group counts and problem rows select their items; the plot and inspector panels carry `<SourceChip source={{ kind: 'manual' }} />` ("נרשם ידנית"). Numbers sit in `<bdi>`.
- **Lint rules that bite here** (`eslint-plugin-react-hooks` 7, all errors): no `ref.current` read during render (only in handlers and effects); no `setState` synchronously in an effect body; no `Date.now()`/`Math.random()`/`crypto.randomUUID()` during render. Browser state (theme, width, WebGL) is read with `useSyncExternalStore`. Handlers passed to children are named `on…`.
- **Tests** run with the capped command, always with a unique output file, and only this task's paths:
  `npx vitest run <paths> --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`.
  A non-zero exit with zero failures means workers died, not green. The full suite runs once, in Task 27.
- **Typecheck** with `npx tsc --noEmit`; **lint** with `rtk proxy npx eslint <paths>`.
- **Read files with the Read tool, never `cat`** (the RTK hook elides lines). Count with `node`, never with a hooked `grep | wc -l`.
- **Work in** `/Users/yarin/GitProjects/Shliff_Platform-lanes/site-3d` on `feat/site-map-3d`. Stage by path; never `git add -A`. `git log` only as `/usr/bin/git log`.

## What this plan adds to the contract

All additive, all inside plan 04's own files. Nothing in plans 01–03 changes shape.

| Where | Addition | Why |
|---|---|---|
| `keyboard.ts` | `export type Arrow`, `export const ZOOM_IN = 0.8` | `Shortcut`'s arrow member needs a name; + and − and the view controls share one step, a distance multiplier like `camera.ts` `zoomAt` ("under 1 is closer") |
| `site-editor.tsx` | `SiteEditorProps.fallback?: ReactNode` (Task 26) | the item table the editor shows below 900 px and without WebGL |
| `panels/save-status.tsx` | `SaveErrorBanner({ message, busy, onReload })` | a refused or failed batch shows its Hebrew reason and offers the reload (spec §6.4) |
| `panels/selection-actions.tsx` (new) | `SelectionActions({ locked, labelled, onTurn, onDuplicate, onLock, onRemove })` | one set of turn/duplicate/lock/remove buttons for the inspector footer and the selection bar |
| `panels/inspector-item.tsx`, `inspector-multi.tsx` | `footer?: ReactNode`; `MultiInspector` also `onClear?: () => void` | the footer's actions are SiteEditor's (they toast); clearing a multi-selection from its panel |
| `panels/north.ts` (new) | `northText(northDeg)` | the plot inspector and the sun card say north the same way |
| `panels/view-controls.tsx`, `minimap.tsx`, `sun-card.tsx` | `scaleFor(pxPerM)`, `minimapBounds(doc)`, `minimapPoint(rect, box, x, y)`, `hourText(hour)` | pure helpers beside their components, exported for their tests |
| `src/lib/site/views.ts` | `sunDateOf(startsOn: Date \| null): string \| null` | the gate day as a calendar date in Israel — `SiteEditorProps.sunDate` |
| `failure-messages.ts` | `NORTH_INVALID` | the plot drawer's own pre-flight refusal, in the library's words |

Every typed length in the inspectors — sides, heights, positions, a net's strip, a row's gap — goes through plan 02's `readMetres` with `SIDE_RANGE`, `HEIGHT_RANGE`, `POSITION_RANGE` or `GAP_RANGE` (overview, "Amendments recorded after plan 02"). No panel writes a length refusal of its own. Each test file carries its own small fixture; none imports from another test file or from a shared fixture module.

What this file takes from plan 03 as written (overview, "Amendments recorded after plan 03"): `SceneHandle.zoomBy(f)` hands `f` to `zoomAt`, a distance multiplier — under 1 is closer (`engine.ts`; Task 21 Step 8 re-reads it); `setGhost`'s `xCm`, `yCm` are the new item's north-west corner, like `addOps`'s `at`; `ViewInfo.selectionBox` is in the scene canvas's pixels, which are the stage's; `EditorStore.conflict` follows `save.status`, and `resolveConflict('theirs')` is also the reload after a refused batch; double-click and the wheel are the engine's. Without WebGL, `SceneView` shows `NO_WEBGL` by itself and tells nobody, so `SiteEditor` probes WebGL once (Task 26) to know when to put the item table under that notice — it renders `SceneView` there rather than importing `NO_WEBGL`, because a static import of `scene-view.tsx` would pull `three` into the page's first bundle.

## File map

| File | Task |
|---|---|
| `src/app/(admin)/site/editor/keyboard.ts` (+ `.test.ts`) | 21 |
| `src/app/(admin)/site/editor/site-editor.tsx` (+ `.test.tsx`; `site-editor.no-webgl.test.tsx` in 26) | 21, extended 22–26 |
| `src/app/(admin)/site/editor/editor.module.css` | 21, extended 22–26 |
| `src/app/(admin)/site/editor/panels/editor-icons.tsx`, `toolbar.tsx`, `save-status.tsx` | 21 |
| `src/app/(admin)/site/editor/panels/library-panel.tsx`, `objects-panel.tsx`, `side-panel.tsx` (+ tests) | 22 |
| `src/app/(admin)/site/editor/panels/inspector-plot.tsx`, `inspector-item.tsx`, `inspector-multi.tsx`, `selection-actions.tsx`, `north.ts` (+ tests) | 23 |
| `src/app/(admin)/site/editor/panels/checks-bar.tsx`, `view-controls.tsx`, `minimap.tsx`, `selection-bar.tsx`, `shortcuts-card.tsx` (+ tests) | 24 |
| `src/app/(admin)/site/editor/panels/sun-card.tsx` (+ test), `plot-drawer.tsx` (+ new test), `failure-messages.ts` | 25 |
| `page.tsx`, `page.test.tsx`, `views.ts` (+ test), `actions.ts`, `site.module.css`, `loading.tsx`; delete `site-board.tsx`, `site-board.test.tsx`, `item-drawer.tsx`, `remove-item.tsx` | 21 (wiring), 26 (switch-over) |
| `docs/collab/claims.md`; PR body at `.superpowers/site-3d/pr-body.md` (gitignored) | 27 |

---

### Task 21: `SiteEditor` shell — toolbar, save status, conflict banner, keyboard

**Files:**
- Create: `src/app/(admin)/site/editor/keyboard.ts`, `src/app/(admin)/site/editor/keyboard.test.ts`
- Create: `src/app/(admin)/site/editor/panels/editor-icons.tsx`, `panels/toolbar.tsx`, `panels/save-status.tsx`
- Create: `src/app/(admin)/site/editor/editor.module.css`
- Create: `src/app/(admin)/site/editor/site-editor.tsx`, `src/app/(admin)/site/editor/site-editor.test.tsx`
- Modify: `src/lib/site/views.ts` (add `sunDateOf`), `src/lib/site/views.test.ts` (Task 20 created it; append)
- Modify: `src/app/(admin)/site/page.tsx` (the `?editor=3d` branch renders `SiteEditor`), `src/app/(admin)/site/page.test.tsx`, `src/app/(admin)/site/site.module.css` (append `.editorPage`)
- Modify: `src/app/(admin)/site/editor/scene/scene.module.css` (drop the preview's rules, Task 20's "Task 26 retires it"; and `outline: none` if the a11y sweep names it — Step 15)
- Delete: `src/app/(admin)/site/editor/scene-preview.tsx`

**Interfaces:**
- Consumes: `useEditorStore`, `EditorStore`, `EditorFlags` (`use-editor-store.ts`; `conflict` is derived from `save.status`, and `resolveConflict('theirs')` is also the reload after a refused batch — overview, "Amendments recorded after plan 03"); `QueueSnapshot`, `SaveStatus`, `NETWORK_FAILURE` (`save-queue.ts`); `SceneView`, `EditorUi`, `ViewInfo`, `Insets`, `SceneHandle`, `SceneViewProps` (`scene/scene-view.tsx`); `SCENE_PALETTE`, `SceneTheme` (`scene/palette.ts`); `moveOps`, `turnOps`, `removeOps`, `duplicateOps`, `lockOps` (`commands.ts`); `screenArrowToMap` (`camera.ts`); `findItem`, `EditorDoc`, `EditorItem` (`model.ts`); `saveSiteChangesAction`, `loadSiteDocAction` (`actions.ts`); `loadDoc` (`plan.ts`).
- Produces (contract): `Shortcut`, `shortcutFor` (+ `Arrow`, `ZOOM_IN`); `SiteEditorProps`, `SiteEditor`; `EditorIcon`, `EditorIconName`; `Toolbar`; `SaveStatus`, `ConflictBanner` (+ `SaveErrorBanner`); `editor.module.css`. Also `sunDateOf` (`views.ts`).

- [ ] **Step 1: Read what this task builds on**

Read, with the Read tool: `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md` (the "Skipping SSR" section — `ssr: false` is allowed only in a Client Component), `src/app/(admin)/site/editor/use-editor-store.ts`, `src/app/(admin)/site/editor/save-queue.ts`, `src/app/(admin)/site/editor/scene/scene-view.tsx`, `src/app/(admin)/site/editor/scene/palette.ts`, and `src/app/(admin)/site/page.tsx` as Task 20 left it. Confirm the contract names this task consumes exist with the signatures the overview gives. If one differs, stop and report it — do not adapt this plan's code silently.

- [ ] **Step 2: Prove the palette can be imported without `three`**

`site-editor.tsx` imports `scene/palette.ts` statically for the group colours; `three` must stay in the dynamic chunk.

```bash
cd /Users/yarin/GitProjects/Shliff_Platform-lanes/site-3d
node -e "const s=require('fs').readFileSync('src/app/(admin)/site/editor/scene/palette.ts','utf8');console.log(/from\s+['\"]three/.test(s)?'IMPORTS THREE':'no three import')"
node -e "const s=require('fs').readFileSync('src/app/(admin)/site/editor/scene/engine.ts','utf8');console.log(/from\s+['\"]three/.test(s)?'positive control: engine imports three':'CONTROL FAILED')"
```

Expected: `no three import`, then `positive control: engine imports three` (plan 03's `scene-view.tsx` reaches `three` only through `engine.ts`; the second line proves the check can see an import at all — if it prints `CONTROL FAILED`, the check is blind: read both files before trusting the first line). If the first line prints `IMPORTS THREE`, stop and ask the coordinator: importing it here would put `three` in `/site`'s first bundle.

- [ ] **Step 3: Write the failing keyboard test**

Create `src/app/(admin)/site/editor/keyboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shortcutFor } from './keyboard';

function key(code: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) {
  return shortcutFor({ code, metaKey: false, ctrlKey: false, shiftKey: false, ...mods });
}

describe('the editor’s shortcuts', () => {
  it('are read from where the key is, not from the letter it types', () => {
    // A Hebrew layout types ר on KeyR and ל on KeyL; the code is the same.
    expect(key('KeyR')).toBe('turn');
    expect(key('KeyL')).toBe('lock');
    expect(key('KeyV')).toBe('toolSelect');
    expect(key('KeyM')).toBe('toolMeasure');
    expect(key('KeyF')).toBe('fit');
  });

  it('take ⌘ or Ctrl for undo, redo, duplicate and select all', () => {
    expect(key('KeyZ', { metaKey: true })).toBe('undo');
    expect(key('KeyZ', { ctrlKey: true })).toBe('undo');
    expect(key('KeyZ', { metaKey: true, shiftKey: true })).toBe('redo');
    expect(key('KeyY', { ctrlKey: true })).toBe('redo');
    expect(key('KeyD', { metaKey: true })).toBe('duplicate');
    expect(key('KeyA', { metaKey: true })).toBe('selectAll');
  });

  it('leave every other ⌘ combination to the browser', () => {
    expect(key('KeyR', { metaKey: true })).toBeNull(); // reload
    expect(key('KeyL', { metaKey: true })).toBeNull(); // the address bar
    expect(key('KeyF', { ctrlKey: true })).toBeNull(); // find
    expect(key('Equal', { metaKey: true })).toBeNull(); // page zoom
  });

  it('move by a grid step on an arrow, and by a metre with shift', () => {
    expect(key('ArrowUp')).toEqual({ arrow: 'ArrowUp', big: false });
    expect(key('ArrowLeft', { shiftKey: true })).toEqual({ arrow: 'ArrowLeft', big: true });
  });

  it('switch the view, turn it, zoom it, and open the card', () => {
    expect(key('Digit2')).toBe('plan');
    expect(key('Numpad3')).toBe('3d');
    expect(key('KeyQ')).toBe('viewRight');
    expect(key('KeyE')).toBe('viewLeft');
    expect(key('Equal')).toBe('zoomIn');
    expect(key('Equal', { shiftKey: true })).toBe('zoomIn');
    expect(key('NumpadSubtract')).toBe('zoomOut');
    expect(key('Slash', { shiftKey: true })).toBe('keys');
    expect(key('Escape')).toBe('escape');
    expect(key('Delete')).toBe('remove');
    expect(key('Backspace')).toBe('remove');
  });

  it('ignore everything else, including a code that is an Object property name', () => {
    for (const code of ['KeyX', 'Enter', 'Space', 'Tab', 'Digit1', 'constructor', '']) {
      expect(key(code)).toBeNull();
    }
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run "src/app/(admin)/site/editor/keyboard.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `Failed to resolve import "./keyboard"`.

- [ ] **Step 5: Write `keyboard.ts`**

Create `src/app/(admin)/site/editor/keyboard.ts`:

```ts
/**
 * The editor's keyboard (spec §8), read from `KeyboardEvent.code` — where the
 * key is, not the letter it types — so `R` turns an item on a Hebrew layout,
 * where that key types ר. Pure: `SiteEditor` decides what each shortcut does.
 *
 * With ⌘ or Ctrl held, only the editor's four combinations are taken. Every
 * other one — ⌘R, ⌘L, ⌘F, ⌘+ — stays the browser's.
 */

export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export type Shortcut = 'undo' | 'redo' | 'duplicate' | 'selectAll' | 'escape' | 'remove' | 'turn' | 'lock'
  | 'toolSelect' | 'toolMeasure' | 'fit' | 'plan' | '3d' | 'viewLeft' | 'viewRight' | 'zoomIn' | 'zoomOut' | 'keys'
  | { arrow: Arrow; big: boolean };

/**
 * One step closer, for + and for the view controls' zoom button: what
 * `SceneHandle.zoomBy` is given. A distance multiplier, like `camera.ts`
 * `zoomAt` — under 1 is closer — so a step away is `1 / ZOOM_IN` (checked
 * against `scene-view.tsx` in Task 21 Step 8).
 */
export const ZOOM_IN = 0.8;

const ARROWS: ReadonlySet<string> = new Set<string>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

/** A Map rather than an object literal, so a code such as `constructor` finds nothing. */
const PLAIN = new Map<string, Shortcut>([
  ['Escape', 'escape'], ['Delete', 'remove'], ['Backspace', 'remove'],
  ['KeyR', 'turn'], ['KeyL', 'lock'], ['KeyV', 'toolSelect'], ['KeyM', 'toolMeasure'], ['KeyF', 'fit'],
  ['Digit2', 'plan'], ['Numpad2', 'plan'], ['Digit3', '3d'], ['Numpad3', '3d'],
  // The mock's pairing: Q turns the view to the right, E to the left.
  ['KeyQ', 'viewRight'], ['KeyE', 'viewLeft'],
  ['Equal', 'zoomIn'], ['NumpadAdd', 'zoomIn'], ['Minus', 'zoomOut'], ['NumpadSubtract', 'zoomOut'],
  ['Slash', 'keys'],
]);

export function shortcutFor(
  event: { code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
): Shortcut | null {
  if (event.metaKey || event.ctrlKey) {
    switch (event.code) {
      case 'KeyZ': return event.shiftKey ? 'redo' : 'undo';
      case 'KeyY': return 'redo';
      case 'KeyD': return 'duplicate';
      case 'KeyA': return 'selectAll';
      default: return null;
    }
  }
  if (ARROWS.has(event.code)) return { arrow: event.code as Arrow, big: event.shiftKey };
  return PLAIN.get(event.code) ?? null;
}
```

Run the Step 4 command. Expected: 6 passed.

- [ ] **Step 6: Write `sunDateOf`, test-first**

`src/lib/site/views.test.ts` exists (Task 20). Replace its line `import { parseSiteQuery } from './views';` with:

```ts
import { parseSiteQuery, sunDateOf } from './views';
```

and append to the end of the file:

```ts
describe('the day shade by hour is worked out for', () => {
  it('is the gate day as a calendar date in Israel, not in UTC', () => {
    // 22:30 UTC on 3 June is 01:30 on 4 June in Israel (summer time, UTC+3).
    expect(sunDateOf(new Date('2026-06-03T22:30:00Z'))).toBe('2026-06-04');
    expect(sunDateOf(new Date('2026-06-04T09:00:00Z'))).toBe('2026-06-04');
  });

  it('is nothing when the season has no gate day, rather than a guess', () => {
    expect(sunDateOf(null)).toBeNull();
  });
});
```

Run: `npx vitest run src/lib/site/views.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — the two new tests (`sunDateOf is not a function`); Task 20's one passes.

Append to `src/lib/site/views.ts`:

```ts
/**
 * The day shade by hour is worked out for (spec §11): the season's gate day,
 * as the calendar date it is in Israel. Null when the season has none — the
 * sun card then asks for one rather than guessing a day (§13).
 */
export function sunDateOf(startsOn: Date | null): string | null {
  if (startsOn === null) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(startsOn);
  const part = (type: 'year' | 'month' | 'day') => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
```

Run the same command. Expected: 3 passed.

- [ ] **Step 7: Create the stylesheet**

Create `src/app/(admin)/site/editor/editor.module.css`:

```css
/*
 * The camp map's editor (spec §10). Tokens only, logical properties
 * throughout (A10) — except where a position comes from the scene's own
 * screen coordinates, which are physical, like the map itself.
 *
 * The group colours are the scene's (`scene/palette.ts`). SiteEditor hands
 * them to this tree as `--group-*` custom properties, so a swatch in a panel
 * is the colour of the thing on the map. They are scoped data, like the
 * chart palette in `charts.module.css`'s `.viz`.
 */

.root {
  flex: 1;
  min-block-size: 0;
  display: flex;
  flex-direction: column;
}

.icon { flex-shrink: 0; }

.editorArea {
  flex: 1;
  min-block-size: 0;
  display: flex;
  flex-direction: column;
}

/* ---- save state and banners ------------------------------------------- */

.saveState {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink-3);
  font-size: var(--text-meta);
}

.saveText {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.saveDot {
  inline-size: 7px;
  block-size: 7px;
  border-radius: var(--radius-pill);
  background: var(--ok);
}

.saveState[data-status='pending'],
.saveState[data-status='saving'] { color: var(--brand-text); }
.saveState[data-status='pending'] .saveDot,
.saveState[data-status='saving'] .saveDot { background: var(--brand); }
.saveState[data-status='error'],
.saveState[data-status='conflict'] { color: var(--bad); }
.saveState[data-status='error'] .saveDot,
.saveState[data-status='conflict'] .saveDot { background: var(--bad); }

.banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding-block: var(--space-2);
  padding-inline: var(--space-4);
  border-block-end: 1px solid var(--line);
  background: var(--info-soft);
  color: var(--ink);
  font-size: var(--text-dense);
}
.banner[data-tone='warn'] { background: var(--warn-soft); border-block-end-color: var(--warn-line); }
.banner[data-tone='bad'] { background: var(--bad-soft); }

.bannerText {
  margin: 0;
  flex: 1;
  min-inline-size: 0;
}

.bannerActions {
  display: inline-flex;
  gap: var(--space-2);
}

/* ---- the tool row ------------------------------------------------------ */

.toolRow {
  block-size: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-inline: var(--space-3);
  border-block-end: 1px solid var(--line);
  background: var(--panel);
}

.grow { flex: 1; }

.seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-control);
  background: var(--sunken);
}

.segButton {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  block-size: 28px;
  padding-inline: 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  font-size: var(--text-dense);
  cursor: pointer;
}
.segButton[aria-pressed='true'] {
  background: var(--panel);
  color: var(--ink);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--line);
}

/* A key's own name reads left to right whatever the page's direction. */
.kbd {
  display: inline-flex;
  align-items: center;
  direction: ltr;
  padding-inline: 4px;
  line-height: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--ink-3);
  font-family: inherit;
  font-size: var(--text-label);
  font-weight: 500;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  block-size: 30px;
  padding-inline: 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--ink-2);
  font-size: var(--text-meta);
  white-space: nowrap;
  cursor: pointer;
}
.toggle:hover { background: var(--sunken); color: var(--ink); }
.toggle[aria-pressed='true'] {
  background: var(--brand-soft);
  color: var(--brand-text);
  border-color: var(--line-strong);
  font-weight: 600;
}

/* ---- the stage --------------------------------------------------------- */

.stage {
  position: relative;
  flex: 1;
  min-block-size: 0;
  overflow: hidden;
  background: var(--sunken);
}

.scene {
  position: absolute;
  inset: 0;
}
```

- [ ] **Step 8: Check which way `zoomBy` goes**

Read `zoomBy` in `src/app/(admin)/site/editor/scene/engine.ts`. As plan 03 wrote it, it calls `zoomAt(this.cam, …, factor)`, and `zoomAt` takes a distance multiplier ("under 1 is closer", plan 02 Task 12) — which is what `ZOOM_IN = 0.8` assumes. If the code on disk differs (`f > 1` closer), change `ZOOM_IN` in `keyboard.ts` to `1.25`, its doc comment to "above 1 is closer", and in Step 10's test swap the expectations `toHaveBeenLastCalledWith(0.8)` and `toHaveBeenLastCalledWith(1.25)`; say so in the commit message.

- [ ] **Step 9: Create the icons, the tool row and the save status**

Create `src/app/(admin)/site/editor/panels/editor-icons.tsx`:

```tsx
/**
 * The editor's own glyphs, beside the kit's `Icon` (C14): the kit's set was
 * copied for the shell and has no undo, lock, magnet or align. Same drawing
 * rules — a 24×24 canvas, a 1.75 stroke, `currentColor`, Lucide geometry
 * (ISC) copied from the mock rather than redrawn.
 *
 * None of these mirrors under RTL, unlike the kit's directional icons. They
 * name things on the map, and the map does not mirror: align west is west.
 */
import type { ReactElement } from 'react';
import styles from '../editor.module.css';

const PATHS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
  turn: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  magnet: '<path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/>',
  ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>',
  pointer: '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
  cube: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  plan: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 12h18"/><path d="M12 3v18"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  rotateLeft: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  rotateRight: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  alignWest: '<rect width="6" height="14" x="6" y="5" rx="2"/><rect width="6" height="10" x="16" y="7" rx="2"/><path d="M2 2v20"/>',
  alignCentreX: '<rect width="6" height="14" x="2" y="5" rx="2"/><rect width="6" height="10" x="16" y="7" rx="2"/><path d="M12 2v20"/>',
  alignEast: '<rect width="6" height="14" x="2" y="5" rx="2"/><rect width="6" height="10" x="12" y="7" rx="2"/><path d="M22 2v20"/>',
  alignNorth: '<rect width="14" height="6" x="5" y="6" rx="2"/><rect width="10" height="6" x="7" y="16" rx="2"/><path d="M2 2h20"/>',
  alignCentreY: '<rect width="14" height="6" x="5" y="2" rx="2"/><rect width="10" height="6" x="7" y="16" rx="2"/><path d="M2 12h20"/>',
  alignSouth: '<rect width="14" height="6" x="5" y="2" rx="2"/><rect width="10" height="6" x="7" y="12" rx="2"/><path d="M2 22h20"/>',
  distributeX: '<rect width="6" height="14" x="4" y="5" rx="2"/><rect width="6" height="10" x="14" y="7" rx="2"/><path d="M17 22v-5"/><path d="M17 7V2"/><path d="M7 22v-3"/><path d="M7 5V2"/>',
  distributeY: '<rect width="14" height="6" x="5" y="14" rx="2"/><rect width="10" height="6" x="7" y="4" rx="2"/><path d="M22 7h-5"/><path d="M7 7H2"/><path d="M22 17h-3"/><path d="M5 17H2"/>',
  row: '<path d="M3 7h4v10H3z"/><path d="M10 7h4v10h-4z"/><path d="M17 7h4v10h-4z"/>',
} as const;

export type EditorIconName = keyof typeof PATHS;

export function EditorIcon({ name, size = 16 }: { name: EditorIconName; size?: 14 | 16 }): ReactElement {
  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      /* The only content is a constant in this file; nothing from a request,
         a row or a workbook ever reaches it (the kit's `Icon` does the same). */
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
```

Create `src/app/(admin)/site/editor/panels/toolbar.tsx`:

```tsx
'use client';

/**
 * The 48px tool row (spec §10): select or measure, undo and redo, plan or 3D,
 * and the four switches — labels, shade by hour, hiding the nets, snapping.
 * Each switch is a real button with `aria-pressed` and a label that does not
 * change; each keycap is the key `keyboard.ts` reads.
 */

import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import type { EditorUi } from '../scene/scene-view';
import { EditorIcon } from './editor-icons';
import styles from '../editor.module.css';

export function Toolbar({ ui, onUi, canUndo, canRedo, onUndo, onRedo }: {
  ui: EditorUi;
  onUi: (patch: Partial<EditorUi>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}): ReactElement {
  return (
    <div className={styles.toolRow} role="group" aria-label="כלי העריכה">
      <div className={styles.seg} role="group" aria-label="כלי">
        <button
          type="button"
          className={styles.segButton}
          aria-pressed={ui.tool === 'select'}
          onClick={() => { onUi({ tool: 'select' }); }}
        >
          <EditorIcon name="pointer" size={14} />
          בחירה
          <kbd className={styles.kbd}>V</kbd>
        </button>
        <button
          type="button"
          className={styles.segButton}
          aria-pressed={ui.tool === 'measure'}
          onClick={() => { onUi({ tool: 'measure' }); }}
        >
          <EditorIcon name="ruler" size={14} />
          מדידה
          <kbd className={styles.kbd}>M</kbd>
        </button>
      </div>

      <Button tone="ghost" size="sm" iconLabel="ביטול הפעולה האחרונה" disabled={!canUndo} onClick={onUndo}>
        <EditorIcon name="undo" />
      </Button>
      <Button tone="ghost" size="sm" iconLabel="ביצוע מחדש" disabled={!canRedo} onClick={onRedo}>
        <EditorIcon name="redo" />
      </Button>

      <span className={styles.grow} />

      <div className={styles.seg} role="group" aria-label="תצוגה">
        <button
          type="button"
          className={styles.segButton}
          aria-pressed={ui.mode === 'plan'}
          onClick={() => { onUi({ mode: 'plan' }); }}
        >
          <EditorIcon name="plan" size={14} />
          תוכנית
          <kbd className={styles.kbd}>2</kbd>
        </button>
        <button
          type="button"
          className={styles.segButton}
          aria-pressed={ui.mode === '3d'}
          onClick={() => { onUi({ mode: '3d' }); }}
        >
          <EditorIcon name="cube" size={14} />
          תלת־ממד
          <kbd className={styles.kbd}>3</kbd>
        </button>
      </div>

      <span className={styles.grow} />

      <button type="button" className={styles.toggle} aria-pressed={ui.labels} onClick={() => { onUi({ labels: !ui.labels }); }}>
        <EditorIcon name="tag" size={14} />
        תוויות
      </button>
      <button type="button" className={styles.toggle} aria-pressed={ui.sun} onClick={() => { onUi({ sun: !ui.sun }); }}>
        <Icon name="sun" size={14} />
        צל לפי שעה
      </button>
      <button type="button" className={styles.toggle} aria-pressed={ui.netsHidden} onClick={() => { onUi({ netsHidden: !ui.netsHidden }); }}>
        <EditorIcon name="eyeOff" size={14} />
        הסתרת רשתות צל
      </button>
      <button type="button" className={styles.toggle} aria-pressed={ui.snap} onClick={() => { onUi({ snap: !ui.snap }); }}>
        <EditorIcon name="magnet" size={14} />
        הצמדה
      </button>
    </div>
  );
}
```

Create `src/app/(admin)/site/editor/panels/save-status.tsx`:

```tsx
'use client';

/**
 * Whether the map is saved. The top bar always says one of three things
 * (spec §6.3) — never nothing — and when saving stops, a banner under it says
 * why: a conflict with another lead is a choice between two maps (§6.4); a
 * refusal or a lost connection is a Hebrew reason and a way back.
 */

import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import type { QueueSnapshot, SaveStatus as QueueStatus } from '../save-queue';
import styles from '../editor.module.css';

const SAID: Record<QueueStatus, string> = {
  saved: 'כל השינויים נשמרו',
  pending: 'שומר…',
  saving: 'שומר…',
  error: 'לא נשמר —',
  conflict: 'לא נשמר — המפה שונתה ממקום אחר',
};

export function SaveStatus({ snapshot, onRetry }: {
  snapshot: QueueSnapshot;
  onRetry: () => void;
}): ReactElement {
  return (
    <span className={styles.saveState} data-status={snapshot.status}>
      <span className={styles.saveText} role="status">
        <span className={styles.saveDot} aria-hidden="true" />
        {SAID[snapshot.status]}
      </span>
      {snapshot.status === 'error' ? (
        <Button size="sm" tone="ghost" onClick={onRetry}>ניסיון חוזר</Button>
      ) : null}
    </span>
  );
}

/** Another lead saved since this map was loaded: the lead chooses, nothing is overwritten (§6.4). */
export function ConflictBanner({ busy, onTheirs, onMine }: {
  busy: boolean;
  onTheirs: () => void;
  onMine: () => void;
}): ReactElement {
  return (
    <div className={styles.banner} data-tone="warn" role="alert">
      <p className={styles.bannerText}>
        המפה שונתה ממקום אחר מאז שנפתחה. השינויים האחרונים שלך עוד לא נשמרו.
      </p>
      <span className={styles.bannerActions}>
        <Button size="sm" onClick={onTheirs} disabled={busy}>טעינת הגרסה העדכנית</Button>
        <Button size="sm" onClick={onMine} disabled={busy}>שמירת השינויים שלי מעליה</Button>
      </span>
    </div>
  );
}

/**
 * The batch did not go through. `message` is already Hebrew — the queue's own
 * network sentence, or the server's refusal mapped by `failure-messages.ts`.
 * The retry lives in the top bar's status; this offers the way back.
 */
export function SaveErrorBanner({ message, busy, onReload }: {
  message: string;
  busy: boolean;
  onReload: () => void;
}): ReactElement {
  return (
    <div className={styles.banner} data-tone="bad" role="alert">
      <p className={styles.bannerText}>{message}</p>
      <span className={styles.bannerActions}>
        <Button size="sm" onClick={onReload} disabled={busy}>טעינת הגרסה העדכנית</Button>
      </span>
    </div>
  );
}
```

- [ ] **Step 10: Write the failing editor test**

Create `src/app/(admin)/site/editor/site-editor.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import { unnamedControls } from '@/test/a11y';
import type { EditorDoc, EditorItem, EditorPlot } from '@/lib/site/editor/model';
import { NETWORK_FAILURE } from './save-queue';
import type { SceneHandle, SceneViewProps, ViewInfo } from './scene/scene-view';

/* This file's own fixture: a 26 × 24 m plot on a 50 cm grid, and a 3 × 2 m
   tent at (5 m, 5 m) — not square, so a quarter turn shows. */
function siteItem(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false,
    ...over,
  };
}

function siteDoc(items: EditorItem[], plot: Partial<EditorPlot> = {}): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0, ...plot }, items, defaults: {} };
}

const { saveSiteChangesAction, loadSiteDocAction } = vi.hoisted(() => ({
  saveSiteChangesAction: vi.fn(), loadSiteDocAction: vi.fn(),
}));
vi.mock('../actions', () => ({ saveSiteChangesAction, loadSiteDocAction }));

/**
 * The scene is `three` and WebGL and has its own tests (plan 03). Here it is
 * a stand-in that records what the editor hands it and answers the handle,
 * so the panels and the real store are tested together without a GPU.
 */
const scene = vi.hoisted(() => ({
  props: vi.fn(),
  handle: {
    fitAll: vi.fn(), fitIds: vi.fn(), zoomBy: vi.fn(), rotateView: vi.fn(), northUp: vi.fn(),
    centreGround: vi.fn(), groundAtClient: vi.fn(), setGhost: vi.fn(), jumpTo: vi.fn(), exportPng: vi.fn(),
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

const PLOT_HREF = '/site?season=s26&act=plot';
const VIEW: ViewInfo = { yaw: 0, zoomPct: 100, pxPerM: 20, groundCorners: [], selectionBox: null, moving: false };

/** jsdom has no `matchMedia`; this answers the editor's two questions. */
function stubMedia({ wide = true, dark = false }: { wide?: boolean; dark?: boolean } = {}): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width') ? wide : query.includes('dark') ? dark : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeAll(() => {
  stubMedia();
});

beforeEach(() => {
  vi.clearAllMocks();
  stubMedia();
  saveSiteChangesAction.mockResolvedValue({ ok: true, version: 1 });
  loadSiteDocAction.mockResolvedValue({ ok: false, error: 'המפה לא נטענה' });
  delete document.documentElement.dataset.theme;
});

function renderEditor(over: Partial<SiteEditorProps> = {}) {
  const props: SiteEditorProps = {
    initial: { doc: siteDoc([siteItem({ id: 'a' })]), version: 0 },
    initialSelection: 'a',
    seasonName: 'ברן 26',
    sunDate: '2026-06-04',
    buildTasks: [],
    plotHref: PLOT_HREF,
    ...over,
  };
  const rendered = render(<ToastProvider><SiteEditor {...props} /></ToastProvider>);
  return {
    ...rendered,
    /** The page rendering again with new props — what `router.refresh()` does. */
    rerenderWith: (next: Partial<SiteEditorProps>) => {
      rendered.rerender(<ToastProvider><SiteEditor {...props} {...next} /></ToastProvider>);
    },
  };
}

function lastScene(): SceneViewProps {
  const call = scene.props.mock.lastCall;
  if (call === undefined) throw new Error('the scene never rendered');
  return call[0] as SceneViewProps;
}

const stage = () => screen.getByRole('region', { name: 'מפת הקאמפ' });
const firstItem = () => lastScene().store.doc.items[0];

describe('the editor shell', () => {
  it('mounts the scene with the loaded map, the room the panels leave, and the page’s theme', async () => {
    document.documentElement.dataset.theme = 'dark';
    const { container } = renderEditor();
    await screen.findByTestId('scene');
    const props = lastScene();
    expect(props.store.doc.items.map((item) => item.id)).toEqual(['a']);
    expect(props.store.selection).toEqual(['a']);
    expect(props.insets).toEqual({ left: 316, right: 280, top: 56, bottom: 64 });
    expect(props.ui).toMatchObject({ tool: 'select', mode: '3d', theme: 'dark', sun: false });
    expect(props.sunDate).toBe('2026-06-04');
    expect(screen.getByRole('link', { name: 'הגדרות המגרש' }).getAttribute('href')).toBe(PLOT_HREF);
    expect(unnamedControls(container)).toEqual([]);
  });

  it('flies to the item a deep link names, once, when the scene is up', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    act(() => { lastScene().onView(VIEW); });
    expect(scene.handle.fitIds).toHaveBeenCalledWith(['a']);
    act(() => { lastScene().onView({ ...VIEW, zoomPct: 150 }); });
    expect(scene.handle.fitIds).toHaveBeenCalledTimes(1);
  });
});

describe('saving', () => {
  it('says every change is saved, then that it is saving, then saved again', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    expect(screen.getByText('כל השינויים נשמרו')).toBeTruthy();
    fireEvent.keyDown(stage(), { code: 'KeyR' });
    expect(screen.getByText('שומר…')).toBeTruthy();
    await waitFor(() => {
      expect(saveSiteChangesAction).toHaveBeenCalledWith('p1', 0, expect.any(Array));
    }, { timeout: 3000 });
    expect(await screen.findByText('כל השינויים נשמרו', undefined, { timeout: 3000 })).toBeTruthy();
  });

  it('keeps a retry on screen, with the reason, when the save does not go through', async () => {
    saveSiteChangesAction.mockRejectedValueOnce(new Error('offline'));
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'KeyR' });
    const retry = await screen.findByRole('button', { name: 'ניסיון חוזר' }, { timeout: 3000 });
    expect(screen.getByText('לא נשמר —')).toBeTruthy();
    expect(screen.getByText(NETWORK_FAILURE)).toBeTruthy();
    fireEvent.click(retry);
    expect(await screen.findByText('כל השינויים נשמרו', undefined, { timeout: 3000 })).toBeTruthy();
    expect(saveSiteChangesAction).toHaveBeenCalledTimes(2);
  });

  it('turns a stale version into a choice, and the other lead’s map replaces mine when chosen', async () => {
    saveSiteChangesAction.mockResolvedValue({ ok: false, reason: 'conflict', version: 4 });
    loadSiteDocAction.mockResolvedValue({
      ok: true, value: { doc: siteDoc([siteItem({ id: 'a', xCm: 900 })]), version: 4 },
    });
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'KeyR' });
    expect(await screen.findByText(
      'המפה שונתה ממקום אחר מאז שנפתחה. השינויים האחרונים שלך עוד לא נשמרו.', undefined, { timeout: 3000 },
    )).toBeTruthy();
    // A conflict stops the queue: nothing is resent until the lead chooses.
    expect(saveSiteChangesAction).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'טעינת הגרסה העדכנית' }));
    await waitFor(() => { expect(loadSiteDocAction).toHaveBeenCalledWith('p1'); });
    await waitFor(() => { expect(firstItem()).toMatchObject({ xCm: 900, widthCm: 300 }); });
    expect(screen.queryByText(/המפה שונתה ממקום אחר/)).toBeNull();
  });

  it('resends my changes over the new version when I keep them', async () => {
    saveSiteChangesAction
      .mockResolvedValueOnce({ ok: false, reason: 'conflict', version: 4 })
      .mockResolvedValue({ ok: true, version: 5 });
    loadSiteDocAction.mockResolvedValue({ ok: true, value: { doc: siteDoc([siteItem({ id: 'a' })]), version: 4 } });
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'KeyR' });
    fireEvent.click(await screen.findByRole('button', { name: 'שמירת השינויים שלי מעליה' }, { timeout: 3000 }));
    await waitFor(() => {
      expect(saveSiteChangesAction).toHaveBeenLastCalledWith('p1', 4, expect.any(Array));
    }, { timeout: 3000 });
    expect(await screen.findByText('כל השינויים נשמרו', undefined, { timeout: 3000 })).toBeTruthy();
  });
});

describe('the keyboard', () => {
  it('reads a shortcut by the key’s place, so a Hebrew layout turns the item too', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'KeyR', key: 'ר' });
    expect(firstItem()).toMatchObject({ xCm: 550, yCm: 450, widthCm: 200, depthCm: 300 });
    fireEvent.keyDown(stage(), { code: 'KeyZ', key: 'ז', metaKey: true });
    expect(firstItem()).toMatchObject({ xCm: 500, yCm: 500, widthCm: 300, depthCm: 200 });
    fireEvent.keyDown(stage(), { code: 'KeyZ', key: 'ז', metaKey: true, shiftKey: true });
    expect(firstItem()).toMatchObject({ widthCm: 200, depthCm: 300 });
  });

  it('leaves the browser its own ⌘ shortcuts', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    const reload = createEvent.keyDown(stage(), { code: 'KeyR', metaKey: true });
    fireEvent(stage(), reload);
    expect(reload.defaultPrevented).toBe(false);
    expect(firstItem().widthCm).toBe(300);
  });

  it('nudges by one grid step, and by a metre with shift, relative to the screen', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'ArrowRight' });
    expect(firstItem().xCm).toBe(550);
    fireEvent.keyDown(stage(), { code: 'ArrowDown', shiftKey: true });
    expect(firstItem().yCm).toBe(600);
  });

  it('switches tool and view from the tool row and from the keys', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.click(screen.getByRole('button', { name: /תוכנית/ }));
    expect(lastScene().ui.mode).toBe('plan');
    expect(screen.getByRole('button', { name: /תוכנית/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(stage(), { code: 'Digit3' });
    expect(lastScene().ui.mode).toBe('3d');
    fireEvent.keyDown(stage(), { code: 'KeyM' });
    expect(lastScene().ui.tool).toBe('measure');
    fireEvent.click(screen.getByRole('button', { name: /הצמדה/ }));
    expect(lastScene().ui.snap).toBe(false);
  });

  it('zooms, fits and turns the view through the scene', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'Equal' });
    expect(scene.handle.zoomBy).toHaveBeenLastCalledWith(0.8);
    fireEvent.keyDown(stage(), { code: 'Minus' });
    expect(scene.handle.zoomBy).toHaveBeenLastCalledWith(1.25);
    fireEvent.keyDown(stage(), { code: 'KeyF' });
    expect(scene.handle.fitIds).toHaveBeenLastCalledWith(['a']);
    fireEvent.keyDown(stage(), { code: 'Escape' });
    expect(lastScene().store.selection).toEqual([]);
    fireEvent.keyDown(stage(), { code: 'KeyF' });
    expect(scene.handle.fitAll).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(stage(), { code: 'KeyQ' });
    expect(scene.handle.rotateView).toHaveBeenLastCalledWith(1);
  });

  it('keeps undo and redo in step with the history', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    const undo = screen.getByRole('button', { name: 'ביטול הפעולה האחרונה' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'ביצוע מחדש' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    fireEvent.keyDown(stage(), { code: 'KeyR' });
    expect(undo.disabled).toBe(false);
    fireEvent.click(undo);
    expect(firstItem().widthCm).toBe(300);
    expect(redo.disabled).toBe(false);
    fireEvent.click(redo);
    expect(firstItem().widthCm).toBe(200);
  });
});
```

- [ ] **Step 11: Run it to see it fail**

Run: `npx vitest run "src/app/(admin)/site/editor/site-editor.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `Failed to resolve import "./site-editor"`.

- [ ] **Step 12: Write `site-editor.tsx`**

Create `src/app/(admin)/site/editor/site-editor.tsx`:

```tsx
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
  useCallback, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type RefAttributes,
} from 'react';
import { SeasonChip, TopBar } from '@/components/shell/top-bar';
import { Button, ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toaster';
import { KIND_GROUP_ORDER, SITE_KINDS } from '@/lib/site/kinds';
import { findItem, type EditorDoc, type EditorItem } from '@/lib/site/editor/model';
import { duplicateOps, lockOps, moveOps, removeOps, turnOps } from '@/lib/site/editor/commands';
import { screenArrowToMap } from '@/lib/site/editor/camera';
import { loadSiteDocAction, saveSiteChangesAction } from '../actions';
import { useEditorStore } from './use-editor-store';
import { SCENE_PALETTE, type SceneTheme } from './scene/palette';
import type { EditorUi, Insets, SceneHandle, SceneViewProps, ViewInfo } from './scene/scene-view';
import { shortcutFor, ZOOM_IN, type Arrow, type Shortcut } from './keyboard';
import { Toolbar } from './panels/toolbar';
import { ConflictBanner, SaveErrorBanner, SaveStatus } from './panels/save-status';
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
  const sceneRef = useRef<SceneHandle>(null);
  const flownToPeek = useRef(false);

  const fullUi = useMemo<EditorUi>(() => ({ ...ui, theme }), [ui, theme]);
  /* The sun is drawn only for a real day (spec §13): with no gate date the
     toggle opens the card's invitation, and the scene lights no sun. */
  const sceneUi = useMemo<EditorUi>(() => ({ ...fullUi, sun: fullUi.sun && sunDate !== null }), [fullUi, sunDate]);
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
  // ── end of edits ──────────────────────────────────────────────────────

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

  /** On the editor's root, so a key reaches it from the scene and from every panel (§8). */
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

  const editor = (
    <div className={styles.editorArea}>
      {store.conflict === null ? null : (
        <ConflictBanner
          busy={resolving}
          onTheirs={() => { void resolve('theirs'); }}
          onMine={() => { void resolve('mine'); }}
        />
      )}
      {store.save.status === 'error' && store.save.error !== null ? (
        <SaveErrorBanner
          message={store.save.error}
          busy={resolving}
          onReload={() => { void resolve('theirs'); }}
        />
      ) : null}
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
      <section className={styles.stage} aria-label="מפת הקאמפ" tabIndex={-1}>
        <div className={styles.scene}>
          <SceneView
            ref={sceneRef}
            store={store}
            ui={sceneUi}
            insets={INSETS}
            sunDate={sunDate}
            onView={onView}
            onNotice={onNotice}
          />
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
            <SaveStatus snapshot={store.save} onRetry={() => { store.retrySave(); }} />
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
```

The line `{/* floating panels, over the scene */}` is where Tasks 22–25 insert their panels (each inserts directly above it). Keep it exactly.

- [ ] **Step 13: Run the editor test**

Run the Step 11 command. Expected: 12 passed.

If the three handle tests (`flies to…`, `zooms, fits…`) see no calls on `scene.handle` while the others pass, the ref is not reaching the dynamic component: read `node_modules/next/dist/shared/lib/lazy-dynamic/loadable.js` (it spreads `props` into the `lazy` component, and React 19 carries `ref` in `props`) and report what you find before changing anything.

- [ ] **Step 14: Wire `?editor=3d` to the editor and retire the preview**

Read `src/app/(admin)/site/page.tsx` as Task 20 left it (plan 03, Task 20 Step 11 gives the whole file). Make these edits:

1. Replace the line `import { ScenePreview } from './editor/scene-preview';` with:

```tsx
import { SiteEditor } from './editor/site-editor';
```

2. Replace the three lines

```tsx
import {
  copyHref, itemHref, parseSiteQuery, plotHref, removeItemHref, siteHref, type RawParams,
} from '@/lib/site/views';
```

with:

```tsx
import {
  copyHref, itemHref, parseSiteQuery, plotHref, removeItemHref, siteHref, sunDateOf, type RawParams,
} from '@/lib/site/views';
```

3. Replace Task 20's block — from the comment that begins `/* TEMPORARY (plan 03, Task 20): the bare 3D map behind` down to and including the closing `  }` of its `if (query.editor3d) { … }` — with:

```tsx
  /* The editor behind `?editor=3d`, until Task 26 makes it the page. `loadDoc`
     answers null only if the plan vanished since `siteView` read it; the
     board below is then the honest fallback. The item drawer and the remove
     page do not open over the editor: `?peek=` selects the item instead. */
  if (query.editor3d) {
    const loaded = await loadDoc(db, plan.id);
    if (loaded !== null) {
      /* `?peek=` selects an item when the map loads — only one on this map. */
      const initialSelection = query.peek !== null && loaded.doc.items.some((entry) => entry.id === query.peek)
        ? query.peek
        : null;
      const editorTasks = (await listTasks(db, current.id, { kind: 'build' }))
        .map((task) => ({ id: task.taskId, title: task.title }));
      return (
        <main className={styles.editorPage}>
          <h1 className="sr-only">{`מפת הקאמפ · ${current.name}`}</h1>
          {/* Never keyed on the plot or the version: a remount would drop
              unsaved edits. A newer version reaching the editor is handled
              inside it (Task 25). */}
          <SiteEditor
            initial={loaded}
            initialSelection={initialSelection}
            seasonName={current.name}
            sunDate={sunDateOf(current.startsOn)}
            buildTasks={editorTasks}
            plotHref={plotHref(here)}
          />
          {query.plot ? (
            <PlotDrawer
              seasonId={current.id}
              seasonName={current.name}
              plan={{ id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm, notes: plan.notes }}
              items={items}
              closeHref={closeHref}
            />
          ) : null}
        </main>
      );
    }
  }
```

Append to `src/app/(admin)/site/site.module.css`:

```css
/* The editor's page: the whole panel, no reading measure and no padding —
   the scene is the page (spec §10). Beats the global `main` rule by class. */
.editorPage {
  flex: 1;
  min-block-size: 0;
  display: flex;
  flex-direction: column;
  max-inline-size: none;
  margin: 0;
  padding: 0;
}
```

Now `src/app/(admin)/site/page.test.tsx` (Task 20 left `loadDoc` in the hoisted mocks, a `vi.mock('./editor/scene-preview', …)` and a `describe('behind ?editor=3d', …)` of four tests). Replace the whole `vi.mock('./editor/scene-preview', …)` block, with the comment line above it, with:

```tsx
/* The editor has its own tests, with the scene mocked; here it only has to be handed the right things. */
vi.mock('./editor/site-editor', () => ({
  SiteEditor: (props: {
    initial: { doc: { items: unknown[] }; version: number };
    initialSelection: string | null;
    sunDate: string | null;
    buildTasks: ReadonlyArray<{ id: string; title: string }>;
    plotHref: string;
  }) => (
    <div
      data-testid="editor"
      data-selection={props.initialSelection ?? ''}
      data-sun={props.sunDate ?? ''}
      data-tasks={props.buildTasks.map((task) => task.title).join(',')}
      data-plot={props.plotHref}
    >
      {`editor:${props.initial.doc.items.length}:v${props.initial.version}`}
    </div>
  ),
}));
```

and replace the whole `describe('behind ?editor=3d', () => { … });` block with:

```tsx
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
```

Delete the preview and the styles only it used:

```bash
git rm "src/app/(admin)/site/editor/scene-preview.tsx"
```

In `src/app/(admin)/site/editor/scene/scene.module.css`, delete the comment line `/* The temporary /site?editor=3d page (Task 20; Task 26 retires it). */` and the three rules under it, `.preview`, `.previewScene` and `.previewStatus` (to the end of the file). Then prove nothing still names the preview (expected output: nothing):

```bash
node -e "const fs=require('fs'),p=require('path');const hits=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())w(f);else if(/\.(ts|tsx|css)$/.test(f)&&/scene-preview|ScenePreview|previewScene|previewStatus/.test(fs.readFileSync(f,'utf8')))hits.push(f);}})('src');console.log(hits.join('\n'))"
```

- [ ] **Step 15: Run this task's tests, the guards, typecheck and lint**

Run: `npx vitest run "src/app/(admin)/site/editor/keyboard.test.ts" "src/app/(admin)/site/editor/site-editor.test.tsx" src/lib/site/views.test.ts "src/app/(admin)/site/page.test.tsx" "src/app/(admin)/site/editor/three-guard.test.ts" "src/app/(admin)/copy-sweep.test.tsx" "src/app/(admin)/a11y-sweep.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: all pass, exit 0 — 6 keyboard, 12 editor, 3 views, 17 page (Task 20's 15 with its four `?editor=3d` tests now six), the `three` guard's 2, and both sweeps (no English copy, no unnamed control, no `outline: none`).

The a11y sweep reads every CSS file under `src/`. Plan 03's `scene/scene.module.css` gives `.canvas` an `outline: none` (Task 20 Step 4), which A9 forbids and the sweep names as `src/app/(admin)/site/editor/scene/scene.module.css:<line>`. If it does, delete that one `outline: none;` line — the canvas then shows the global focus ring when it has focus — rerun the command, and keep `scene.module.css` in this task's commit. Do not change the sweep.

Run: `npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site" src/lib/site` — expected no errors.

- [ ] **Step 16: Commit**

```bash
git add "src/app/(admin)/site/editor/keyboard.ts" "src/app/(admin)/site/editor/keyboard.test.ts" \
  "src/app/(admin)/site/editor/panels/editor-icons.tsx" "src/app/(admin)/site/editor/panels/toolbar.tsx" \
  "src/app/(admin)/site/editor/panels/save-status.tsx" "src/app/(admin)/site/editor/editor.module.css" \
  "src/app/(admin)/site/editor/site-editor.tsx" "src/app/(admin)/site/editor/site-editor.test.tsx" \
  "src/app/(admin)/site/editor/scene/scene.module.css" \
  src/lib/site/views.ts src/lib/site/views.test.ts \
  "src/app/(admin)/site/page.tsx" "src/app/(admin)/site/page.test.tsx" "src/app/(admin)/site/site.module.css"
git status --short
git commit -m "feat(site): the editor shell — tool row, save status, conflict banner, keyboard by key position

?editor=3d now mounts SiteEditor; the temporary ScenePreview is gone.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(`git rm` already staged the deleted preview. Read `git status --short` before committing: only this task's paths may be staged.)

---

### Task 22: Library and objects panels

**Files:**
- Create: `src/app/(admin)/site/editor/panels/library-panel.tsx`, `panels/library-panel.test.tsx`
- Create: `src/app/(admin)/site/editor/panels/objects-panel.tsx`, `panels/side-panel.tsx`, `panels/objects-panel.test.tsx` (tests both)
- Modify: `src/app/(admin)/site/editor/editor.module.css` (append), `site-editor.tsx`, `site-editor.test.tsx` (append)

**Interfaces:**
- Consumes: `effectiveSize`, `isCustomised`, `KindDefaults` (`defaults.ts`); `SITE_KINDS`, `KIND_ORDER`, `KIND_GROUP_ORDER`, `KIND_GROUP_LABELS`, `SiteKindGroup` (`kinds.ts`); `formatSize`, `snap` (`geometry.ts`); `addOps` (`commands.ts`; `at` is the north-west corner); `nearestFreeSpot` (`placement.ts`); `SceneHandle.groundAtClient`, `setGhost`, `centreGround`, `fitIds`; `EditorFlags`.
- Produces (contract): `LibraryPanel({ defaults, onActivate, onDragMove, onDrop, onDragCancel })`, `ObjectsPanel({ items, selection, flags, hiddenGroups, onPick, onToggleGroup })`, `SidePanel({ tab, onTab, library, objects, count })` (+ `type SideTab = 'library' | 'objects'`).

- [ ] **Step 1: Write the failing panel tests**

Create `src/app/(admin)/site/editor/panels/library-panel.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { unnamedControls } from '@/test/a11y';
import type { KindDefaults } from '@/lib/site/defaults';
import { LibraryPanel } from './library-panel';

beforeAll(() => {
  // jsdom captures no pointer; the tile only needs the call to exist.
  Element.prototype.setPointerCapture = () => {};
});

function renderLibrary(defaults: KindDefaults = {}) {
  const calls = { onActivate: vi.fn(), onDragMove: vi.fn(), onDrop: vi.fn(), onDragCancel: vi.fn() };
  const { container } = render(<LibraryPanel defaults={defaults} {...calls} />);
  return { ...calls, container };
}

const tile = (name: RegExp) => screen.getByRole('button', { name });

describe('the library', () => {
  it('offers every kind, grouped, at the size it will land at', () => {
    const { container } = renderLibrary();
    expect(screen.getByText('לינה וצל')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'הוספת אוהל, 3 × 3 מ׳' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'הוספת קראוון, 7 × 2.5 מ׳' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^הוספת / })).toHaveLength(19);
    expect(unnamedControls(container)).toEqual([]);
  });

  it('shows the camp’s own default size, and says it was changed', () => {
    renderLibrary({ tent: { widthCm: 350, depthCm: 300, heightCm: 210, insetCm: null } });
    expect(screen.getByRole('button', { name: 'הוספת אוהל, 3.5 × 3 מ׳, גודל ברירת המחדל שונה' })).toBeTruthy();
  });

  it('finds a kind by its name, and says when there is none', () => {
    renderLibrary();
    const search = screen.getByRole('searchbox', { name: 'חיפוש פריט להוספה' });
    fireEvent.change(search, { target: { value: 'מקר' } });
    expect(screen.getAllByRole('button', { name: /^הוספת / }).map((button) => button.getAttribute('aria-label')))
      .toEqual(['הוספת מקרר, 0.7 × 0.7 מ׳']);
    fireEvent.change(search, { target: { value: 'חללית' } });
    expect(screen.getByText(/אין סוג כזה ברשימה/)).toBeTruthy();
  });

  it('places a kind on a click', () => {
    const { onActivate } = renderLibrary();
    fireEvent.click(tile(/^הוספת אוהל,/));
    expect(onActivate).toHaveBeenCalledWith('tent');
  });

  it('drags a kind: moves report where the pointer is, the drop lands it, and the click after the drop does not', () => {
    const { onActivate, onDragMove, onDrop } = renderLibrary();
    const tent = tile(/^הוספת אוהל,/);
    fireEvent.pointerDown(tent, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(tent, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(onDragMove).toHaveBeenLastCalledWith('tent', 400, 300);
    fireEvent.pointerUp(tent, { pointerId: 1, clientX: 410, clientY: 305 });
    expect(onDrop).toHaveBeenCalledWith('tent', 410, 305);
    fireEvent.click(tent);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('reports a drag the browser cancelled', () => {
    const { onDragCancel, onDrop } = renderLibrary();
    const tent = tile(/^הוספת אוהל,/);
    fireEvent.pointerDown(tent, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(tent, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerCancel(tent, { pointerId: 1 });
    expect(onDragCancel).toHaveBeenCalledTimes(1);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('treats a press that barely moves as a click', () => {
    const { onActivate, onDragMove } = renderLibrary();
    const tent = tile(/^הוספת אוהל,/);
    fireEvent.pointerDown(tent, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(tent, { pointerId: 1, clientX: 12, clientY: 11 });
    fireEvent.pointerUp(tent, { pointerId: 1, clientX: 12, clientY: 11 });
    fireEvent.click(tent);
    expect(onDragMove).not.toHaveBeenCalled();
    expect(onActivate).toHaveBeenCalledWith('tent');
  });
});
```

Create `src/app/(admin)/site/editor/panels/objects-panel.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { derive, toPlaced } from '@/lib/site/derive';
import { overlapPairs } from '@/lib/site/geometry';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { ObjectsPanel } from './objects-panel';
import { SidePanel } from './side-panel';

/* This file's own fixture. */
function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function doc(items: EditorItem[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, defaults: {} };
}

/** The flags, worked out with `derive.ts` — the server's rule — not with the store. */
function flagsOf(map: EditorDoc): EditorFlags {
  const { items } = derive(map.plot, map.items);
  return {
    outside: new Set(items.filter((entry) => entry.outside).map((entry) => entry.id)),
    overlapping: new Set(items.filter((entry) => entry.overlapping).map((entry) => entry.id)),
    partly: new Set(items.filter((entry) => entry.shade === 'partly').map((entry) => entry.id)),
    pairs: overlapPairs(map.items.map(toPlaced)),
  };
}

function renderList(items: EditorItem[], over: { selection?: string[]; hiddenGroups?: Array<'sleep'> } = {}) {
  const map = doc(items);
  const onPick = vi.fn();
  const onToggleGroup = vi.fn();
  render(
    <ObjectsPanel
      items={map.items}
      selection={over.selection ?? []}
      flags={flagsOf(map)}
      hiddenGroups={over.hiddenGroups ?? []}
      onPick={onPick}
      onToggleGroup={onToggleGroup}
    />,
  );
  return { onPick, onToggleGroup };
}

const rows = () => screen.getAllByRole('button').filter((button) => button.dataset.row === 'true');

describe('the list of what is on the map', () => {
  it('lists every item under its group, in the order a person counts, with its size', () => {
    renderList([
      item({ id: 't10', label: 'אוהל 10' }),
      item({ id: 't2', label: 'אוהל 2', xCm: 900 }),
      item({ id: 'k', kind: 'kitchen', label: 'מטבח 1', xCm: 1500, widthCm: 400, depthCm: 300 }),
    ]);
    expect(rows().map((row) => row.getAttribute('aria-label')))
      .toEqual(['אוהל 2, 3 × 2 מ׳', 'אוהל 10, 3 × 2 מ׳', 'מטבח 1, 4 × 3 מ׳']);
    expect(screen.getByText('לינה וצל')).toBeTruthy();
    expect(screen.getByText('מגורים')).toBeTruthy();
  });

  it('says in words which rows have a problem, and which are locked', () => {
    renderList([
      item({ id: 'out', label: 'קראוון 1', kind: 'caravan', xCm: 2500, widthCm: 700, depthCm: 250 }),
      item({ id: 'lk', label: 'אוהל 3', xCm: 1200, locked: true }),
    ]);
    expect(screen.getByRole('button', { name: 'קראוון 1, מחוץ לגדר, 7 × 2.5 מ׳' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'אוהל 3, נעול, 3 × 2 מ׳' })).toBeTruthy();
  });

  it('picks a row, and adds it with shift or ⌘', () => {
    const { onPick } = renderList([item({ id: 'a' })]);
    fireEvent.click(rows()[0]);
    expect(onPick).toHaveBeenLastCalledWith('a', false);
    fireEvent.click(rows()[0], { shiftKey: true });
    expect(onPick).toHaveBeenLastCalledWith('a', true);
    fireEvent.click(rows()[0], { metaKey: true });
    expect(onPick).toHaveBeenLastCalledWith('a', true);
  });

  it('hides and shows a group with one switch', () => {
    const { onToggleGroup } = renderList([item({ id: 'a' })], { hiddenGroups: ['sleep'] });
    const eye = screen.getByRole('button', { name: 'הסתרת לינה וצל' });
    expect(eye.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(eye);
    expect(onToggleGroup).toHaveBeenCalledWith('sleep');
  });

  it('finds an item by name, and says when there is none', () => {
    renderList([item({ id: 'a' }), item({ id: 'b', label: 'ספה 1', kind: 'sofa', xCm: 1200 })]);
    const search = screen.getByRole('searchbox', { name: 'חיפוש במפה' });
    fireEvent.change(search, { target: { value: 'ספה' } });
    expect(rows().map((row) => row.dataset.id)).toEqual(['b']);
    fireEvent.change(search, { target: { value: 'חללית' } });
    expect(screen.getByText('אין במפה פריט בשם הזה.')).toBeTruthy();
  });

  it('invites the first item on an empty map', () => {
    renderList([]);
    expect(screen.getByText('המפה ריקה. בלשונית ״הוספה למפה״ גוררים פריט אל המפה או לוחצים עליו.')).toBeTruthy();
  });
});

describe('the side panel', () => {
  function renderSide(count: number, tab: 'library' | 'objects' = 'library') {
    const onTab = vi.fn();
    render(<SidePanel tab={tab} onTab={onTab} count={count} library={<p>הספרייה</p>} objects={<p>הרשימה</p>} />);
    return { onTab };
  }

  it('shows one tab at a time and counts what is on the map', () => {
    const { onTab } = renderSide(12);
    expect(screen.getByRole('tab', { name: 'הוספה למפה' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('הספרייה')).toBeTruthy();
    expect(screen.queryByText('הרשימה')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'במפה 12' }));
    expect(onTab).toHaveBeenCalledWith('objects');
  });

  it('says how the first item is placed when the map is empty', () => {
    renderSide(0);
    expect(screen.getByText('המפה ריקה. גרירה של פריט אל המפה מניחה אותו בדיוק שם; לחיצה מניחה אותו במקום פנוי במרכז התצוגה.')).toBeTruthy();
  });

  it('moves between the tabs with the arrows, and keeps them from nudging the map', () => {
    const { onTab } = renderSide(3);
    const tab = screen.getByRole('tab', { name: 'הוספה למפה' });
    const press = createEvent.keyDown(tab, { key: 'ArrowLeft', code: 'ArrowLeft' });
    fireEvent(tab, press);
    expect(onTab).toHaveBeenCalledWith('objects');
    expect(press.defaultPrevented).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run "src/app/(admin)/site/editor/panels/library-panel.test.tsx" "src/app/(admin)/site/editor/panels/objects-panel.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `Failed to resolve import "./library-panel"` and `"./objects-panel"`.

- [ ] **Step 3: Append the panels' styles**

Append to `src/app/(admin)/site/editor/editor.module.css`:

```css
/* ---- floating panels -------------------------------------------------- */

.panel {
  position: absolute;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  box-shadow: var(--shadow-pop);
}

/* At the inline start — the right edge on this RTL page, as in the mock. */
.side {
  inset-block: 12px;
  inset-inline-start: 12px;
  inline-size: 256px;
}

.tabs {
  display: flex;
  gap: 2px;
  padding-block-start: 6px;
  padding-inline: var(--space-2);
  border-block-end: 1px solid var(--line);
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  block-size: 34px;
  padding-inline: 10px;
  margin-block-end: -1px;
  border: 0;
  border-block-end: 2px solid transparent;
  background: none;
  color: var(--ink-3);
  font-size: var(--text-dense);
  font-weight: 500;
  cursor: pointer;
}
.tab[aria-selected='true'] { color: var(--ink); border-block-end-color: var(--brand); font-weight: 600; }

.tabCount {
  padding-inline: 6px;
  border-radius: var(--radius-pill);
  background: var(--sunken);
  color: var(--ink-3);
  font-size: var(--text-label);
  line-height: 17px;
}

.body {
  flex: 1;
  min-block-size: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-block: 10px 12px;
  padding-inline: 12px;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  block-size: 32px;
  padding-inline: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--panel);
  color: var(--ink-3);
}

.searchInput {
  flex: 1;
  min-inline-size: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-size: var(--text-dense);
}

.hint {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--text-meta);
  line-height: 1.45;
}

.invite {
  margin: 0;
  padding: var(--space-2);
  border-radius: var(--radius-control);
  background: var(--brand-soft);
  color: var(--ink);
  font-size: var(--text-meta);
}

.group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.groupLabel {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-3);
  font-size: var(--text-label);
  font-weight: 600;
}

/* A group's colour: the scene's, handed down by SiteEditor (see the header). */
.g_sleep { --swatch: var(--group-sleep, var(--line-strong)); }
.g_living { --swatch: var(--group-living, var(--line-strong)); }
.g_sanitation { --swatch: var(--group-sanitation, var(--line-strong)); }
.g_utility { --swatch: var(--group-utility, var(--line-strong)); }
.g_other { --swatch: var(--group-other, var(--line-strong)); }

.swatch {
  inline-size: 8px;
  block-size: 8px;
  flex-shrink: 0;
  border-radius: 2px;
  background: var(--swatch);
}

.tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

/* `touch-action: none` so a finger on a tile drags it rather than scrolling the list. */
.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding-block: 8px 6px;
  padding-inline: 4px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--panel);
  color: var(--ink);
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.tile:hover { border-color: var(--line-strong); background: var(--hover); }
.tile:active { cursor: grabbing; }

.tileLabel {
  font-size: var(--text-meta);
  font-weight: 500;
  line-height: 1.2;
  text-align: center;
}

.tileSize {
  color: var(--ink-3);
  font-size: var(--text-label);
}

/* The "default changed" dot, at the tile's inline-end corner. */
.tileDot {
  position: absolute;
  inset-block-start: 5px;
  inset-inline-end: 5px;
  inline-size: 6px;
  block-size: 6px;
  border-radius: var(--radius-pill);
  background: var(--brand);
}

.glyph {
  stroke: var(--ink-3);
  stroke-opacity: 0.45;
  stroke-width: 1;
  stroke-linejoin: round;
}
.faceTop { fill: var(--swatch); }
.faceSide { fill: var(--swatch); fill-opacity: 0.78; }
.faceSide2 { fill: var(--swatch); fill-opacity: 0.6; }
.faceLine { fill: none; }
.glyph[data-glyph='net'] .faceTop { fill-opacity: 0.6; }

.groupHead {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-block: 6px 2px;
  padding-inline: 2px;
  color: var(--ink-3);
  font-size: var(--text-meta);
  font-weight: 600;
}

.eye {
  margin-inline-start: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 28px;
  block-size: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
}
.eye:hover { background: var(--sunken); color: var(--ink); }
.eye[aria-pressed='true'] { color: var(--brand-text); }

.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  inline-size: 100%;
  block-size: 32px;
  padding-inline: var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  font-size: var(--text-dense);
  text-align: start;
  cursor: pointer;
}
.row:hover { background: var(--sunken); }
.row[aria-pressed='true'] { background: var(--selected); }

.rowSwatch {
  inline-size: 10px;
  block-size: 10px;
  flex-shrink: 0;
  border-radius: 3px;
  background: var(--swatch);
}

.rowLabel {
  flex: 1;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rowSize {
  color: var(--ink-3);
  font-size: var(--text-label);
}

.issueDot {
  inline-size: 7px;
  block-size: 7px;
  flex-shrink: 0;
  border-radius: var(--radius-pill);
  background: var(--warn);
}
.issueDot[data-tone='bad'] { background: var(--bad); }
```

- [ ] **Step 4: Write the three panels**

Create `src/app/(admin)/site/editor/panels/library-panel.tsx`:

```tsx
'use client';

/**
 * הוספה למפה (spec §10): every kind the map knows, grouped as `kinds.ts`
 * groups them, each tile showing the size it lands at — the camp's own
 * default when there is one, with a dot saying so.
 *
 * A tile is placed two ways (§8). Dragged, it follows the pointer and lands
 * where it is let go; clicked, or Enter or Space on it, it lands at the free
 * spot nearest the middle of the view. The tile only reports the pointer;
 * SiteEditor asks the scene where the ground is.
 */

import { useRef, useState, type PointerEvent, type ReactElement } from 'react';
import type { SiteItemKind } from '@/db/schema/site';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { effectiveSize, isCustomised, type KindDefaults } from '@/lib/site/defaults';
import { formatSize } from '@/lib/site/geometry';
import { KIND_GROUP_LABELS, KIND_GROUP_ORDER, KIND_ORDER, SITE_KINDS } from '@/lib/site/kinds';
import styles from '../editor.module.css';

/** A press that travels less than this is a click, not a drag. */
const DRAG_START_PX = 4;

type Glyph = 'box' | 'low' | 'long' | 'tent' | 'cyl' | 'net';
type Face = 'top' | 'side' | 'side2' | 'line';

/** The mock's isometric tile drawings, on a 30 × 24 canvas. */
const GLYPHS: Record<Glyph, ReadonlyArray<{ d: string; face: Face }>> = {
  box: [
    { d: 'M3 9 L15 14 L15 22 L3 17 Z', face: 'side' },
    { d: 'M27 9 L15 14 L15 22 L27 17 Z', face: 'side2' },
    { d: 'M15 4 L27 9 L15 14 L3 9 Z', face: 'top' },
  ],
  low: [
    { d: 'M3 12 L15 17 L15 21 L3 16 Z', face: 'side' },
    { d: 'M27 12 L15 17 L15 21 L27 16 Z', face: 'side2' },
    { d: 'M15 7 L27 12 L15 17 L3 12 Z', face: 'top' },
  ],
  long: [
    { d: 'M2 8 L20 15 L20 22 L2 15 Z', face: 'side' },
    { d: 'M28 11 L20 15 L20 22 L28 18 Z', face: 'side2' },
    { d: 'M10 4 L28 11 L20 15 L2 8 Z', face: 'top' },
  ],
  tent: [
    { d: 'M3 14 L15 19 L15 22 L3 17 Z', face: 'side' },
    { d: 'M27 14 L15 19 L15 22 L27 17 Z', face: 'side2' },
    { d: 'M3 14 L15 19 L21 7 L9 3 Z', face: 'top' },
    { d: 'M27 14 L15 19 L21 7 Z', face: 'side2' },
  ],
  cyl: [
    { d: 'M6 8 V17 A9 4 0 0 0 24 17 V8 Z', face: 'side' },
    { d: 'M6 8 A9 4 0 1 0 24 8 A9 4 0 1 0 6 8 Z', face: 'top' },
  ],
  net: [
    { d: 'M3 8 V19 M27 8 V19 M15 13 V23 M15 3 V8', face: 'line' },
    { d: 'M15 3 L27 8 L15 13 L3 8 Z', face: 'top' },
  ],
};

const FACE_CLASS: Record<Face, string> = {
  top: styles.faceTop, side: styles.faceSide, side2: styles.faceSide2, line: styles.faceLine,
};

function glyphOf(kind: SiteItemKind): Glyph {
  const preset = SITE_KINDS[kind];
  if (preset.shape === 'net') return 'net';
  if (preset.shape === 'tent') return 'tent';
  if (preset.shape === 'cylinder' || preset.shape === 'fire') return 'cyl';
  if (preset.shape === 'sofa') return 'low';
  if (preset.widthCm >= preset.depthCm * 2.5) return 'long';
  return preset.heightCm <= 110 ? 'low' : 'box';
}

function KindGlyph({ kind }: { kind: SiteItemKind }): ReactElement {
  const glyph = glyphOf(kind);
  return (
    <svg
      className={cx(styles.glyph, styles[`g_${SITE_KINDS[kind].group}`])}
      data-glyph={glyph}
      width={30}
      height={24}
      viewBox="0 0 30 24"
      aria-hidden="true"
    >
      {GLYPHS[glyph].map((part) => <path key={part.d} d={part.d} className={FACE_CLASS[part.face]} />)}
    </svg>
  );
}

interface TileCallbacks {
  onActivate: (kind: SiteItemKind) => void;
  onDragMove: (kind: SiteItemKind, clientX: number, clientY: number) => void;
  onDrop: (kind: SiteItemKind, clientX: number, clientY: number) => void;
  onDragCancel: () => void;
}

function KindTile({ kind, defaults, onActivate, onDragMove, onDrop, onDragCancel }: TileCallbacks & {
  kind: SiteItemKind;
  defaults: KindDefaults;
}): ReactElement {
  const press = useRef<{ pointer: number; x: number; y: number; dragging: boolean } | null>(null);
  const dropped = useRef(false);
  const size = effectiveSize(kind, defaults);
  const customised = isCustomised(kind, defaults);
  const sizeText = formatSize(size.widthCm, size.depthCm);
  const label = SITE_KINDS[kind].label;

  function down(event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
  }

  function move(event: PointerEvent<HTMLButtonElement>): void {
    const current = press.current;
    if (current === null || current.pointer !== event.pointerId) return;
    if (!current.dragging && Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_START_PX) return;
    current.dragging = true;
    onDragMove(kind, event.clientX, event.clientY);
  }

  function up(event: PointerEvent<HTMLButtonElement>): void {
    const current = press.current;
    press.current = null;
    if (current === null || !current.dragging) return;
    // The browser follows a drop with a click on the tile; that click is not a second placement.
    dropped.current = true;
    onDrop(kind, event.clientX, event.clientY);
  }

  function cancel(): void {
    const current = press.current;
    press.current = null;
    if (current?.dragging) onDragCancel();
  }

  function click(): void {
    if (dropped.current) {
      dropped.current = false;
      return;
    }
    onActivate(kind);
  }

  return (
    <button
      type="button"
      className={styles.tile}
      aria-label={`הוספת ${label}, ${sizeText}${customised ? ', גודל ברירת המחדל שונה' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onClick={click}
    >
      <KindGlyph kind={kind} />
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileSize}><bdi>{sizeText}</bdi></span>
      {customised ? <span className={styles.tileDot} aria-hidden="true" /> : null}
    </button>
  );
}

export function LibraryPanel({ defaults, onActivate, onDragMove, onDrop, onDragCancel }: TileCallbacks & {
  defaults: KindDefaults;
}): ReactElement {
  const [query, setQuery] = useState('');
  const wanted = query.trim();
  const groups = KIND_GROUP_ORDER
    .map((group) => ({
      group,
      kinds: KIND_ORDER.filter((kind) => SITE_KINDS[kind].group === group
        && (wanted === '' || SITE_KINDS[kind].label.includes(wanted))),
    }))
    .filter((entry) => entry.kinds.length > 0);

  return (
    <div className={styles.stack}>
      <label className={styles.search}>
        <Icon name="search" size={15} />
        <input
          type="search"
          className={styles.searchInput}
          placeholder="חיפוש פריט להוספה"
          aria-label="חיפוש פריט להוספה"
          value={query}
          onChange={(event) => { setQuery(event.target.value); }}
        />
      </label>
      <p className={styles.hint}>
        גרירה אל המפה מניחה את הפריט בדיוק שם. לחיצה מניחה אותו במקום הפנוי הקרוב למרכז התצוגה.
      </p>
      {groups.map(({ group, kinds }) => (
        <div key={group} className={styles.group}>
          <div className={styles.groupLabel}>
            <span className={cx(styles.swatch, styles[`g_${group}`])} aria-hidden="true" />
            {KIND_GROUP_LABELS[group]}
          </div>
          <div className={styles.tiles}>
            {kinds.map((kind) => (
              <KindTile
                key={kind}
                kind={kind}
                defaults={defaults}
                onActivate={onActivate}
                onDragMove={onDragMove}
                onDrop={onDrop}
                onDragCancel={onDragCancel}
              />
            ))}
          </div>
        </div>
      ))}
      {groups.length === 0 ? (
        <p className={styles.hint}>
          אין סוג כזה ברשימה. הסוג ״אחר״ מקבל כל שם, כך שאפשר לצייר גם את מה שהרשימה לא חשבה עליו.
        </p>
      ) : null}
    </div>
  );
}
```

Create `src/app/(admin)/site/editor/panels/objects-panel.tsx`:

```tsx
'use client';

/**
 * במפה (spec §10): every item, grouped as the library groups kinds,
 * searchable. A row selects its item and flies to it; shift or ⌘ adds it to
 * the selection. Each group can be hidden from the scene. This list is also
 * the keyboard's and the screen reader's way through the map, so every row
 * says its problem and its lock in words, not only in a dot.
 */

import { useState, type ReactElement } from 'react';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { formatSize } from '@/lib/site/geometry';
import { KIND_GROUP_LABELS, KIND_GROUP_ORDER, SITE_KINDS, type SiteKindGroup } from '@/lib/site/kinds';
import type { EditorItem } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { EditorIcon } from './editor-icons';
import styles from '../editor.module.css';

function issueOf(item: EditorItem, flags: EditorFlags): { tone: 'bad' | 'warn'; text: string } | null {
  if (flags.outside.has(item.id)) return { tone: 'bad', text: 'מחוץ לגדר' };
  if (flags.overlapping.has(item.id)) return { tone: 'warn', text: 'חפיפה עם פריט אחר' };
  if (flags.partly.has(item.id)) return { tone: 'warn', text: 'בשולי רשת צל' };
  return null;
}

export function ObjectsPanel({ items, selection, flags, hiddenGroups, onPick, onToggleGroup }: {
  items: readonly EditorItem[];
  selection: readonly string[];
  flags: EditorFlags;
  hiddenGroups: readonly SiteKindGroup[];
  onPick: (id: string, additive: boolean) => void;
  onToggleGroup: (group: SiteKindGroup) => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const wanted = query.trim();
  const selected = new Set(selection);
  const groups = KIND_GROUP_ORDER
    .map((group) => ({
      group,
      rows: items
        .filter((item) => SITE_KINDS[item.kind].group === group && (wanted === '' || item.label.includes(wanted)))
        .sort((a, b) => a.label.localeCompare(b.label, 'he', { numeric: true })),
    }))
    .filter((entry) => entry.rows.length > 0);

  if (items.length === 0) {
    return (
      <p className={styles.invite}>
        המפה ריקה. בלשונית ״הוספה למפה״ גוררים פריט אל המפה או לוחצים עליו.
      </p>
    );
  }

  return (
    <div className={styles.stack}>
      <label className={styles.search}>
        <Icon name="search" size={15} />
        <input
          type="search"
          className={styles.searchInput}
          placeholder="חיפוש במפה"
          aria-label="חיפוש במפה"
          value={query}
          onChange={(event) => { setQuery(event.target.value); }}
        />
      </label>
      {groups.map(({ group, rows }) => (
        <div key={group}>
          <div className={styles.groupHead}>
            <span className={cx(styles.swatch, styles[`g_${group}`])} aria-hidden="true" />
            <span>{KIND_GROUP_LABELS[group]}</span>
            <span aria-hidden="true">·</span>
            <bdi>{rows.length}</bdi>
            <button
              type="button"
              className={styles.eye}
              aria-label={`הסתרת ${KIND_GROUP_LABELS[group]}`}
              aria-pressed={hiddenGroups.includes(group)}
              onClick={() => { onToggleGroup(group); }}
            >
              {hiddenGroups.includes(group) ? <EditorIcon name="eyeOff" /> : <Icon name="eye" size={16} />}
            </button>
          </div>
          {rows.map((item) => {
            const issue = issueOf(item, flags);
            const size = formatSize(item.widthCm, item.depthCm);
            /* Spoken in full, commas between: the lock and the problem are
               words here, where the screen shows a padlock and a dot. The
               name starts with the visible label (label-in-name). */
            const name = [item.label, item.locked ? 'נעול' : null, issue?.text ?? null, size]
              .filter((part): part is string => part !== null)
              .join(', ');
            return (
              <button
                key={item.id}
                type="button"
                className={styles.row}
                data-row="true"
                data-id={item.id}
                aria-label={name}
                aria-pressed={selected.has(item.id)}
                onClick={(event) => { onPick(item.id, event.shiftKey || event.metaKey || event.ctrlKey); }}
              >
                <span className={cx(styles.rowSwatch, styles[`g_${group}`])} aria-hidden="true" />
                <span className={styles.rowLabel}>{item.label}</span>
                {item.locked ? <EditorIcon name="lock" size={14} /> : null}
                {issue === null ? null : <span className={styles.issueDot} data-tone={issue.tone} aria-hidden="true" />}
                <span className={styles.rowSize}><bdi>{size}</bdi></span>
              </button>
            );
          })}
        </div>
      ))}
      {groups.length === 0 ? <p className={styles.hint}>אין במפה פריט בשם הזה.</p> : null}
    </div>
  );
}
```

Create `src/app/(admin)/site/editor/panels/side-panel.tsx`:

```tsx
'use client';

/**
 * The panel at the inline start (spec §10): two tabs, adding to the map and
 * what is on it. On an empty map it opens on the library and says how the
 * first item is placed (§13: an empty state is an invitation).
 */

import { useId, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import styles from '../editor.module.css';

export type SideTab = 'library' | 'objects';

export function SidePanel({ tab, onTab, library, objects, count }: {
  tab: SideTab;
  onTab: (tab: SideTab) => void;
  library: ReactNode;
  objects: ReactNode;
  count: number;
}): ReactElement {
  const id = useId();
  const libraryTab = useRef<HTMLButtonElement>(null);
  const objectsTab = useRef<HTMLButtonElement>(null);

  /* Two tabs, so either arrow goes to the other one. Handled here and kept
     from the editor's root, where an arrow would nudge the selection. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const next: SideTab = tab === 'library' ? 'objects' : 'library';
    onTab(next);
    (next === 'library' ? libraryTab : objectsTab).current?.focus();
  }

  return (
    <section className={cx(styles.panel, styles.side)} aria-label="הוספה ורשימת הפריטים" data-panel="true">
      <div className={styles.tabs} role="tablist" aria-label="הוספה ורשימה" onKeyDown={onKeyDown}>
        <button
          ref={libraryTab}
          type="button"
          role="tab"
          id={`${id}-library`}
          className={styles.tab}
          aria-selected={tab === 'library'}
          aria-controls={`${id}-panel`}
          tabIndex={tab === 'library' ? 0 : -1}
          onClick={() => { onTab('library'); }}
        >
          הוספה למפה
        </button>
        <button
          ref={objectsTab}
          type="button"
          role="tab"
          id={`${id}-objects`}
          className={styles.tab}
          aria-selected={tab === 'objects'}
          aria-controls={`${id}-panel`}
          tabIndex={tab === 'objects' ? 0 : -1}
          onClick={() => { onTab('objects'); }}
        >
          במפה
          {' '}
          <span className={styles.tabCount}><bdi>{count}</bdi></span>
        </button>
      </div>
      <div className={styles.body} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
        {count === 0 && tab === 'library' ? (
          <p className={styles.invite}>
            המפה ריקה. גרירה של פריט אל המפה מניחה אותו בדיוק שם; לחיצה מניחה אותו במקום פנוי במרכז התצוגה.
          </p>
        ) : null}
        {tab === 'library' ? library : objects}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run the panel tests**

Run the Step 2 command. Expected: 16 passed (7 library, 6 list, 3 side panel).

- [ ] **Step 6: Write the failing editor tests for placing and picking**

In `src/app/(admin)/site/editor/site-editor.test.tsx`, add these imports after the line `import { unnamedControls } from '@/test/a11y';`:

```tsx
import { contains, overlap } from '@/lib/site/geometry';
import { rectOf } from '@/lib/site/editor/model';
```

In its `beforeAll`, after `stubMedia();`, add:

```tsx
  // jsdom captures no pointer; the library's tiles only need the calls to exist.
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
```

Append to the end of the file:

```tsx
describe('placing from the library', () => {
  it('puts a clicked kind at the free spot nearest the middle of the view, and selects it', async () => {
    scene.handle.centreGround.mockReturnValue([1300, 1200]);
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.click(screen.getByRole('button', { name: /^הוספת מטבח,/ }));
    const items = lastScene().store.doc.items;
    expect(items).toHaveLength(2);
    const kitchen = items.find((entry) => entry.kind === 'kitchen');
    if (kitchen === undefined) throw new Error('no kitchen was added');
    expect(lastScene().store.selection).toEqual([kitchen.id]);
    // Free and on the plot, by the geometry the server uses — not by the placement code under test.
    expect(overlap(rectOf(kitchen), rectOf(items[0]))).toBe(false);
    expect(contains({ widthCm: 2600, depthCm: 2400 }, rectOf(kitchen))).toBe(true);
    // Its middle is within a grid step of the middle of the view.
    expect(Math.abs(kitchen.xCm + kitchen.widthCm / 2 - 1300)).toBeLessThanOrEqual(50);
    expect(Math.abs(kitchen.yCm + kitchen.depthCm / 2 - 1200)).toBeLessThanOrEqual(50);
  });

  it('says there is no room instead of guessing a spot', async () => {
    renderEditor({
      initial: {
        doc: siteDoc([siteItem({ id: 'a', xCm: 0, yCm: 0, widthCm: 300, depthCm: 300 })], { widthCm: 300, depthCm: 300 }),
        version: 0,
      },
    });
    await screen.findByTestId('scene');
    fireEvent.click(screen.getByRole('button', { name: /^הוספת אוהל,/ }));
    expect(await screen.findByText('אין במגרש מקום פנוי לאוהל במידות 3 × 3 מ׳.')).toBeTruthy();
    expect(lastScene().store.doc.items).toHaveLength(1);
  });

  it('drags a kind onto the ground with a ghost, and lands it centred on the pointer, on the grid', async () => {
    scene.handle.groundAtClient.mockReturnValue([1010, 790]);
    renderEditor();
    const sceneElement = await screen.findByTestId('scene');
    document.elementFromPoint = () => sceneElement;
    const tent = screen.getByRole('button', { name: /^הוספת אוהל,/ });
    fireEvent.pointerDown(tent, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(tent, { pointerId: 1, clientX: 400, clientY: 300 });
    // A 3 × 3 m tent centred on (10.1 m, 7.9 m), snapped to the 50 cm grid.
    expect(scene.handle.setGhost).toHaveBeenLastCalledWith({ kind: 'tent', xCm: 850, yCm: 650 });
    fireEvent.pointerUp(tent, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.click(tent); // the click a browser sends after the drop
    expect(scene.handle.setGhost).toHaveBeenLastCalledWith(null);
    const items = lastScene().store.doc.items;
    expect(items).toHaveLength(2);
    expect(items.find((entry) => entry.id !== 'a')).toMatchObject({ kind: 'tent', xCm: 850, yCm: 650 });
  });

  it('lands nothing when the drag ends back over a panel', async () => {
    scene.handle.groundAtClient.mockReturnValue([1000, 800]);
    renderEditor();
    await screen.findByTestId('scene');
    const panel = screen.getByRole('region', { name: 'הוספה ורשימת הפריטים' });
    document.elementFromPoint = () => panel;
    const tent = screen.getByRole('button', { name: /^הוספת אוהל,/ });
    fireEvent.pointerDown(tent, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(tent, { pointerId: 1, clientX: 60, clientY: 60 });
    expect(scene.handle.setGhost).toHaveBeenLastCalledWith(null);
    fireEvent.pointerUp(tent, { pointerId: 1, clientX: 60, clientY: 60 });
    expect(lastScene().store.doc.items).toHaveLength(1);
  });
});

describe('the list of what is on the map', () => {
  it('selects a row and flies to it; shift adds a row', async () => {
    renderEditor({
      initial: { doc: siteDoc([siteItem({ id: 'a' }), siteItem({ id: 'b', label: 'אוהל 2', xCm: 1500 })]), version: 0 },
      initialSelection: null,
    });
    await screen.findByTestId('scene');
    fireEvent.click(screen.getByRole('tab', { name: /במפה/ }));
    fireEvent.click(screen.getByRole('button', { name: /^אוהל 1/ }));
    expect(lastScene().store.selection).toEqual(['a']);
    expect(scene.handle.fitIds).toHaveBeenLastCalledWith(['a']);
    fireEvent.click(screen.getByRole('button', { name: /^אוהל 2/ }), { shiftKey: true });
    expect(lastScene().store.selection).toEqual(['a', 'b']);
  });

  it('hides a group from the scene and lets go of its items', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.click(screen.getByRole('tab', { name: /במפה/ }));
    fireEvent.click(screen.getByRole('button', { name: 'הסתרת לינה וצל' }));
    expect(lastScene().ui.hiddenGroups).toEqual(['sleep']);
    expect(lastScene().store.selection).toEqual([]);
  });
});
```

Run: `npx vitest run "src/app/(admin)/site/editor/site-editor.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — 6 new tests fail (`Unable to find an accessible element with the role "button" and name /^הוספת מטבח,/`, and the like); the 12 from Task 21 pass.

- [ ] **Step 7: Wire the panels into `SiteEditor`**

In `src/app/(admin)/site/editor/site-editor.tsx`:

1. Add after the line `import { useToast } from '@/components/ui/toaster';`:

```tsx
import type { SiteItemKind } from '@/db/schema/site';
import { effectiveSize } from '@/lib/site/defaults';
import { formatSize, snap } from '@/lib/site/geometry';
import { nearestFreeSpot } from '@/lib/site/editor/placement';
```

2. Replace the line `import { KIND_GROUP_ORDER, SITE_KINDS } from '@/lib/site/kinds';` with:

```tsx
import { KIND_GROUP_ORDER, SITE_KINDS, type SiteKindGroup } from '@/lib/site/kinds';
```

3. Replace the line `import { duplicateOps, lockOps, moveOps, removeOps, turnOps } from '@/lib/site/editor/commands';` with:

```tsx
import { addOps, duplicateOps, lockOps, moveOps, removeOps, turnOps } from '@/lib/site/editor/commands';
```

4. Add after the line `import { ConflictBanner, SaveErrorBanner, SaveStatus } from './panels/save-status';`:

```tsx
import { LibraryPanel } from './panels/library-panel';
import { ObjectsPanel } from './panels/objects-panel';
import { SidePanel, type SideTab } from './panels/side-panel';
```

5. Add after the line `const [resolving, setResolving] = useState(false);`:

```tsx
  const [tab, setTab] = useState<SideTab>('library');
  const stageRef = useRef<HTMLElement>(null);
```

6. Add directly above the line `  // ── end of edits ──────────────────────────────────────────────────────`:

```tsx
  /** A new item of `kind` with its north-west corner at `at`, selected once it lands. */
  function addAt(kind: SiteItemKind, at: { xCm: number; yCm: number }): void {
    const id = crypto.randomUUID();
    const ops = addOps(store.doc, kind, at, id);
    if (ops.length === 0) return;
    store.run(`הוספת ${SITE_KINDS[kind].label}`, ops, [id]);
  }
```

7. Add directly above the line `  function fit(): void {`:

```tsx
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
        message: `אין במגרש מקום פנוי ל${SITE_KINDS[kind].label} במידות ${formatSize(size.widthCm, size.depthCm)}.`,
        tone: 'bad',
      });
      return;
    }
    addAt(kind, spot);
  }

  /** A row in the list: selects its item and flies to it; shift or ⌘ adds it to the selection instead. */
  function pickRow(id: string, additive: boolean): void {
    if (additive) {
      store.select(store.selection.includes(id)
        ? store.selection.filter((other) => other !== id)
        : [...store.selection, id]);
      return;
    }
    store.select([id]);
    sceneRef.current?.fitIds([id]);
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

```

8. Replace the line `      <section className={styles.stage} aria-label="מפת הקאמפ" tabIndex={-1}>` with:

```tsx
      <section className={styles.stage} aria-label="מפת הקאמפ" tabIndex={-1} ref={stageRef}>
```

9. Insert directly above the line `        {/* floating panels, over the scene */}`:

```tsx
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
              onPick={pickRow}
              onToggleGroup={toggleGroup}
            />
          )}
        />
```

- [ ] **Step 8: Run this task's tests**

Run: `npx vitest run "src/app/(admin)/site/editor/panels/library-panel.test.tsx" "src/app/(admin)/site/editor/panels/objects-panel.test.tsx" "src/app/(admin)/site/editor/site-editor.test.tsx" "src/app/(admin)/copy-sweep.test.tsx" "src/app/(admin)/a11y-sweep.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: all pass, exit 0 — 16 panel tests, 18 editor tests (12 + 6), both sweeps.

Run: `npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor"` — expected no errors.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(admin)/site/editor/panels/library-panel.tsx" "src/app/(admin)/site/editor/panels/library-panel.test.tsx" \
  "src/app/(admin)/site/editor/panels/objects-panel.tsx" "src/app/(admin)/site/editor/panels/side-panel.tsx" \
  "src/app/(admin)/site/editor/panels/objects-panel.test.tsx" "src/app/(admin)/site/editor/editor.module.css" \
  "src/app/(admin)/site/editor/site-editor.tsx" "src/app/(admin)/site/editor/site-editor.test.tsx"
git commit -m "feat(site): the library and the list — drag or click to place, a row selects and flies

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: Inspector — plot, one item, several items

**Files:**
- Create: `src/app/(admin)/site/editor/panels/north.ts`
- Create: `src/app/(admin)/site/editor/panels/inspector-plot.tsx`, `panels/inspector-plot.test.tsx`
- Create: `src/app/(admin)/site/editor/panels/inspector-item.tsx`, `panels/inspector-item.test.tsx`
- Create: `src/app/(admin)/site/editor/panels/inspector-multi.tsx`, `panels/inspector-multi.test.tsx`
- Create: `src/app/(admin)/site/editor/panels/selection-actions.tsx`
- Modify: `src/app/(admin)/site/editor/editor.module.css` (append), `site-editor.tsx`, `site-editor.test.tsx` (append)

**Interfaces:**
- Consumes: `readMetres`, `SIDE_RANGE`, `HEIGHT_RANGE`, `POSITION_RANGE`, `GAP_RANGE`, `NOT_A_LENGTH`, `MetresRange` (`metres.ts`, plan 02 Task 8 — every typed length goes through `readMetres`); `LOCKED_FIELDS` (`ops.ts` — the one lock list: a locked item's boxes for exactly those fields are disabled, height included); `patchOps`, `resizeKindOps`, `resetSizeOps`, `setKindDefaultOps`, `alignOps`, `distributeOps`, `rowOps`, `uniformSize`, `Alignment` (`commands.ts`); `applyOps` (`ops.ts`); `effectiveSize`, `itemHeight`, `KindSize` (`defaults.ts`); `shadeCounts`, `shadedRect`, `shadeState`, `areaM2`, `formatArea`, `formatMetres`, `formatSize`, `metres` (`geometry.ts`); `toPlaced` (`derive.ts`); `rectOf`, `findItem` (`model.ts`); `LABEL_REQUIRED` (`failure-messages.ts`); `Pill`, `SourceChip`, `Button`, `Icon`.
- Produces (contract): `PlotInspector({ doc, flags, plotHref, onPickIds })`, `ItemInspector({ doc, item, flags, buildTasks, onRun, onPickIds })`, `MultiInspector({ doc, ids, onRun })`. Additive: `ItemInspector.footer?`, `MultiInspector.footer?` and `MultiInspector.onClear?`; `SelectionActions({ locked, labelled, onTurn, onDuplicate, onLock, onRemove })`; `northText(northDeg): string`.

- [ ] **Step 1: Write the failing inspector tests**

Create `src/app/(admin)/site/editor/panels/inspector-plot.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { derive, toPlaced } from '@/lib/site/derive';
import { overlapPairs } from '@/lib/site/geometry';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { PlotInspector } from './inspector-plot';
import { northText } from './north';

/* This file's own fixture. */
function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function doc(items: EditorItem[], northDeg = 0): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg }, items, defaults: {} };
}

/** The flags, worked out with `derive.ts` — the server's rule — not with the store. */
function flagsOf(map: EditorDoc): EditorFlags {
  const { items } = derive(map.plot, map.items);
  return {
    outside: new Set(items.filter((entry) => entry.outside).map((entry) => entry.id)),
    overlapping: new Set(items.filter((entry) => entry.overlapping).map((entry) => entry.id)),
    partly: new Set(items.filter((entry) => entry.shade === 'partly').map((entry) => entry.id)),
    pairs: overlapPairs(map.items.map(toPlaced)),
  };
}

const HREF = '/site?season=s26&act=plot';

function renderPlot(map: EditorDoc) {
  const onPickIds = vi.fn();
  render(<PlotInspector doc={map} flags={flagsOf(map)} plotHref={HREF} onPickIds={onPickIds} />);
  return { onPickIds };
}

describe('the plot, when nothing is selected', () => {
  it('gives the plot’s figures, each a link to the drawer that changes it, and says they were typed by hand', () => {
    renderPlot(doc([]));
    expect(screen.getByRole('link', { name: '26 × 24 מ׳' }).getAttribute('href')).toBe(HREF);
    expect(screen.getByText('624 מ״ר')).toBeTruthy();
    expect(screen.getByRole('link', { name: '0.5 מ׳' }).getAttribute('href')).toBe(HREF);
    expect(screen.getByRole('link', { name: 'הצפון למעלה במפה' }).getAttribute('href')).toBe(HREF);
    expect(screen.getByRole('img', { name: 'מקור: נרשם ידנית' })).toBeTruthy();
  });

  it('invites the first item on an empty map, and finds nothing wrong with it', () => {
    renderPlot(doc([]));
    expect(screen.getByText('המפה ריקה. גרירה של פריט מהספרייה אל המפה, או לחיצה עליו, מניחה את הראשון.')).toBeTruthy();
    expect(screen.getByText('הכול בתוך הגדר, ושום דבר לא יושב על משהו אחר.')).toBeTruthy();
    expect(screen.getByText('אין רשתות צל במפה.')).toBeTruthy();
  });

  it('counts each group, and a count selects its group', () => {
    const { onPickIds } = renderPlot(doc([
      item({ id: 'a' }),
      item({ id: 'b', label: 'אוהל 2', xCm: 1000 }),
      item({ id: 's', kind: 'sofa', label: 'ספה 1', xCm: 1500, widthCm: 200, depthCm: 90 }),
    ]));
    fireEvent.click(screen.getByRole('button', { name: 'לינה וצל 2' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['a', 'b']);
    fireEvent.click(screen.getByRole('button', { name: 'מגורים 1' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['s']);
  });

  it('lists every problem as a row that selects what it names, and the shade the nets give', () => {
    const { onPickIds } = renderPlot(doc([
      item({ id: 'n', kind: 'shade', label: 'רשת צל 1', xCm: 0, yCm: 0, widthCm: 800, depthCm: 800, insetCm: 50 }),
      item({ id: 's', kind: 'sofa', label: 'ספה 1', xCm: 20, yCm: 100, widthCm: 200, depthCm: 90 }),
      item({ id: 'a', label: 'אוהל 1', xCm: 2500 }),
      item({ id: 'b', label: 'אוהל 2', xCm: 1000, yCm: 1000 }),
      item({ id: 'c', label: 'אוהל 3', xCm: 1100, yCm: 1050 }),
    ]));
    fireEvent.click(screen.getByRole('button', { name: 'מחוץ לגדר: אוהל 1' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['a']);
    fireEvent.click(screen.getByRole('button', { name: 'חפיפה: אוהל 2 · אוהל 3' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['b', 'c']);
    fireEvent.click(screen.getByRole('button', { name: 'בשולי רשת צל: ספה 1' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['s']);
    expect(screen.getByText('49 מ״ר')).toBeTruthy();
  });

  it('says which way north is, in words a lead can check against the sun', () => {
    expect(northText(0)).toBe('הצפון למעלה במפה');
    expect(northText(45)).toBe('למעלה במפה פונה לצפון־מזרח (45°)');
    expect(northText(90)).toBe('למעלה במפה פונה למזרח (90°)');
    expect(northText(200)).toBe('למעלה במפה פונה לדרום (200°)');
    expect(northText(359)).toBe('למעלה במפה פונה לצפון (359°)');
    renderPlot(doc([], 90));
    expect(screen.getByRole('link', { name: 'למעלה במפה פונה למזרח (90°)' }).getAttribute('href')).toBe(HREF);
  });
});
```

Create `src/app/(admin)/site/editor/panels/inspector-item.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { derive, toPlaced } from '@/lib/site/derive';
import { overlapPairs } from '@/lib/site/geometry';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { applyOps, type SiteOp } from '@/lib/site/editor/ops';
import { NOT_A_LENGTH } from '@/lib/site/editor/metres';
import { LABEL_REQUIRED } from '../../failure-messages';
import type { EditorFlags } from '../use-editor-store';
import { ItemInspector } from './inspector-item';

/* This file's own fixture. */
function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function doc(items: EditorItem[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, defaults: {} };
}

function flagsOf(map: EditorDoc): EditorFlags {
  const { items } = derive(map.plot, map.items);
  return {
    outside: new Set(items.filter((entry) => entry.outside).map((entry) => entry.id)),
    overlapping: new Set(items.filter((entry) => entry.overlapping).map((entry) => entry.id)),
    partly: new Set(items.filter((entry) => entry.shade === 'partly').map((entry) => entry.id)),
    pairs: overlapPairs(map.items.map(toPlaced)),
  };
}

function renderItem(over: Partial<EditorItem> = {}, others: EditorItem[] = []) {
  const shown = item({ id: 'a', ...over });
  const map = doc([shown, ...others]);
  const onRun = vi.fn<(label: string, ops: SiteOp[]) => void>();
  const onPickIds = vi.fn();
  render(
    <ItemInspector
      doc={map}
      item={shown}
      flags={flagsOf(map)}
      buildTasks={[{ id: 't1', title: 'הקמת הצל' }]}
      onRun={onRun}
      onPickIds={onPickIds}
    />,
  );
  /** What the store would hold after the edit — `applyOps`, the rule the store uses. */
  const after = () => {
    const call = onRun.mock.lastCall;
    if (call === undefined) throw new Error('nothing was run');
    return applyOps(map, call[1]).doc;
  };
  return { onRun, onPickIds, after };
}

const box = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

function type(name: string, text: string): void {
  fireEvent.change(box(name), { target: { value: text } });
  fireEvent.keyDown(box(name), { key: 'Enter' });
}

describe('one item', () => {
  it('shows it in metres, says the height is its kind’s, and says it was typed by hand', () => {
    renderItem();
    expect(screen.getByRole('heading', { name: 'אוהל 1' })).toBeTruthy();
    expect(box('רוחב').value).toBe('3');
    expect(box('עומק').value).toBe('2');
    expect(box('גובה').value).toBe('');
    expect(box('גובה').placeholder).toBe('2');
    expect(screen.getByText('גובה ברירת מחדל')).toBeTruthy();
    expect(box('ממערב').value).toBe('5');
    expect(box('מצפון').value).toBe('5');
    expect(screen.getByRole('img', { name: 'מקור: נרשם ידנית' })).toBeTruthy();
  });

  it('applies a size typed the way people type it, about the item’s middle', () => {
    const { after } = renderItem();
    type('רוחב', '2,5');
    expect(after().items[0]).toMatchObject({ widthCm: 250, depthCm: 200, xCm: 525, yCm: 500 });
  });

  it('refuses what is not a length, in Hebrew, and sends nothing', () => {
    const { onRun } = renderItem();
    const said: Record<string, string> = {
      abc: NOT_A_LENGTH,
      '1.234': NOT_A_LENGTH,
      0: 'צריך מספר בין 0.1 ל־500 מטר',
      '-1': 'צריך מספר בין 0.1 ל־500 מטר',
    };
    for (const [text, refusal] of Object.entries(said)) {
      type('רוחב', text);
      // `readMetres` isolates each number with U+2066…U+2069 so it keeps its place in RTL; read past them.
      const shown = (screen.getByRole('alert').textContent ?? '').replace(/[⁦-⁩]/g, '');
      expect(shown).toBe(refusal);
      expect(shown).toMatch(/[֐-׿]/);
      expect(shown).not.toMatch(/[A-Za-z]/);
      expect(box('רוחב').getAttribute('aria-invalid')).toBe('true');
    }
    expect(onRun).not.toHaveBeenCalled();
  });

  it('leaves a box that was emptied as it was', () => {
    const { onRun } = renderItem();
    type('רוחב', '');
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renames and moves on Enter, and refuses a blank name', () => {
    const { after, onRun } = renderItem();
    fireEvent.change(box('שם'), { target: { value: '  אוהל הצוות ' } });
    type('ממערב', '12,5');
    expect(after().items[0]).toMatchObject({ label: 'אוהל הצוות', xCm: 1250 });
    onRun.mockClear();
    type('שם', '   ');
    expect(screen.getByRole('alert').textContent).toBe(LABEL_REQUIRED);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('keeps a locked item where it is: its size and place cannot be typed, its name can', () => {
    renderItem({ locked: true });
    for (const name of ['רוחב', 'עומק', 'גובה', 'ממערב', 'מצפון']) expect(box(name).disabled).toBe(true);
    expect(box('שם').disabled).toBe(false);
    expect(screen.getByText('הפריט נעול. שחרור הנעילה מאפשר להזיז אותו ולשנות את מידותיו.')).toBeTruthy();
  });

  it('names what it overlaps, and the name selects both', () => {
    const { onPickIds } = renderItem({}, [item({ id: 'b', label: 'אוהל 2', xCm: 600, yCm: 550 })]);
    fireEvent.click(screen.getByRole('button', { name: 'חפיפה עם אוהל 2' }));
    expect(onPickIds).toHaveBeenCalledWith(['a', 'b']);
  });

  it('keeps these sizes as the kind’s default, and goes back to the default', () => {
    const { after } = renderItem();
    fireEvent.click(screen.getByRole('button', { name: 'שמירת המידות כברירת המחדל של אוהל' }));
    expect(after().defaults.tent).toEqual({ widthCm: 300, depthCm: 200, heightCm: 200, insetCm: null });
    fireEvent.click(screen.getByRole('button', { name: 'חזרה לברירת המחדל' }));
    expect(after().items[0]).toMatchObject({ widthCm: 300, depthCm: 300, heightCm: null });
  });
});
```

Create `src/app/(admin)/site/editor/panels/inspector-multi.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { applyOps, type SiteOp } from '@/lib/site/editor/ops';
import { NOT_A_LENGTH } from '@/lib/site/editor/metres';
import { MultiInspector } from './inspector-multi';

/* This file's own fixture: two tents that differ in width, and a caravan. */
function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

const T1 = item({ id: 't1' });
const T2 = item({ id: 't2', label: 'אוהל 2', xCm: 1000, widthCm: 350 });
const C = item({ id: 'c', kind: 'caravan', label: 'קראוון 1', xCm: 500, yCm: 1000, widthCm: 700, depthCm: 250 });

function renderMulti(items: EditorItem[]) {
  const map: EditorDoc = {
    plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, defaults: {},
  };
  const onRun = vi.fn<(label: string, ops: SiteOp[]) => void>();
  const onClear = vi.fn();
  render(<MultiInspector doc={map} ids={items.map((entry) => entry.id)} onRun={onRun} onClear={onClear} />);
  const after = () => {
    const call = onRun.mock.lastCall;
    if (call === undefined) throw new Error('nothing was run');
    return applyOps(map, call[1]).doc;
  };
  return { onRun, onClear, after };
}

const widths = () => screen.getAllByLabelText('רוחב') as HTMLInputElement[];
const byId = (items: EditorItem[], id: string) => items.find((entry) => entry.id === id);

describe('several items', () => {
  it('names what is selected, per kind, and says it was typed by hand', () => {
    renderMulti([T1, T2, C]);
    expect(screen.getByRole('heading', { name: 'נבחרו 3 פריטים' })).toBeTruthy();
    expect(screen.getByText('2 אוהלים · 1 קראוון')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'מקור: נרשם ידנית' })).toBeTruthy();
  });

  it('shows a size the tents share, and מעורב — never a number — where they differ', () => {
    renderMulti([T1, T2, C]);
    const [tentWidth, caravanWidth] = widths();
    expect(tentWidth.value).toBe('');
    expect(tentWidth.placeholder).toBe('מעורב');
    expect((screen.getAllByLabelText('עומק')[0] as HTMLInputElement).value).toBe('2');
    expect(caravanWidth.value).toBe('7');
  });

  it('applies a typed width to every tent in the selection, each about its own middle', () => {
    const { after } = renderMulti([T1, T2, C]);
    fireEvent.change(widths()[0], { target: { value: '4' } });
    fireEvent.keyDown(widths()[0], { key: 'Enter' });
    const items = after().items;
    expect(byId(items, 't1')).toMatchObject({ widthCm: 400, xCm: 450 });
    expect(byId(items, 't2')).toMatchObject({ widthCm: 400, xCm: 975 });
    expect(byId(items, 'c')).toMatchObject({ widthCm: 700, xCm: 500 });
  });

  it('refuses a width that is not one, in Hebrew', () => {
    const { onRun } = renderMulti([T1, T2]);
    fireEvent.change(widths()[0], { target: { value: 'abc' } });
    fireEvent.keyDown(widths()[0], { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe(NOT_A_LENGTH);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('stores no default while the tents differ, and says why', () => {
    const { onRun } = renderMulti([T1, T2]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'לשמור גם כברירת המחדל של אוהל' }));
    expect(screen.getByText('המידות של אוהלים בבחירה שונות זו מזו. ברירת המחדל תישמר כשיהיה להן ערך אחד.')).toBeTruthy();
    expect(onRun).not.toHaveBeenCalled();
  });

  it('stores the default the tents agree on', () => {
    const { after } = renderMulti([T1, item({ id: 't2', label: 'אוהל 2', xCm: 1000 })]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'לשמור גם כברירת המחדל של אוהל' }));
    expect(after().defaults.tent).toEqual({ widthCm: 300, depthCm: 200, heightCm: 200, insetCm: null });
  });

  it('aligns two or more, and distributes only three or more', () => {
    const { after } = renderMulti([T1, T2, C]);
    const spread = screen.getByRole('button', { name: 'פיזור שווה, מזרח־מערב' }) as HTMLButtonElement;
    expect(spread.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'יישור לקצה המערבי' }));
    expect(after().items.map((entry) => entry.xCm)).toEqual([500, 500, 500]);
  });

  it('keeps distribution off for two', () => {
    renderMulti([T1, T2]);
    const spread = screen.getByRole('button', { name: 'פיזור שווה, מזרח־מערב' }) as HTMLButtonElement;
    expect(spread.disabled).toBe(true);
  });

  it('arranges a row with the typed gap, and refuses a gap that is not a length', () => {
    const { after, onRun } = renderMulti([T1, T2, C]);
    const gap = screen.getByLabelText('מרווח בשורה') as HTMLInputElement;
    fireEvent.change(gap, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'סידור בשורה' }));
    const row = [...after().items].sort((a, b) => a.xCm - b.xCm);
    for (let index = 1; index < row.length; index += 1) {
      expect(row[index].xCm).toBe(row[index - 1].xCm + row[index - 1].widthCm + 100);
      expect(row[index].yCm).toBe(row[0].yCm);
    }
    onRun.mockClear();
    fireEvent.change(gap, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'סידור בשורה' }));
    expect(screen.getByRole('alert').textContent).toBe(NOT_A_LENGTH);
    expect(onRun).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run "src/app/(admin)/site/editor/panels/inspector-plot.test.tsx" "src/app/(admin)/site/editor/panels/inspector-item.test.tsx" "src/app/(admin)/site/editor/panels/inspector-multi.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `Failed to resolve import "./inspector-plot"`, `"./inspector-item"`, `"./inspector-multi"`.

- [ ] **Step 3: Append the inspector's styles**

Append to `src/app/(admin)/site/editor/editor.module.css`:

```css
/* ---- the inspector ---------------------------------------------------- */

/* At the inline end — the left edge here — stopping short of the 154px
   minimap under it (12 + 154 + 12 + 8 = 186). */
.inspector {
  inset-block-start: 12px;
  inset-inline-end: 12px;
  inline-size: 292px;
  max-block-size: calc(100% - 186px);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-block: 10px;
  padding-inline: 12px;
  border-block-end: 1px solid var(--line);
}

.headTitle {
  margin: 0;
  font-size: var(--text-cell);
  font-weight: 600;
}

.headEnd {
  margin-inline-start: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sectionTitle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  color: var(--ink);
  font-size: var(--text-meta);
  font-weight: 600;
}

.sectionMeta {
  margin-inline-start: auto;
  color: var(--ink-3);
  font-size: var(--text-label);
  font-weight: 400;
}

.divider {
  block-size: 1px;
  flex-shrink: 0;
  background: var(--line);
}

.kv {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 6px 10px;
  align-items: center;
  margin: 0;
  font-size: var(--text-dense);
}
.kv dt { color: var(--ink-3); }
.kv dd { margin: 0; }

.fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.fieldsTwo { grid-template-columns: repeat(2, minmax(0, 1fr)); }

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-inline-size: 0;
  color: var(--ink-3);
  font-size: var(--text-label);
}

.input {
  inline-size: 100%;
  min-inline-size: 0;
  block-size: 32px;
  padding-inline: var(--space-2);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--ink);
  font-size: var(--text-dense);
}
.input:focus-visible { border-color: var(--focus); }
.input[aria-invalid='true'] { border-color: var(--bad); }
.input:disabled { background: var(--sunken); color: var(--ink-3); }
textarea.input { block-size: 56px; padding-block: 6px; resize: none; }

/* A typed figure reads left to right whatever the page's direction (A11). */
.number {
  direction: ltr;
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.error {
  margin: 0;
  color: var(--bad);
  font-size: var(--text-meta);
}

.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--brand-text);
  font-size: var(--text-meta);
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
}
.link:hover { text-decoration: underline; }
.link:disabled { color: var(--ink-4); cursor: not-allowed; text-decoration: none; }

.links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.chipButton {
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.meta {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--text-label);
}

.foot {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding-block: var(--space-2);
  padding-inline: 10px;
  border-block-start: 1px solid var(--line);
  background: var(--sunken);
}

.pushEnd { margin-inline-start: auto; }

.iconButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 28px;
  block-size: 28px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}
.iconButton:hover { background: var(--sunken); color: var(--ink); }
.iconButton[aria-pressed='true'] { background: var(--brand-soft); color: var(--brand-text); }

.groupStat {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  inline-size: 100%;
  padding-block: 2px;
  padding-inline: 0;
  border: 0;
  background: none;
  color: var(--ink);
  font-size: var(--text-meta);
  text-align: start;
  cursor: pointer;
}
.groupStat:hover .groupName { text-decoration: underline; }
.groupCount { margin-inline-start: auto; color: var(--ink-3); }

.issue {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  inline-size: 100%;
  padding-block: 6px;
  padding-inline: var(--space-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--panel);
  color: var(--ink);
  font-size: var(--text-meta);
  text-align: start;
  cursor: pointer;
}
.issue:hover { background: var(--hover); }
.issueText { flex: 1; }

.kindRow {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
}

.kindHead {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-dense);
  font-weight: 600;
}

.kindCount {
  color: var(--ink-3);
  font-size: var(--text-meta);
  font-weight: 500;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-2);
  font-size: var(--text-meta);
  cursor: pointer;
}
.check input { inline-size: 14px; block-size: 14px; margin: 0; accent-color: var(--brand); }

.controlsRow {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}

.gapField { inline-size: 96px; }
```

- [ ] **Step 4: Write `north.ts` and `selection-actions.tsx`**

Create `src/app/(admin)/site/editor/panels/north.ts`:

```ts
/** The eight compass words, clockwise from north. */
const COMPASS = ['צפון', 'צפון־מזרח', 'מזרח', 'דרום־מזרח', 'דרום', 'דרום־מערב', 'מערב', 'צפון־מערב'] as const;

/**
 * Which way the map's "up" faces (`north_deg`, spec §5 and §11), in words a
 * lead can check against the sun: 0 is north up; 90 means up is east.
 */
export function northText(northDeg: number): string {
  if (northDeg === 0) return 'הצפון למעלה במפה';
  const word = COMPASS[Math.round(northDeg / 45) % 8];
  return `למעלה במפה פונה ל${word} (${northDeg}°)`;
}
```

Create `src/app/(admin)/site/editor/panels/selection-actions.tsx`:

```tsx
'use client';

/**
 * Turn, duplicate, lock and remove (spec §10) — one set of buttons for the
 * inspector's footer (`labelled`) and for the selection bar floating by the
 * selection (icons, each named). The handlers are SiteEditor's, so every one
 * of these edits says what it did the same way from either place.
 *
 * The lock is a switch: `aria-pressed` carries the state and the name stays
 * "נעילה", rather than a name that flips between two verbs.
 */

import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { EditorIcon } from './editor-icons';
import styles from '../editor.module.css';

export function SelectionActions({ locked, labelled, onTurn, onDuplicate, onLock, onRemove }: {
  /** Every selected item is locked. */
  locked: boolean;
  labelled: boolean;
  onTurn: () => void;
  onDuplicate: () => void;
  onLock: () => void;
  onRemove: () => void;
}): ReactElement {
  const lock = (
    <button type="button" className={styles.iconButton} aria-label="נעילה" aria-pressed={locked} onClick={onLock}>
      <EditorIcon name="lock" size={14} />
    </button>
  );

  if (labelled) {
    return (
      <>
        <Button size="sm" onClick={onTurn}>
          <EditorIcon name="turn" size={14} />
          סיבוב
        </Button>
        <Button size="sm" onClick={onDuplicate}>
          <Icon name="copy" size={14} />
          שכפול
        </Button>
        {lock}
        <span className={styles.pushEnd}>
          <Button size="sm" tone="danger" onClick={onRemove}>
            <Icon name="trash" size={14} />
            הסרה
          </Button>
        </span>
      </>
    );
  }

  return (
    <>
      <button type="button" className={styles.iconButton} aria-label="סיבוב ברבע" onClick={onTurn}>
        <EditorIcon name="turn" size={14} />
      </button>
      <button type="button" className={styles.iconButton} aria-label="שכפול" onClick={onDuplicate}>
        <Icon name="copy" size={14} />
      </button>
      {lock}
      <button type="button" className={styles.iconButton} aria-label="הסרה" onClick={onRemove}>
        <Icon name="trash" size={14} />
      </button>
    </>
  );
}
```

- [ ] **Step 5: Write the three inspectors**

Create `src/app/(admin)/site/editor/panels/inspector-plot.tsx`:

```tsx
'use client';

/**
 * Nothing selected: the plot (spec §10). Its size, grid and north — each a
 * link to the drawer that changes it (§13) — its area, what is on it per
 * group (a group's count selects the group), the shade its nets give, and
 * every problem as a row that selects what it names. All of it typed by a
 * lead: "נרשם ידנית".
 */

import Link from 'next/link';
import type { ReactElement } from 'react';
import { cx } from '@/components/ui/cx';
import { SourceChip } from '@/components/ui/source-chip';
import { toPlaced } from '@/lib/site/derive';
import { areaM2, formatArea, formatMetres, formatSize, shadeCounts } from '@/lib/site/geometry';
import { KIND_GROUP_LABELS, KIND_GROUP_ORDER, SITE_KINDS } from '@/lib/site/kinds';
import type { EditorDoc } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { northText } from './north';
import styles from '../editor.module.css';

interface Problem {
  key: string;
  tone: 'bad' | 'warn';
  text: string;
  ids: string[];
}

function problemsOf(doc: EditorDoc, flags: EditorFlags): Problem[] {
  const labelOf = (id: string) => doc.items.find((entry) => entry.id === id)?.label ?? '';
  return [
    ...doc.items.filter((entry) => flags.outside.has(entry.id)).map((entry): Problem => ({
      key: `outside:${entry.id}`, tone: 'bad', text: `מחוץ לגדר: ${entry.label}`, ids: [entry.id],
    })),
    ...flags.pairs.map(([a, b]): Problem => ({
      key: `pair:${a}:${b}`, tone: 'warn', text: `חפיפה: ${labelOf(a)} · ${labelOf(b)}`, ids: [a, b],
    })),
    ...doc.items.filter((entry) => flags.partly.has(entry.id)).map((entry): Problem => ({
      key: `edge:${entry.id}`, tone: 'warn', text: `בשולי רשת צל: ${entry.label}`, ids: [entry.id],
    })),
  ];
}

export function PlotInspector({ doc, flags, plotHref, onPickIds }: {
  doc: EditorDoc;
  flags: EditorFlags;
  plotHref: string;
  onPickIds: (ids: string[]) => void;
}): ReactElement {
  const { plot, items } = doc;
  const shade = shadeCounts(items.map(toPlaced));
  const problems = problemsOf(doc, flags);
  const groups = KIND_GROUP_ORDER
    .map((group) => ({ group, ids: items.filter((entry) => SITE_KINDS[entry.kind].group === group).map((entry) => entry.id) }))
    .filter((entry) => entry.ids.length > 0);

  return (
    <>
      <header className={styles.head}>
        <h2 className={styles.headTitle}>המגרש</h2>
        <span className={styles.headEnd}><SourceChip source={{ kind: 'manual' }} /></span>
      </header>
      <div className={styles.body}>
        <dl className={styles.kv}>
          <dt>גודל</dt>
          <dd><Link href={plotHref} className={styles.link}><bdi>{formatSize(plot.widthCm, plot.depthCm)}</bdi></Link></dd>
          <dt>שטח</dt>
          <dd><bdi>{formatArea(areaM2(plot))}</bdi></dd>
          <dt>רשת הצמדה</dt>
          <dd><Link href={plotHref} className={styles.link}><bdi>{formatMetres(plot.gridCm)}</bdi></Link></dd>
          <dt>צפון</dt>
          <dd><Link href={plotHref} className={styles.link}><bdi>{northText(plot.northDeg)}</bdi></Link></dd>
        </dl>

        <div className={styles.divider} />
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            מה יש במפה
            <span className={styles.sectionMeta}><bdi>{`${items.length} פריטים`}</bdi></span>
          </h3>
          {groups.length === 0 ? (
            <p className={styles.hint}>המפה ריקה. גרירה של פריט מהספרייה אל המפה, או לחיצה עליו, מניחה את הראשון.</p>
          ) : groups.map(({ group, ids }) => (
            <button key={group} type="button" className={styles.groupStat} onClick={() => { onPickIds(ids); }}>
              <span className={cx(styles.swatch, styles[`g_${group}`])} aria-hidden="true" />
              <span className={styles.groupName}>{KIND_GROUP_LABELS[group]}</span>
              {' '}
              <span className={styles.groupCount}><bdi>{ids.length}</bdi></span>
            </button>
          ))}
        </div>

        <div className={styles.divider} />
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>צל</h3>
          {shade.nets === 0 ? (
            <p className={styles.hint}>אין רשתות צל במפה.</p>
          ) : (
            <dl className={styles.kv}>
              <dt>שטח בצל</dt>
              <dd><bdi>{formatArea(shade.shadedAreaM2)}</bdi></dd>
              <dt>רשתות צל</dt>
              <dd><bdi>{shade.nets}</bdi></dd>
            </dl>
          )}
          <p className={styles.hint}>
            רשת של 8 × 8 עם חצי מטר שוליים מצלה על 7 × 7. מה שיושב בשוליים מסומן, כי בשרטוט הוא נראה מכוסה.
          </p>
        </div>

        <div className={styles.divider} />
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>בדיקות</h3>
          {problems.length === 0 ? (
            <p className={styles.hint}>הכול בתוך הגדר, ושום דבר לא יושב על משהו אחר.</p>
          ) : problems.map((problem) => (
            <button key={problem.key} type="button" className={styles.issue} onClick={() => { onPickIds(problem.ids); }}>
              <span className={styles.issueDot} data-tone={problem.tone} aria-hidden="true" />
              <span className={styles.issueText}>{problem.text}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
```

(`styles.groupName` is used only as a hover target; CSS Modules give an unused class name `undefined`, which React drops. Add `.groupName {}` nowhere — the `.groupStat:hover .groupName` rule in Step 3 declares it.)

Create `src/app/(admin)/site/editor/panels/inspector-item.tsx`:

```tsx
'use client';

/**
 * One item, typed to the centimetre (spec §10): what a drag does roughly,
 * this does precisely — name, size and height, place, a net's unshaded strip,
 * the build task and the notes. Lengths are typed in metres, the way a lead
 * measures on the playa, and read by `readMetres` (Review Focus #2): an empty
 * box leaves the value; a refusal is Hebrew and nothing is sent. An edit is
 * applied on Enter or when the box is left.
 *
 * A locked item keeps its size, height and place until it is unlocked, so
 * the boxes for exactly the fields `ops.ts`'s `LOCKED_FIELDS` names are
 * disabled rather than refused after the fact — one lock rule, one list.
 */

import { useId, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { Pill } from '@/components/ui/pill';
import { SourceChip } from '@/components/ui/source-chip';
import { effectiveSize, itemHeight } from '@/lib/site/defaults';
import { toPlaced } from '@/lib/site/derive';
import { areaM2, formatArea, formatSize, metres, shadedRect, shadeState } from '@/lib/site/geometry';
import { DEFAULT_SHADE_INSET_CM, SITE_KINDS } from '@/lib/site/kinds';
import { rectOf, type EditorDoc, type EditorItem } from '@/lib/site/editor/model';
import { LOCKED_FIELDS, type ItemPatch, type SiteOp } from '@/lib/site/editor/ops';
import { patchOps, resetSizeOps, setKindDefaultOps } from '@/lib/site/editor/commands';
import {
  GAP_RANGE, HEIGHT_RANGE, POSITION_RANGE, SIDE_RANGE, readMetres, type MetresRange,
} from '@/lib/site/editor/metres';
import { LABEL_REQUIRED } from '../../failure-messages';
import type { EditorFlags } from '../use-editor-store';
import styles from '../editor.module.css';

type Length = 'width' | 'depth' | 'height' | 'x' | 'y' | 'inset';
type Field = Length | 'label' | 'notes';

/**
 * Every length a lead types here: the range plan 02's `readMetres` checks it
 * against, and the patch field it writes — which is how a lock disables it.
 */
const LENGTHS: ReadonlyArray<{ field: Length; range: MetresRange; key: keyof ItemPatch }> = [
  { field: 'width', range: SIDE_RANGE, key: 'widthCm' },
  { field: 'depth', range: SIDE_RANGE, key: 'depthCm' },
  { field: 'height', range: HEIGHT_RANGE, key: 'heightCm' },
  { field: 'x', range: POSITION_RANGE, key: 'xCm' },
  { field: 'y', range: POSITION_RANGE, key: 'yCm' },
  { field: 'inset', range: GAP_RANGE, key: 'insetCm' },
];

/** Whether a lock holds this box: its field is one `LOCKED_FIELDS` names. */
function heldByLock(item: EditorItem, field: Length): boolean {
  const key = LENGTHS.find((rule) => rule.field === field)?.key;
  // Widened for `includes`, whether `ops.ts` declares the list as an array or a tuple.
  return item.locked && key !== undefined && (LOCKED_FIELDS as ReadonlyArray<keyof ItemPatch>).includes(key);
}

function size3(widthCm: number, depthCm: number, heightCm: number): string {
  return `${metres(widthCm)} × ${metres(depthCm)} × ${metres(heightCm)} מ׳`;
}

export function ItemInspector({ doc, item, flags, buildTasks, onRun, onPickIds, footer }: {
  doc: EditorDoc;
  item: EditorItem;
  flags: EditorFlags;
  buildTasks: ReadonlyArray<{ id: string; title: string }>;
  onRun: (label: string, ops: SiteOp[]) => void;
  onPickIds: (ids: string[]) => void;
  /** Turn, duplicate, lock and remove — SiteEditor's, so their toasts are too. */
  footer?: ReactNode;
}): ReactElement {
  const errorId = useId();
  const [drafts, setDrafts] = useState<Partial<Record<Field, string>>>({});
  const [refusal, setRefusal] = useState<{ field: Field; message: string } | null>(null);

  const preset = SITE_KINDS[item.kind];
  const standard = effectiveSize(item.kind, doc.defaults);
  const height = itemHeight(item, doc.defaults);
  const isNet = item.kind === 'shade';
  const onStandardSize = item.widthCm === standard.widthCm && item.depthCm === standard.depthCm;
  const shaded = isNet ? shadedRect(toPlaced(item)) : null;

  const partners = flags.pairs.flatMap(([a, b]) => (a === item.id ? [b] : b === item.id ? [a] : []));
  const partnerNames = partners
    .map((id) => doc.items.find((other) => other.id === id)?.label)
    .filter((label): label is string => label !== undefined);
  const nets = doc.items.filter((other) => other.kind === 'shade').map(toPlaced);
  const inShade = !isNet && nets.length > 0 && shadeState(rectOf(item), nets) === 'shaded';

  function draft(field: Field, value: string): void {
    setDrafts((current) => ({ ...current, [field]: value }));
  }

  function commit(): void {
    if (Object.keys(drafts).length === 0) return;
    const patch: ItemPatch = {};
    if (drafts.label !== undefined) {
      if (drafts.label.trim() === '') {
        setRefusal({ field: 'label', message: LABEL_REQUIRED });
        return;
      }
      patch.label = drafts.label;
    }
    const typed: Partial<Record<Length, number>> = {};
    for (const rule of LENGTHS) {
      const text = drafts[rule.field];
      if (text === undefined) continue;
      const reading = readMetres(text, rule.range);
      if (!reading.ok) {
        setRefusal({ field: rule.field, message: reading.error });
        return;
      }
      if (reading.cm !== null) typed[rule.field] = reading.cm;
    }
    const widthCm = typed.width ?? item.widthCm;
    const depthCm = typed.depth ?? item.depthCm;
    if (widthCm !== item.widthCm || depthCm !== item.depthCm) {
      // About its own middle, like every resize the inspectors make (§10).
      patch.widthCm = widthCm;
      patch.depthCm = depthCm;
      patch.xCm = Math.round((item.xCm * 2 + item.widthCm - widthCm) / 2);
      patch.yCm = Math.round((item.yCm * 2 + item.depthCm - depthCm) / 2);
    }
    if (typed.x !== undefined) patch.xCm = typed.x;
    if (typed.y !== undefined) patch.yCm = typed.y;
    if (typed.height !== undefined) patch.heightCm = typed.height;
    if (typed.inset !== undefined) patch.insetCm = typed.inset;
    if (drafts.notes !== undefined) patch.notes = drafts.notes;
    setDrafts({});
    setRefusal(null);
    // `patchOps` stores it the way the server will (trimmed, blank notes as none) and drops what did not change.
    const ops = patchOps(doc, item.id, patch);
    if (ops.length > 0) onRun(`עריכת ${item.label}`, ops);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      setDrafts({});
      setRefusal(null);
    }
  }

  function lengthBox(field: Length, label: string, value: string, placeholder?: string): ReactElement {
    const refused = refusal?.field === field;
    return (
      <label className={styles.field}>
        {label}
        <input
          className={cx(styles.input, styles.number)}
          inputMode="decimal"
          value={drafts[field] ?? value}
          placeholder={placeholder}
          disabled={heldByLock(item, field)}
          aria-invalid={refused || undefined}
          aria-describedby={refused ? errorId : undefined}
          onChange={(event) => { draft(field, event.target.value); }}
          onBlur={commit}
          onKeyDown={onKey}
        />
      </label>
    );
  }

  function saveAsDefault(): void {
    const ops = setKindDefaultOps(doc, item.kind, {
      widthCm: item.widthCm,
      depthCm: item.depthCm,
      heightCm: height,
      insetCm: isNet ? (item.insetCm ?? DEFAULT_SHADE_INSET_CM) : null,
    });
    if (ops.length > 0) onRun(`ברירת המחדל של ${preset.label}`, ops);
  }

  function backToDefault(): void {
    const ops = resetSizeOps(doc, [item.id]);
    if (ops.length > 0) onRun('חזרה לברירת המחדל', ops);
  }

  function setTask(value: string): void {
    const ops = patchOps(doc, item.id, { taskId: value === '' ? null : value });
    if (ops.length > 0) onRun('משימת הקמה', ops);
  }

  const labelRefused = refusal?.field === 'label';

  return (
    <>
      <header className={styles.head}>
        <span className={cx(styles.swatch, styles[`g_${preset.group}`])} aria-hidden="true" />
        <h2 className={styles.headTitle}>{item.label}</h2>
        <span className={styles.meta}>{preset.label}</span>
        {item.locked ? <Pill tone="neutral">נעול</Pill> : null}
        <span className={styles.headEnd}>
          <SourceChip source={{ kind: 'manual' }} />
          <Button tone="ghost" size="sm" iconLabel="ביטול הבחירה" onClick={() => { onPickIds([]); }}>
            <Icon name="x" size={14} />
          </Button>
        </span>
      </header>

      <div className={styles.body}>
        <label className={styles.field}>
          שם
          <input
            className={styles.input}
            value={drafts.label ?? item.label}
            aria-invalid={labelRefused || undefined}
            aria-describedby={labelRefused ? errorId : undefined}
            onChange={(event) => { draft('label', event.target.value); }}
            onBlur={commit}
            onKeyDown={onKey}
          />
        </label>

        <div className={styles.pills}>
          {flags.outside.has(item.id) ? <Pill tone="bad" dot>מחוץ לגדר</Pill> : null}
          {partnerNames.length > 0 ? (
            <button type="button" className={styles.chipButton} onClick={() => { onPickIds([item.id, ...partners]); }}>
              <Pill tone="warn" dot>{`חפיפה עם ${partnerNames.join(', ')}`}</Pill>
            </button>
          ) : null}
          {flags.partly.has(item.id) ? <Pill tone="warn" dot>בשולי רשת הצל, בלי צל</Pill> : null}
          {inShade ? <Pill tone="ok" dot>בצל</Pill> : null}
        </div>

        {refusal === null ? null : <p className={styles.error} id={errorId} role="alert">{refusal.message}</p>}
        {item.locked ? (
          <p className={styles.hint}>הפריט נעול. שחרור הנעילה מאפשר להזיז אותו ולשנות את מידותיו.</p>
        ) : null}

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            מידות
            <span className={styles.sectionMeta}>{onStandardSize ? 'ברירת מחדל · במטרים' : 'במטרים'}</span>
          </h3>
          <div className={styles.fields}>
            {lengthBox('width', 'רוחב', metres(item.widthCm))}
            {lengthBox('depth', 'עומק', metres(item.depthCm))}
            {lengthBox('height', 'גובה', item.heightCm === null ? '' : metres(item.heightCm), item.heightCm === null ? metres(height) : undefined)}
          </div>
          {item.heightCm === null ? <p className={styles.meta}>גובה ברירת מחדל</p> : null}
          <p className={styles.hint}>
            <bdi>{`ברירת המחדל של ${preset.label}: ${size3(standard.widthCm, standard.depthCm, standard.heightCm)}`}</bdi>
          </p>
          <div className={styles.links}>
            <button type="button" className={styles.link} onClick={saveAsDefault}>
              {`שמירת המידות כברירת המחדל של ${preset.label}`}
            </button>
            <button type="button" className={styles.link} onClick={backToDefault} disabled={item.locked}>
              חזרה לברירת המחדל
            </button>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            מיקום
            <span className={styles.sectionMeta}>מטרים מהפינה הצפון־מערבית</span>
          </h3>
          <div className={cx(styles.fields, styles.fieldsTwo)}>
            {lengthBox('x', 'ממערב', metres(item.xCm))}
            {lengthBox('y', 'מצפון', metres(item.yCm))}
          </div>
        </div>

        {isNet ? (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>צל</h3>
            <div className={cx(styles.fields, styles.fieldsTwo)}>
              {lengthBox('inset', 'שוליים בלי צל', metres(item.insetCm ?? DEFAULT_SHADE_INSET_CM))}
              <p className={styles.meta}>
                מצל בפועל
                <br />
                <bdi>{shaded === null ? 'הרשת קטנה מכדי להצל' : `${formatSize(shaded.width, shaded.depth)} · ${formatArea(areaM2(shaded))}`}</bdi>
              </p>
            </div>
          </div>
        ) : null}

        <label className={styles.field}>
          משימת הקמה
          <select className={styles.input} value={item.taskId ?? ''} onChange={(event) => { setTask(event.target.value); }}>
            <option value="">ללא משימת הקמה</option>
            {buildTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
        </label>

        <label className={styles.field}>
          הערות
          <textarea
            className={styles.input}
            rows={2}
            placeholder="למשל: הפתח לכיוון הרחוב"
            value={drafts.notes ?? item.notes ?? ''}
            onChange={(event) => { draft('notes', event.target.value); }}
            onBlur={commit}
          />
        </label>
      </div>

      {footer === undefined ? null : <footer className={styles.foot}>{footer}</footer>}
    </>
  );
}
```

Create `src/app/(admin)/site/editor/panels/inspector-multi.tsx`:

```tsx
'use client';

/**
 * Several items (spec §10). Sizes are per kind, so there is one row per kind:
 * a width typed there goes to every item of that kind in the selection, each
 * resized about its own middle. A value the selection does not share shows
 * empty, with מעורב as the placeholder — never a made-up number (§13). A
 * kind's default is stored only when the selected items of that kind agree;
 * until then the row says so and stores nothing.
 *
 * Then align, distribute and a row with a typed gap. Every typed length goes
 * through `readMetres` (plan 02).
 */

import { useState, type ReactElement, type ReactNode } from 'react';
import type { SiteItemKind } from '@/db/schema/site';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { SourceChip } from '@/components/ui/source-chip';
import { effectiveSize, type KindSize } from '@/lib/site/defaults';
import { metres } from '@/lib/site/geometry';
import { DEFAULT_SHADE_INSET_CM, KIND_ORDER, SITE_KINDS } from '@/lib/site/kinds';
import { findItem, type EditorDoc, type EditorItem } from '@/lib/site/editor/model';
import { applyOps, type SiteOp } from '@/lib/site/editor/ops';
import {
  alignOps, distributeOps, resetSizeOps, resizeKindOps, rowOps, setKindDefaultOps, uniformSize,
  type Alignment,
} from '@/lib/site/editor/commands';
import {
  GAP_RANGE, HEIGHT_RANGE, NOT_A_LENGTH, SIDE_RANGE, readMetres, type MetresRange,
} from '@/lib/site/editor/metres';
import { EditorIcon, type EditorIconName } from './editor-icons';
import styles from '../editor.module.css';

type SizeField = 'width' | 'depth' | 'height';

const SIZES: ReadonlyArray<{ field: SizeField; label: string; range: MetresRange }> = [
  { field: 'width', label: 'רוחב', range: SIDE_RANGE },
  { field: 'depth', label: 'עומק', range: SIDE_RANGE },
  { field: 'height', label: 'גובה', range: HEIGHT_RANGE },
];

const ALIGN: ReadonlyArray<{ how: Alignment; icon: EditorIconName; label: string }> = [
  { how: 'west', icon: 'alignWest', label: 'יישור לקצה המערבי' },
  { how: 'centreX', icon: 'alignCentreX', label: 'יישור למרכז, מזרח־מערב' },
  { how: 'east', icon: 'alignEast', label: 'יישור לקצה המזרחי' },
  { how: 'north', icon: 'alignNorth', label: 'יישור לקצה הצפוני' },
  { how: 'centreY', icon: 'alignCentreY', label: 'יישור למרכז, צפון־דרום' },
  { how: 'south', icon: 'alignSouth', label: 'יישור לקצה הדרומי' },
];

function size3(size: { widthCm: number; depthCm: number; heightCm: number }): string {
  return `${metres(size.widthCm)} × ${metres(size.depthCm)} × ${metres(size.heightCm)} מ׳`;
}

/** The default the selected items of one kind agree on — sides, height, and a net's strip — or null: nothing is guessed. */
function agreedSize(doc: EditorDoc, ids: readonly string[], kind: SiteItemKind): KindSize | null {
  const shared = uniformSize(doc, ids, kind);
  if (shared.widthCm === null || shared.depthCm === null || shared.heightCm === null) return null;
  if (kind !== 'shade') {
    return { widthCm: shared.widthCm, depthCm: shared.depthCm, heightCm: shared.heightCm, insetCm: null };
  }
  const insets = new Set(ids.map((id) => findItem(doc, id)?.insetCm ?? DEFAULT_SHADE_INSET_CM));
  if (insets.size !== 1) return null;
  return { widthCm: shared.widthCm, depthCm: shared.depthCm, heightCm: shared.heightCm, insetCm: [...insets][0] };
}

function KindRow({ doc, kind, ids, onRun }: {
  doc: EditorDoc;
  kind: SiteItemKind;
  ids: string[];
  onRun: (label: string, ops: SiteOp[]) => void;
}): ReactElement {
  const [drafts, setDrafts] = useState<Partial<Record<SizeField, string>>>({});
  const [keep, setKeep] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const preset = SITE_KINDS[kind];
  const shared = uniformSize(doc, ids, kind);
  const sharedCm: Record<SizeField, number | null> = { width: shared.widthCm, depth: shared.depthCm, height: shared.heightCm };
  const agreed = agreedSize(doc, ids, kind);
  const standard = effectiveSize(kind, doc.defaults);

  function commit(storeDefault: boolean): void {
    const size: { widthCm?: number; depthCm?: number; heightCm?: number } = {};
    for (const { field, range } of SIZES) {
      const text = drafts[field];
      if (text === undefined) continue;
      const reading = readMetres(text, range);
      if (!reading.ok) {
        setRefusal(reading.error);
        return;
      }
      if (reading.cm === null) continue;
      if (field === 'width') size.widthCm = reading.cm;
      else if (field === 'depth') size.depthCm = reading.cm;
      else size.heightCm = reading.cm;
    }
    let ops: SiteOp[] = Object.keys(size).length > 0 ? resizeKindOps(doc, ids, kind, size) : [];
    if (storeDefault) {
      // Asked of the map as it will be once the sizes above are applied.
      const after = applyOps(doc, ops).doc;
      const sizeAfter = agreedSize(after, ids, kind);
      if (sizeAfter !== null) ops = [...ops, ...setKindDefaultOps(after, kind, sizeAfter)];
    }
    setDrafts({});
    setRefusal(null);
    if (ops.length > 0) onRun(`מידות של ${preset.plural}`, ops);
  }

  return (
    <div className={styles.kindRow}>
      <div className={styles.kindHead}>
        <span className={cx(styles.swatch, styles[`g_${preset.group}`])} aria-hidden="true" />
        {preset.label}
        <span className={styles.kindCount}>
          ×
          {' '}
          <bdi>{ids.length}</bdi>
        </span>
      </div>
      <div className={styles.fields}>
        {SIZES.map(({ field, label }) => {
          const cm = sharedCm[field];
          return (
            <label key={field} className={styles.field}>
              {label}
              <input
                className={cx(styles.input, styles.number)}
                inputMode="decimal"
                value={drafts[field] ?? (cm === null ? '' : metres(cm))}
                placeholder={cm === null ? 'מעורב' : undefined}
                aria-invalid={refusal !== null || undefined}
                onChange={(event) => { setDrafts((current) => ({ ...current, [field]: event.target.value })); }}
                onBlur={() => { commit(keep); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commit(keep);
                  }
                }}
              />
            </label>
          );
        })}
      </div>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={keep}
          onChange={(event) => {
            setKeep(event.target.checked);
            if (event.target.checked) commit(true);
          }}
        />
        {`לשמור גם כברירת המחדל של ${preset.label}`}
      </label>
      {keep ? (
        <p className={styles.hint}>
          {agreed === null
            ? `המידות של ${preset.plural} בבחירה שונות זו מזו. ברירת המחדל תישמר כשיהיה להן ערך אחד.`
            : <bdi>{`ברירת המחדל של ${preset.label} עכשיו: ${size3(standard)}. כך היא מופיעה בספרייה.`}</bdi>}
        </p>
      ) : null}
      {refusal === null ? null : <p className={styles.error} role="alert">{refusal}</p>}
    </div>
  );
}

export function MultiInspector({ doc, ids, onRun, onClear, footer }: {
  doc: EditorDoc;
  ids: string[];
  onRun: (label: string, ops: SiteOp[]) => void;
  /** Clears the selection from the panel's own close button; without it the button is not drawn. */
  onClear?: () => void;
  /** Turn, duplicate, lock and remove — SiteEditor's, so their toasts are too. */
  footer?: ReactNode;
}): ReactElement {
  const [gap, setGap] = useState('0.5');
  const [refusal, setRefusal] = useState<string | null>(null);
  const items = ids.map((id) => findItem(doc, id)).filter((entry): entry is EditorItem => entry !== undefined);
  const kinds = KIND_ORDER.filter((kind) => items.some((entry) => entry.kind === kind));
  const unlocked = items.filter((entry) => !entry.locked).length;
  const lockedCount = items.length - unlocked;
  const summary = kinds.map((kind) => {
    const count = items.filter((entry) => entry.kind === kind).length;
    return count === 1 ? `1 ${SITE_KINDS[kind].label}` : `${count} ${SITE_KINDS[kind].plural}`;
  }).join(' · ');

  function run(label: string, ops: SiteOp[]): void {
    if (ops.length > 0) onRun(label, ops);
  }

  function arrangeRow(): void {
    const reading = readMetres(gap, GAP_RANGE);
    if (!reading.ok || reading.cm === null) {
      setRefusal(reading.ok ? NOT_A_LENGTH : reading.error);
      return;
    }
    setRefusal(null);
    run('סידור בשורה', rowOps(doc, ids, reading.cm));
  }

  return (
    <>
      <header className={styles.head}>
        <h2 className={styles.headTitle}><bdi>{`נבחרו ${items.length} פריטים`}</bdi></h2>
        <span className={styles.headEnd}>
          <SourceChip source={{ kind: 'manual' }} />
          {onClear === undefined ? null : (
            <Button tone="ghost" size="sm" iconLabel="ביטול הבחירה" onClick={onClear}>
              <Icon name="x" size={14} />
            </Button>
          )}
        </span>
      </header>

      <div className={styles.body}>
        <p className={styles.meta}><bdi>{summary}</bdi></p>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            מידות לפי סוג
            <span className={styles.sectionMeta}>במטרים</span>
          </h3>
          <p className={styles.hint}>שינוי כאן חל על כל הפריטים מאותו סוג שבבחירה. כל פריט גדל או קטן סביב המרכז שלו.</p>
          {lockedCount > 0 ? (
            <p className={styles.hint}>
              <bdi>{lockedCount === 1 ? 'פריט אחד בבחירה נעול ולא ישתנה.' : `${lockedCount} פריטים בבחירה נעולים ולא ישתנו.`}</bdi>
            </p>
          ) : null}
          {kinds.map((kind) => (
            <KindRow
              key={kind}
              doc={doc}
              kind={kind}
              ids={items.filter((entry) => entry.kind === kind).map((entry) => entry.id)}
              onRun={onRun}
            />
          ))}
          <button type="button" className={styles.link} onClick={() => { run('חזרה לברירת המחדל', resetSizeOps(doc, ids)); }}>
            החזרת הנבחרים למידות ברירת המחדל
          </button>
        </div>

        <div className={styles.divider} />
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>יישור וסידור</h3>
          <div className={styles.pills}>
            {ALIGN.map((entry) => (
              <Button
                key={entry.how}
                size="sm"
                iconLabel={entry.label}
                disabled={unlocked < 2}
                onClick={() => { run(entry.label, alignOps(doc, ids, entry.how)); }}
              >
                <EditorIcon name={entry.icon} />
              </Button>
            ))}
            <Button size="sm" iconLabel="פיזור שווה, מזרח־מערב" disabled={unlocked < 3} onClick={() => { run('פיזור שווה', distributeOps(doc, ids, 'x')); }}>
              <EditorIcon name="distributeX" />
            </Button>
            <Button size="sm" iconLabel="פיזור שווה, צפון־דרום" disabled={unlocked < 3} onClick={() => { run('פיזור שווה', distributeOps(doc, ids, 'y')); }}>
              <EditorIcon name="distributeY" />
            </Button>
          </div>
          <div className={styles.controlsRow}>
            <label className={cx(styles.field, styles.gapField)}>
              מרווח בשורה
              <input
                className={cx(styles.input, styles.number)}
                inputMode="decimal"
                value={gap}
                aria-invalid={refusal !== null || undefined}
                onChange={(event) => { setGap(event.target.value); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    arrangeRow();
                  }
                }}
              />
            </label>
            <Button size="sm" disabled={unlocked < 2} onClick={arrangeRow}>
              <EditorIcon name="row" size={14} />
              סידור בשורה
            </Button>
          </div>
          {refusal === null ? null : <p className={styles.error} role="alert">{refusal}</p>}
        </div>
      </div>

      {footer === undefined ? null : <footer className={styles.foot}>{footer}</footer>}
    </>
  );
}
```

- [ ] **Step 6: Run the inspector tests**

Run the Step 2 command. Expected: 22 passed (5 plot, 8 one item, 9 several items).

- [ ] **Step 7: Write the failing editor tests for the inspector**

In `src/app/(admin)/site/editor/site-editor.test.tsx`, replace the line `import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';` with:

```tsx
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
```

Append to the end of the file:

```tsx
describe('the inspector', () => {
  const inspector = () => within(screen.getByRole('region', { name: 'מאפיינים' }));
  const twoTents = () => ({
    doc: siteDoc([siteItem({ id: 'a' }), siteItem({ id: 'b', label: 'אוהל 2', xCm: 1500 })]),
    version: 0,
  });

  it('shows the one item selected, the plot when nothing is, and the kinds when several are', async () => {
    renderEditor({ initial: twoTents() });
    await screen.findByTestId('scene');
    expect(inspector().getByRole('heading', { name: 'אוהל 1' })).toBeTruthy();
    fireEvent.keyDown(stage(), { code: 'Escape' });
    expect(inspector().getByRole('heading', { name: 'המגרש' })).toBeTruthy();
    fireEvent.keyDown(stage(), { code: 'KeyA', metaKey: true });
    expect(inspector().getByRole('heading', { name: 'נבחרו 2 פריטים' })).toBeTruthy();
  });

  it('takes no shortcut from a box being typed in', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(inspector().getByLabelText('שם'), { code: 'KeyR', key: 'ר' });
    expect(firstItem()).toMatchObject({ widthCm: 300, depthCm: 200 });
  });

  it('applies a typed width through the store, so ⌘Z takes it back', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    const width = inspector().getByLabelText('רוחב');
    fireEvent.change(width, { target: { value: '4' } });
    fireEvent.keyDown(width, { key: 'Enter' });
    expect(firstItem().widthCm).toBe(400);
    fireEvent.keyDown(stage(), { code: 'KeyZ', metaKey: true });
    expect(firstItem().widthCm).toBe(300);
  });

  it('turns, locks and removes from its footer, and a lock keeps the item', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.click(inspector().getByRole('button', { name: 'סיבוב' }));
    expect(firstItem()).toMatchObject({ widthCm: 200, depthCm: 300 });
    fireEvent.click(inspector().getByRole('button', { name: 'נעילה' }));
    expect(firstItem().locked).toBe(true);
    fireEvent.click(inspector().getByRole('button', { name: 'הסרה' }));
    expect(lastScene().store.doc.items).toHaveLength(1);
    fireEvent.click(inspector().getByRole('button', { name: 'נעילה' }));
    fireEvent.click(inspector().getByRole('button', { name: 'הסרה' }));
    expect(lastScene().store.doc.items).toHaveLength(0);
    expect(inspector().getByRole('heading', { name: 'המגרש' })).toBeTruthy();
  });
});
```

Run: `npx vitest run "src/app/(admin)/site/editor/site-editor.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — the 4 new tests (`Unable to find role="region" and name "מאפיינים"`); the other 18 pass.

- [ ] **Step 8: Put the inspector over the scene**

In `src/app/(admin)/site/editor/site-editor.tsx`:

1. Add after the line `import { Icon } from '@/components/ui/icon';`:

```tsx
import { cx } from '@/components/ui/cx';
```

2. Add after the line `import { findItem, type EditorDoc, type EditorItem } from '@/lib/site/editor/model';`:

```tsx
import type { SiteOp } from '@/lib/site/editor/ops';
```

3. Add after the line `import { SidePanel, type SideTab } from './panels/side-panel';`:

```tsx
import { PlotInspector } from './panels/inspector-plot';
import { ItemInspector } from './panels/inspector-item';
import { MultiInspector } from './panels/inspector-multi';
import { SelectionActions } from './panels/selection-actions';
```

4. Add directly above the line `  function runShortcut(shortcut: Shortcut): void {`:

```tsx
  function runEdit(label: string, ops: SiteOp[]): void {
    if (ops.length > 0) store.run(label, ops);
  }

  /** A figure or a problem that names items: select them and fly to them (§13). An empty list clears. */
  function goTo(ids: string[]): void {
    store.select(ids);
    if (ids.length > 0) sceneRef.current?.fitIds(ids);
  }

  /** One of three states (§10): the plot, one item, several items. */
  function renderInspector(): ReactElement {
    const items = selected();
    if (items.length === 0) {
      return <PlotInspector doc={store.doc} flags={store.flags} plotHref={plotHref} onPickIds={goTo} />;
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
          onPickIds={goTo}
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
        onClear={() => { store.select([]); }}
        footer={actions}
      />
    );
  }

```

5. Insert directly above the line `        {/* floating panels, over the scene */}`:

```tsx
        <section className={cx(styles.panel, styles.inspector)} aria-label="מאפיינים" data-panel="true">
          {renderInspector()}
        </section>
```

- [ ] **Step 9: Run this task's tests**

Run: `npx vitest run "src/app/(admin)/site/editor/panels/inspector-plot.test.tsx" "src/app/(admin)/site/editor/panels/inspector-item.test.tsx" "src/app/(admin)/site/editor/panels/inspector-multi.test.tsx" "src/app/(admin)/site/editor/site-editor.test.tsx" "src/app/(admin)/copy-sweep.test.tsx" "src/app/(admin)/a11y-sweep.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: all pass, exit 0 — 22 inspector tests, 22 editor tests (18 + 4), both sweeps.

Run: `npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor"` — expected no errors.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(admin)/site/editor/panels/north.ts" "src/app/(admin)/site/editor/panels/selection-actions.tsx" \
  "src/app/(admin)/site/editor/panels/inspector-plot.tsx" "src/app/(admin)/site/editor/panels/inspector-plot.test.tsx" \
  "src/app/(admin)/site/editor/panels/inspector-item.tsx" "src/app/(admin)/site/editor/panels/inspector-item.test.tsx" \
  "src/app/(admin)/site/editor/panels/inspector-multi.tsx" "src/app/(admin)/site/editor/panels/inspector-multi.test.tsx" \
  "src/app/(admin)/site/editor/editor.module.css" "src/app/(admin)/site/editor/site-editor.tsx" \
  "src/app/(admin)/site/editor/site-editor.test.tsx"
git commit -m "feat(site): the inspector — the plot, one item typed in metres, several items per kind with מעורב

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: Checks bar, view controls, minimap, selection bar, shortcuts card, toasts

**Files:**
- Create: `src/app/(admin)/site/editor/panels/checks-bar.tsx`, `panels/checks-bar.test.tsx`
- Create: `src/app/(admin)/site/editor/panels/minimap.tsx`, `panels/minimap.test.tsx`
- Create: `src/app/(admin)/site/editor/panels/view-controls.tsx`, `panels/selection-bar.tsx`, `panels/shortcuts-card.tsx`, `panels/view-controls.test.tsx` (tests all three)
- Modify: `src/app/(admin)/site/editor/editor.module.css` (append), `site-editor.tsx`, `site-editor.test.tsx` (append)

**Interfaces:**
- Consumes: `EditorFlags`; `ViewInfo`, `SceneHandle.jumpTo`, `northUp`, `rotateView`, `zoomBy`, `fitIds`; `ScreenBox` (`camera.ts`); `unionRect` (`geometry.ts`); `rectOf` (`model.ts`); `SelectionActions` (Task 23); `ZOOM_IN` (Task 21); `useToast().show({ message, tone, undo })`.
- Produces (contract): `ChecksBar({ doc, flags, onGo })`, `ViewControls({ info, keysOpen, onZoom, onFit, onRotate, onNorth, onKeys })`, `Minimap({ doc, flags, selection, info, onJump })`, `SelectionBar({ box, locked, onTurn, onDuplicate, onLock, onRemove })`, `ShortcutsCard({ onClose })`. Also `scaleFor(pxPerM)`, `minimapBounds(doc)`, `minimapPoint(rect, box, clientX, clientY)` (pure helpers, exported for their tests). Toasts for add, remove, duplicate and lock, each with "ביטול" running `store.undo()`.

Review Focus #4, the panels' half: the checks bar and the minimap are tested with an empty map and with a map whose every item is past the fence.

- [ ] **Step 1: Write the failing panel tests**

Create `src/app/(admin)/site/editor/panels/checks-bar.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { derive, toPlaced } from '@/lib/site/derive';
import { overlapPairs } from '@/lib/site/geometry';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { ChecksBar } from './checks-bar';

/* This file's own fixture. */
function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function doc(items: EditorItem[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, defaults: {} };
}

/** The flags, worked out with `derive.ts` — the server's rule — not with the store. */
function flagsOf(map: EditorDoc): EditorFlags {
  const { items } = derive(map.plot, map.items);
  return {
    outside: new Set(items.filter((entry) => entry.outside).map((entry) => entry.id)),
    overlapping: new Set(items.filter((entry) => entry.overlapping).map((entry) => entry.id)),
    partly: new Set(items.filter((entry) => entry.shade === 'partly').map((entry) => entry.id)),
    pairs: overlapPairs(map.items.map(toPlaced)),
  };
}

function renderChecks(items: EditorItem[]) {
  const map = doc(items);
  const onGo = vi.fn();
  render(<ChecksBar doc={map} flags={flagsOf(map)} onGo={onGo} />);
  return { onGo };
}

const bar = () => screen.getByRole('group', { name: 'בדיקות המפה' });

describe('the checks bar', () => {
  it('says הכול תקין on an empty map, and offers nothing to press', () => {
    renderChecks([]);
    expect(screen.getByText('הכול תקין')).toBeTruthy();
    expect(bar().querySelectorAll('button')).toHaveLength(0);
  });

  it('counts the items past the fence when every one of them is, and each press goes to the next', () => {
    const { onGo } = renderChecks([
      item({ id: 'a', xCm: 3000, yCm: 0 }),
      item({ id: 'b', label: 'אוהל 2', xCm: -500 }),
      item({ id: 'c', label: 'אוהל 3', yCm: 2600 }),
    ]);
    const chip = screen.getByRole('button', { name: '3 מחוץ לגדר' });
    for (let press = 0; press < 4; press += 1) fireEvent.click(chip);
    expect(onGo.mock.calls.map((call) => call[0])).toEqual([['a'], ['b'], ['c'], ['a']]);
    expect(screen.queryByText('הכול תקין')).toBeNull();
  });

  it('counts one overlap in words, and goes to the pair', () => {
    const { onGo } = renderChecks([
      item({ id: 'a' }),
      item({ id: 'b', label: 'אוהל 2', xCm: 600, yCm: 550 }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'חפיפה אחת' }));
    expect(onGo).toHaveBeenCalledWith(['a', 'b']);
  });

  it('counts what sits in a net’s unshaded strip', () => {
    const { onGo } = renderChecks([
      item({ id: 'n', kind: 'shade', label: 'רשת צל 1', xCm: 0, yCm: 0, widthCm: 800, depthCm: 800, insetCm: 50 }),
      item({ id: 's', kind: 'sofa', label: 'ספה 1', xCm: 20, yCm: 100, widthCm: 200, depthCm: 90 }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: '1 בשולי רשת צל' }));
    expect(onGo).toHaveBeenCalledWith(['s']);
  });

  it('says הכול תקין when everything is inside and apart', () => {
    renderChecks([item({ id: 'a' }), item({ id: 'b', label: 'אוהל 2', xCm: 1200 })]);
    expect(screen.getByText('הכול תקין')).toBeTruthy();
  });
});
```

Create `src/app/(admin)/site/editor/panels/minimap.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { derive, toPlaced } from '@/lib/site/derive';
import { overlapPairs } from '@/lib/site/geometry';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import type { ViewInfo } from '../scene/scene-view';
import { Minimap } from './minimap';

beforeAll(() => {
  Element.prototype.setPointerCapture = () => {};
});

/* This file's own fixture. */
function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function doc(items: EditorItem[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, defaults: {} };
}

function flagsOf(map: EditorDoc): EditorFlags {
  const { items } = derive(map.plot, map.items);
  return {
    outside: new Set(items.filter((entry) => entry.outside).map((entry) => entry.id)),
    overlapping: new Set(items.filter((entry) => entry.overlapping).map((entry) => entry.id)),
    partly: new Set(items.filter((entry) => entry.shade === 'partly').map((entry) => entry.id)),
    pairs: overlapPairs(map.items.map(toPlaced)),
  };
}

const STILL: ViewInfo = { yaw: 0, zoomPct: 100, pxPerM: 20, groundCorners: [], selectionBox: null, moving: false };

function renderMap(items: EditorItem[], over: { selection?: string[]; info?: ViewInfo } = {}) {
  const map = doc(items);
  const onJump = vi.fn();
  const { container } = render(
    <Minimap doc={map} flags={flagsOf(map)} selection={over.selection ?? []} info={over.info ?? STILL} onJump={onJump} />,
  );
  const svg = screen.getByRole('img', { name: /מפה מוקטנת/ });
  const viewBox = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
  return { onJump, container, svg, viewBox };
}

/** jsdom lays nothing out: the minimap's own 168 × 154 box. */
function sized(svg: Element): void {
  svg.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 168, height: 154, right: 168, bottom: 154, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect;
}

describe('the minimap', () => {
  it('draws the plot alone on an empty map, with room around it', () => {
    const { container, viewBox } = renderMap([]);
    // 6% of the longer side (2600 cm) on every side.
    expect(viewBox).toEqual([-156, -156, 2912, 2712]);
    expect(container.querySelectorAll('rect[data-id]')).toHaveLength(0);
    expect(container.querySelector('polygon')).toBeNull();
  });

  it('grows to hold every item past the fence, and marks each one', () => {
    const { container, viewBox } = renderMap([
      item({ id: 'a', xCm: 3000, yCm: 0 }),
      item({ id: 'b', label: 'אוהל 2', xCm: -500 }),
      item({ id: 'c', label: 'אוהל 3', yCm: 2600 }),
    ]);
    const [x, y, width, height] = viewBox;
    expect(x).toBeLessThanOrEqual(-500);
    expect(x + width).toBeGreaterThanOrEqual(3300);
    expect(y + height).toBeGreaterThanOrEqual(2800);
    const drawn = [...container.querySelectorAll('rect[data-id]')];
    expect(drawn.map((rect) => rect.getAttribute('data-outside'))).toEqual(['true', 'true', 'true']);
  });

  it('outlines the ground the view can see, and marks the selection', () => {
    const { container } = renderMap([item({ id: 'a' })], {
      selection: ['a'],
      info: { ...STILL, groundCorners: [[0, 0], [1000, 0], [1000, 800], [0, 800]] },
    });
    expect(container.querySelector('polygon')?.getAttribute('points')).toBe('0,0 1000,0 1000,800 0,800');
    expect(container.querySelector('rect[data-id="a"]')?.getAttribute('data-selected')).toBe('true');
  });

  it('moves the view to the point clicked: the middle of the minimap is the middle of the plot', () => {
    const { onJump, svg } = renderMap([]);
    sized(svg);
    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 84, clientY: 77 });
    expect(onJump).toHaveBeenCalledWith(1300, 1200);
  });

  it('follows a drag, and stops when the pointer lifts', () => {
    const { onJump, svg } = renderMap([]);
    sized(svg);
    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 84, clientY: 77 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 90, clientY: 77 });
    expect(onJump).toHaveBeenCalledTimes(2);
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 90, clientY: 77 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 120, clientY: 77 });
    expect(onJump).toHaveBeenCalledTimes(2);
  });
});
```

Create `src/app/(admin)/site/editor/panels/view-controls.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { unnamedControls } from '@/test/a11y';
import type { ViewInfo } from '../scene/scene-view';
import { scaleFor, ViewControls } from './view-controls';
import { SelectionBar } from './selection-bar';
import { ShortcutsCard } from './shortcuts-card';

const STILL: ViewInfo = { yaw: 0, zoomPct: 150, pxPerM: 20, groundCorners: [], selectionBox: null, moving: false };

function renderControls(info: ViewInfo = STILL, keysOpen = false) {
  const calls = { onZoom: vi.fn(), onFit: vi.fn(), onRotate: vi.fn(), onNorth: vi.fn(), onKeys: vi.fn() };
  const { container } = render(<ViewControls info={info} keysOpen={keysOpen} {...calls} />);
  return { ...calls, container };
}

describe('the view controls', () => {
  it('zoom by one step either way, fit, turn the view, and bring north up', () => {
    const { onZoom, onFit, onRotate, onNorth, container } = renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'התקרבות' }));
    expect(onZoom).toHaveBeenLastCalledWith(0.8);
    fireEvent.click(screen.getByRole('button', { name: 'התרחקות' }));
    expect(onZoom).toHaveBeenLastCalledWith(1.25);
    fireEvent.click(screen.getByRole('button', { name: 'התאמה למסך' }));
    expect(onFit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'סיבוב המבט ימינה' }));
    expect(onRotate).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'סיבוב המבט שמאלה' }));
    expect(onRotate).toHaveBeenLastCalledWith(-1);
    fireEvent.click(screen.getByRole('button', { name: 'צפון למעלה' }));
    expect(onNorth).toHaveBeenCalled();
    expect(unnamedControls(container)).toEqual([]);
  });

  it('show the zoom, a scale bar that fits it, and a compass turned with the view', () => {
    renderControls({ ...STILL, yaw: 30 });
    const group = within(screen.getByRole('group', { name: 'מבט' }));
    expect(group.getByText('150%')).toBeTruthy();
    expect(group.getByText('2 מ׳')).toBeTruthy();
    const needle = screen.getByRole('button', { name: 'צפון למעלה' }).querySelector('svg');
    expect(needle?.style.transform).toBe('rotate(30deg)');
  });

  it('pick the shortest round length at least 36 px long for the scale bar, and none before the scene reports', () => {
    expect(scaleFor(20)).toEqual({ px: 40, text: '2 מ׳' });
    expect(scaleFor(100)).toEqual({ px: 50, text: '0.5 מ׳' });
    expect(scaleFor(0.5)).toEqual({ px: 25, text: '50 מ׳' });
    expect(scaleFor(0)).toBeNull();
  });

  it('open and close the shortcuts card, and say which it is', () => {
    const { onKeys } = renderControls(STILL, true);
    const keys = screen.getByRole('button', { name: 'קיצורי מקלדת' });
    expect(keys.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(keys);
    expect(onKeys).toHaveBeenCalled();
  });
});

describe('the selection bar', () => {
  it('floats over the middle of the selection’s top edge, and is gone while there is no box', () => {
    const calls = { onTurn: vi.fn(), onDuplicate: vi.fn(), onLock: vi.fn(), onRemove: vi.fn() };
    const { rerender } = render(<SelectionBar box={{ l: 100, t: 200, r: 300, b: 260 }} locked {...calls} />);
    const bar = screen.getByRole('group', { name: 'פעולות על הבחירה' });
    expect(bar.style.left).toBe('200px');
    expect(bar.style.top).toBe('190px');
    expect(within(bar).getByRole('button', { name: 'נעילה' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(bar).getByRole('button', { name: 'סיבוב ברבע' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'שכפול' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'הסרה' }));
    expect([calls.onTurn, calls.onDuplicate, calls.onRemove].every((call) => call.mock.calls.length === 1)).toBe(true);
    rerender(<SelectionBar box={null} locked={false} {...calls} />);
    expect(screen.queryByRole('group', { name: 'פעולות על הבחירה' })).toBeNull();
  });
});

describe('the shortcuts card', () => {
  it('lists the keys the editor reads, in Hebrew, and closes', () => {
    const onClose = vi.fn();
    render(<ShortcutsCard onClose={onClose} />);
    const card = within(screen.getByRole('dialog', { name: 'קיצורי מקלדת' }));
    expect(card.getByText('סיבוב ברבע · שכפול · נעילה')).toBeTruthy();
    expect(card.getByText('המקשים נקראים לפי מיקומם במקלדת, כך שהם עובדים גם כשהמקלדת בעברית.')).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: 'סגירה' }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run "src/app/(admin)/site/editor/panels/checks-bar.test.tsx" "src/app/(admin)/site/editor/panels/minimap.test.tsx" "src/app/(admin)/site/editor/panels/view-controls.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `Failed to resolve import "./checks-bar"`, `"./minimap"`, `"./view-controls"`.

- [ ] **Step 3: Append the overlays' styles**

Append to `src/app/(admin)/site/editor/editor.module.css`:

```css
/* ---- checks, view controls, minimap, selection bar, cards -------------- */

/* Centred over the scene: inset on both inline sides, as wide as its content. */
.checks {
  position: absolute;
  inset-block-start: 12px;
  inset-inline: 0;
  margin-inline: auto;
  inline-size: fit-content;
  display: flex;
  gap: 6px;
  padding: 5px;
  border-radius: var(--radius-pill);
  background: var(--panel);
  box-shadow: var(--shadow-pop);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  block-size: 28px;
  padding-inline: 11px;
  border: 0;
  border-radius: var(--radius-pill);
  font-size: var(--text-meta);
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.chip[data-tone='bad'] { background: var(--bad-soft); color: var(--bad); }
.chip[data-tone='warn'] { background: var(--warn-soft); color: var(--warn); }
.chip[data-tone='ok'] { background: var(--ok-soft); color: var(--ok); cursor: default; }

.chipDot {
  inline-size: 7px;
  block-size: 7px;
  border-radius: var(--radius-pill);
  background: currentColor;
}

.view {
  position: absolute;
  inset-block-end: 12px;
  inset-inline: 0;
  margin-inline: auto;
  inline-size: fit-content;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: var(--radius-card);
  background: var(--panel);
  box-shadow: var(--shadow-pop);
}

.zoomValue {
  min-inline-size: 46px;
  color: var(--ink-2);
  font-size: var(--text-meta);
  text-align: center;
}

.vsep {
  inline-size: 1px;
  block-size: 20px;
  flex-shrink: 0;
  background: var(--line);
}

.compassRing { fill: none; stroke: currentColor; stroke-opacity: 0.45; stroke-width: 1.25; }
.compassNorth { fill: var(--focus); }
.compassSouth { fill: currentColor; fill-opacity: 0.55; }

.scaleBar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-inline: var(--space-2);
  color: var(--ink-3);
  font-size: var(--text-label);
}

.scaleLine {
  display: block;
  block-size: 6px;
  border: 1.5px solid var(--ink-3);
  border-block-start: 0;
}

/* At the inline end, under the inspector — bottom left here. */
.minimap {
  position: absolute;
  inset-block-end: 12px;
  inset-inline-end: 12px;
  inline-size: 168px;
  block-size: 154px;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--panel);
  box-shadow: var(--shadow-pop);
}

.minimapSvg {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  cursor: pointer;
  touch-action: none;
}

/* One SVG unit is a centimetre, so every stroke is kept to screen pixels. */
.mmPlot {
  fill: var(--scene-plot, var(--sunken));
  stroke: var(--scene-fence, var(--ink-3));
  stroke-width: 1px;
  vector-effect: non-scaling-stroke;
}
.mmItem { fill: var(--swatch); }
.mmNet { fill: none; stroke: var(--swatch); stroke-width: 1px; vector-effect: non-scaling-stroke; }
.mmItem[data-outside='true'] { stroke: var(--bad); stroke-width: 1.5px; vector-effect: non-scaling-stroke; }
.mmItem[data-selected='true'] { stroke: var(--focus); stroke-width: 2px; vector-effect: non-scaling-stroke; }
.mmView {
  fill: var(--focus);
  fill-opacity: 0.08;
  stroke: var(--focus);
  stroke-width: 1.5px;
  vector-effect: non-scaling-stroke;
}

/*
 * Placed from the scene's own screen box, so `left`/`top` (set inline) and
 * the translate are physical on purpose: a point on the map does not mirror.
 * Inverted colours, as in the mock, from the tokens: ink as the ground.
 */
.selBar {
  position: absolute;
  transform: translate(-50%, -100%);
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-control);
  background: var(--ink);
  box-shadow: var(--shadow-pop);
}
.selBar .iconButton { color: var(--panel); }
.selBar .iconButton:hover { background: var(--ink-2); color: var(--panel); }
.selBar .iconButton[aria-pressed='true'] { background: var(--brand); color: var(--brand-ink); }

/* The cards stack above the view controls, bottom centre. */
.cards {
  position: absolute;
  inset-block-end: 64px;
  inset-inline: 0;
  margin-inline: auto;
  inline-size: fit-content;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-block: 10px;
  padding-inline: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  box-shadow: var(--shadow-pop);
}

.cardHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.keysCard { inline-size: 420px; }

.keysList {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 5px 14px;
  margin: 0;
  font-size: var(--text-meta);
}
.keysList dt { color: var(--ink-2); }
.keysList dd { margin: 0; display: flex; justify-content: flex-end; gap: 3px; }
```

- [ ] **Step 4: Write the five panels**

Create `src/app/(admin)/site/editor/panels/checks-bar.tsx`:

```tsx
'use client';

/**
 * The checks, top centre (spec §10): how many items are past the fence, how
 * many pairs overlap, how many sit in a net's unshaded strip — or "הכול
 * תקין". Each press selects the next case and flies to it. They replace the
 * four stat tiles and the outside-the-fence banner of the old page.
 */

import { useState, type ReactElement } from 'react';
import type { EditorDoc } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import styles from '../editor.module.css';

type Check = 'outside' | 'pairs' | 'partly';

export function ChecksBar({ doc, flags, onGo }: {
  doc: EditorDoc;
  flags: EditorFlags;
  onGo: (ids: string[]) => void;
}): ReactElement {
  const [turns, setTurns] = useState<Record<Check, number>>({ outside: 0, pairs: 0, partly: 0 });
  const cases: Record<Check, string[][]> = {
    outside: doc.items.filter((item) => flags.outside.has(item.id)).map((item) => [item.id]),
    pairs: flags.pairs.map(([a, b]) => [a, b]),
    partly: doc.items.filter((item) => flags.partly.has(item.id)).map((item) => [item.id]),
  };

  function go(check: Check): void {
    const list = cases[check];
    if (list.length === 0) return;
    const index = turns[check] % list.length;
    setTurns((current) => ({ ...current, [check]: index + 1 }));
    onGo(list[index]);
  }

  const chips: Array<{ check: Check; tone: 'bad' | 'warn'; text: string; title: string }> = [];
  if (cases.outside.length > 0) {
    chips.push({ check: 'outside', tone: 'bad', text: `${cases.outside.length} מחוץ לגדר`, title: 'מעבר לפריט הבא שמחוץ לגדר' });
  }
  if (cases.pairs.length > 0) {
    chips.push({
      check: 'pairs', tone: 'warn',
      text: cases.pairs.length === 1 ? 'חפיפה אחת' : `${cases.pairs.length} חפיפות`,
      title: 'מעבר לחפיפה הבאה',
    });
  }
  if (cases.partly.length > 0) {
    chips.push({
      check: 'partly', tone: 'warn', text: `${cases.partly.length} בשולי רשת צל`,
      title: 'פריטים שנראים מכוסים אבל יושבים ברצועה שאין בה צל',
    });
  }

  return (
    <div className={styles.checks} role="group" aria-label="בדיקות המפה" data-panel="true">
      {chips.length === 0 ? (
        <span className={styles.chip} data-tone="ok">
          <span className={styles.chipDot} aria-hidden="true" />
          הכול תקין
        </span>
      ) : chips.map((chip) => (
        <button
          key={chip.check}
          type="button"
          className={styles.chip}
          data-tone={chip.tone}
          title={chip.title}
          onClick={() => { go(chip.check); }}
        >
          <span className={styles.chipDot} aria-hidden="true" />
          <bdi>{chip.text}</bdi>
        </button>
      ))}
    </div>
  );
}
```

Create `src/app/(admin)/site/editor/panels/minimap.tsx`:

```tsx
'use client';

/**
 * The whole map from above, bottom left (spec §10): the plot, every item in
 * its group's colour — an item past the fence outlined in the "bad" colour —
 * and the ground the view can see, outlined. A click or a drag here moves the
 * view there. SVG, so jsdom can test it; one unit is one centimetre and, like
 * the map, it never mirrors.
 */

import { useRef, type PointerEvent, type ReactElement } from 'react';
import { cx } from '@/components/ui/cx';
import { unionRect } from '@/lib/site/geometry';
import { SITE_KINDS } from '@/lib/site/kinds';
import { rectOf, type EditorDoc } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import type { ViewInfo } from '../scene/scene-view';
import styles from '../editor.module.css';

export interface MinimapBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The ground the minimap shows: the plot, grown to take in anything past the
 * fence, with 6% of the longer side around it — an empty map and a map whose
 * every item is outside both frame something sensible (Review Focus #4).
 */
export function minimapBounds(doc: EditorDoc): MinimapBox {
  const plot = { x: 0, y: 0, width: doc.plot.widthCm, depth: doc.plot.depthCm };
  const all = unionRect([plot, ...doc.items.map(rectOf)]) ?? plot;
  const margin = Math.round(Math.max(all.width, all.depth) * 0.06);
  return { x: all.x - margin, y: all.y - margin, width: all.width + margin * 2, height: all.depth + margin * 2 };
}

/** A point on the drawn minimap, in client pixels, to the ground under it — `preserveAspectRatio="xMidYMid meet"`. */
export function minimapPoint(
  rect: { left: number; top: number; width: number; height: number },
  box: MinimapBox,
  clientX: number,
  clientY: number,
): [number, number] | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const scale = Math.min(rect.width / box.width, rect.height / box.height);
  const offsetX = (rect.width - box.width * scale) / 2;
  const offsetY = (rect.height - box.height * scale) / 2;
  return [box.x + (clientX - rect.left - offsetX) / scale, box.y + (clientY - rect.top - offsetY) / scale];
}

export function Minimap({ doc, flags, selection, info, onJump }: {
  doc: EditorDoc;
  flags: EditorFlags;
  selection: readonly string[];
  info: ViewInfo;
  onJump: (xCm: number, yCm: number) => void;
}): ReactElement {
  const box = minimapBounds(doc);
  const dragging = useRef(false);
  const selected = new Set(selection);
  const seen = info.groundCorners.length >= 3
    ? info.groundCorners.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(' ')
    : null;

  function jump(event: PointerEvent<SVGSVGElement>): void {
    const point = minimapPoint(event.currentTarget.getBoundingClientRect(), box, event.clientX, event.clientY);
    if (point !== null) onJump(Math.round(point[0]), Math.round(point[1]));
  }

  return (
    <div className={styles.minimap} data-panel="true">
      <svg
        className={styles.minimapSvg}
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="מפה מוקטנת. לחיצה או גרירה כאן מזיזות את המבט."
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = true;
          jump(event);
        }}
        onPointerMove={(event) => { if (dragging.current) jump(event); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
      >
        <rect className={styles.mmPlot} x={0} y={0} width={doc.plot.widthCm} height={doc.plot.depthCm} />
        {doc.items.map((item) => (
          <rect
            key={item.id}
            data-id={item.id}
            data-outside={flags.outside.has(item.id) || undefined}
            data-selected={selected.has(item.id) || undefined}
            className={cx(styles.mmItem, styles[`g_${SITE_KINDS[item.kind].group}`], item.kind === 'shade' && styles.mmNet)}
            x={item.xCm}
            y={item.yCm}
            width={item.widthCm}
            height={item.depthCm}
          />
        ))}
        {seen === null ? null : <polygon className={styles.mmView} points={seen} />}
      </svg>
    </div>
  );
}
```

Create `src/app/(admin)/site/editor/panels/view-controls.tsx`:

```tsx
'use client';

/**
 * The view's controls, bottom centre (spec §10): zoom out and in with the
 * zoom level between, fit, turn the view either way around a compass that
 * brings north back to the top, a scale bar, and the shortcuts card.
 */

import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import type { ViewInfo } from '../scene/scene-view';
import { ZOOM_IN } from '../keyboard';
import { EditorIcon } from './editor-icons';
import styles from '../editor.module.css';

/** The lengths the scale bar may stand for, and the shortest it may be drawn. */
const SCALE_STEPS_M = [0.5, 1, 2, 5, 10, 20, 50];
const SCALE_MIN_PX = 36;

/** The shortest round length at least 36 px long at this zoom; none before the scene has reported one. */
export function scaleFor(pxPerM: number): { px: number; text: string } | null {
  if (!(pxPerM > 0)) return null;
  const length = SCALE_STEPS_M.find((step) => step * pxPerM >= SCALE_MIN_PX) ?? SCALE_STEPS_M[SCALE_STEPS_M.length - 1];
  return { px: Math.round(length * pxPerM), text: `${length} מ׳` };
}

export function ViewControls({ info, keysOpen, onZoom, onFit, onRotate, onNorth, onKeys }: {
  info: ViewInfo;
  keysOpen: boolean;
  onZoom: (factor: number) => void;
  onFit: () => void;
  onRotate: (dir: 1 | -1) => void;
  onNorth: () => void;
  onKeys: () => void;
}): ReactElement {
  const scale = scaleFor(info.pxPerM);
  return (
    <div className={styles.view} role="group" aria-label="מבט" data-panel="true">
      <Button tone="ghost" size="sm" iconLabel="התרחקות" onClick={() => { onZoom(1 / ZOOM_IN); }}>
        <EditorIcon name="minus" />
      </Button>
      <span className={styles.zoomValue}><bdi>{`${info.zoomPct}%`}</bdi></span>
      <Button tone="ghost" size="sm" iconLabel="התקרבות" onClick={() => { onZoom(ZOOM_IN); }}>
        <Icon name="plus" size={16} />
      </Button>
      <Button tone="ghost" size="sm" iconLabel="התאמה למסך" onClick={onFit}>
        <EditorIcon name="fit" />
      </Button>
      <span className={styles.vsep} aria-hidden="true" />
      <Button tone="ghost" size="sm" iconLabel="סיבוב המבט ימינה" onClick={() => { onRotate(1); }}>
        <EditorIcon name="rotateRight" />
      </Button>
      {/* The needle points where north is on screen: turned with the view's yaw (plan 02's convention). */}
      <button type="button" className={styles.iconButton} aria-label="צפון למעלה" onClick={onNorth}>
        <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${info.yaw}deg)` }}>
          <circle className={styles.compassRing} cx={12} cy={12} r={10} />
          <path className={styles.compassNorth} d="M12 3.5 15 12 12 10.8 9 12Z" />
          <path className={styles.compassSouth} d="M12 20.5 9 12 12 13.2 15 12Z" />
        </svg>
      </button>
      <Button tone="ghost" size="sm" iconLabel="סיבוב המבט שמאלה" onClick={() => { onRotate(-1); }}>
        <EditorIcon name="rotateLeft" />
      </Button>
      {scale === null ? null : (
        <>
          <span className={styles.vsep} aria-hidden="true" />
          <span className={styles.scaleBar}>
            <span className={styles.scaleLine} style={{ inlineSize: `${scale.px}px` }} aria-hidden="true" />
            <bdi>{scale.text}</bdi>
          </span>
        </>
      )}
      <span className={styles.vsep} aria-hidden="true" />
      <button type="button" className={styles.iconButton} aria-label="קיצורי מקלדת" aria-pressed={keysOpen} onClick={onKeys}>
        <EditorIcon name="help" />
      </button>
    </div>
  );
}
```

Create `src/app/(admin)/site/editor/panels/selection-bar.tsx`:

```tsx
'use client';

/**
 * Turn, duplicate, lock and remove, floating over the selection (spec §10).
 * Hidden while the view or a drag moves: SiteEditor passes no box then, and
 * the scene's `ViewInfo.selectionBox` is null meanwhile too.
 *
 * `box` is in the scene's own screen pixels, which are the stage's, so the
 * bar is placed with physical `left`/`top`: a point on the map does not
 * mirror, and neither does the bar that sits on it.
 */

import type { ReactElement } from 'react';
import type { ScreenBox } from '@/lib/site/editor/camera';
import { SelectionActions } from './selection-actions';
import styles from '../editor.module.css';

export function SelectionBar({ box, locked, onTurn, onDuplicate, onLock, onRemove }: {
  box: ScreenBox | null;
  locked: boolean;
  onTurn: () => void;
  onDuplicate: () => void;
  onLock: () => void;
  onRemove: () => void;
}): ReactElement | null {
  if (box === null) return null;
  return (
    <div
      className={styles.selBar}
      role="group"
      aria-label="פעולות על הבחירה"
      data-panel="true"
      style={{ left: (box.l + box.r) / 2, top: Math.max(8, box.t - 10) }}
    >
      <SelectionActions
        labelled={false}
        locked={locked}
        onTurn={onTurn}
        onDuplicate={onDuplicate}
        onLock={onLock}
        onRemove={onRemove}
      />
    </div>
  );
}
```

Create `src/app/(admin)/site/editor/panels/shortcuts-card.tsx`:

```tsx
'use client';

/**
 * Every gesture and key the editor reads (spec §8), opened with ? or from the
 * view controls. Keycaps are glyphs (⇧ ⌘ ⌥ ⌫) and single letters, which is
 * what is printed on a keyboard; `esc` is the one word, as on the command
 * palette. The note under the list is the reason a Hebrew layout works.
 */

import { Fragment, useId, type ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import styles from '../editor.module.css';

const ROWS: ReadonlyArray<{ what: string; keys: readonly string[] }> = [
  { what: 'בחירה · מדידה', keys: ['V', 'M'] },
  { what: 'גרירה על שטח ריק — הזזת המבט', keys: ['גרירה'] },
  { what: 'בחירת כמה פריטים במלבן', keys: ['⇧', 'גרירה'] },
  { what: 'הוספה או הסרה מהבחירה', keys: ['⇧', 'לחיצה'] },
  { what: 'סיבוב המבט בתלת־ממד', keys: ['גרירה ימנית', '⌃ גרירה'] },
  { what: 'טיסה אל פריט', keys: ['לחיצה כפולה'] },
  { what: 'הזזה בצעד רשת · בצעד של מטר', keys: ['←↑→↓', '⇧'] },
  { what: 'הזזה בלי הצמדה', keys: ['⌥', 'גרירה'] },
  { what: 'סיבוב ברבע · שכפול · נעילה', keys: ['R', '⌘D', 'L'] },
  { what: 'הסרה', keys: ['⌫'] },
  { what: 'ביטול · ביצוע מחדש', keys: ['⌘Z', '⇧⌘Z'] },
  { what: 'בחירת הכול, בלי רשתות הצל', keys: ['⌘A'] },
  { what: 'ביטול הבחירה', keys: ['esc'] },
  { what: 'תוכנית · תלת־ממד · התאמה למסך', keys: ['2', '3', 'F'] },
  { what: 'סיבוב המבט · התקרבות והתרחקות', keys: ['Q', 'E', '+', '−'] },
  { what: 'הכרטיס הזה', keys: ['?'] },
];

export function ShortcutsCard({ onClose }: { onClose: () => void }): ReactElement {
  const titleId = useId();
  return (
    <div className={cx(styles.card, styles.keysCard)} role="dialog" aria-labelledby={titleId} data-panel="true">
      <div className={styles.cardHead}>
        <h2 className={styles.sectionTitle} id={titleId}>קיצורי מקלדת</h2>
        <Button tone="ghost" size="sm" iconLabel="סגירה" onClick={onClose}>
          <Icon name="x" size={14} />
        </Button>
      </div>
      <dl className={styles.keysList}>
        {ROWS.map((row) => (
          <Fragment key={row.what}>
            <dt>{row.what}</dt>
            <dd>{row.keys.map((key) => <kbd key={key} className={styles.kbd}>{key}</kbd>)}</dd>
          </Fragment>
        ))}
      </dl>
      <p className={styles.meta}>המקשים נקראים לפי מיקומם במקלדת, כך שהם עובדים גם כשהמקלדת בעברית.</p>
    </div>
  );
}
```

- [ ] **Step 5: Run the panel tests**

Run the Step 2 command. Expected: 16 passed (5 checks, 5 minimap, 6 view controls, selection bar and card).

- [ ] **Step 6: Write the failing editor tests for the overlays and the toasts**

Append to `src/app/(admin)/site/editor/site-editor.test.tsx`:

```tsx
describe('what an edit says', () => {
  /** The toast holding `text`, to press its ביטול. */
  async function toastOf(text: string) {
    const message = await screen.findByText(text);
    const toast = message.closest('li');
    if (toast === null) throw new Error(`"${text}" is not in a toast`);
    return within(toast);
  }

  it('removes without asking, and ביטול puts the item back', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'Delete' });
    expect(lastScene().store.doc.items).toEqual([]);
    fireEvent.click((await toastOf('הפריט אוהל 1 הוסר מהמפה')).getByRole('button', { name: 'ביטול' }));
    await waitFor(() => { expect(lastScene().store.doc.items.map((entry) => entry.id)).toEqual(['a']); });
  });

  it('keeps a locked item where it is, and says why nothing happened', async () => {
    renderEditor({ initial: { doc: siteDoc([siteItem({ id: 'a', locked: true })]), version: 0 } });
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'Delete' });
    expect(await screen.findByText('הפריט נעול. אפשר לשחרר את הנעילה ואז לשנות אותו.')).toBeTruthy();
    expect(lastScene().store.doc.items).toHaveLength(1);
    fireEvent.keyDown(stage(), { code: 'KeyR' });
    expect(firstItem().widthCm).toBe(300);
  });

  it('says what a duplicate made, and ביטול takes the copy away', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'KeyD', metaKey: true });
    expect(lastScene().store.doc.items).toHaveLength(2);
    fireEvent.click((await toastOf('נוצר עותק של אוהל 1')).getByRole('button', { name: 'ביטול' }));
    await waitFor(() => { expect(lastScene().store.doc.items).toHaveLength(1); });
  });

  it('says a lock was put on, and ביטול takes it off', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'KeyL' });
    expect(firstItem().locked).toBe(true);
    fireEvent.click((await toastOf('הפריט אוהל 1 ננעל')).getByRole('button', { name: 'ביטול' }));
    await waitFor(() => { expect(firstItem().locked).toBe(false); });
  });

  it('says a library item landed, and ביטול takes it off the map', async () => {
    scene.handle.centreGround.mockReturnValue([1300, 1200]);
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.click(screen.getByRole('button', { name: /^הוספת מטבח,/ }));
    expect(lastScene().store.doc.items).toHaveLength(2);
    fireEvent.click((await toastOf('הפריט מטבח 1 נוסף למפה')).getByRole('button', { name: 'ביטול' }));
    await waitFor(() => { expect(lastScene().store.doc.items).toHaveLength(1); });
  });
});

describe('the checks, the view controls, the minimap and the selection bar', () => {
  it('presses a check to select the next case and fly to it', async () => {
    renderEditor({ initial: { doc: siteDoc([siteItem({ id: 'a', xCm: 2500 })]), version: 0 }, initialSelection: null });
    await screen.findByTestId('scene');
    fireEvent.click(screen.getByRole('button', { name: '1 מחוץ לגדר' }));
    expect(lastScene().store.selection).toEqual(['a']);
    expect(scene.handle.fitIds).toHaveBeenLastCalledWith(['a']);
  });

  it('zooms and brings north up from the view controls, by the keys’ step', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.click(screen.getByRole('button', { name: 'התקרבות' }));
    expect(scene.handle.zoomBy).toHaveBeenLastCalledWith(0.8);
    fireEvent.click(screen.getByRole('button', { name: 'צפון למעלה' }));
    expect(scene.handle.northUp).toHaveBeenCalled();
  });

  it('moves the view from the minimap', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    const minimap = screen.getByRole('img', { name: /מפה מוקטנת/ });
    minimap.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 168, height: 154, right: 168, bottom: 154, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect;
    fireEvent.pointerDown(minimap, { pointerId: 1, button: 0, clientX: 84, clientY: 77 });
    expect(scene.handle.jumpTo).toHaveBeenLastCalledWith(1300, 1200);
  });

  it('floats the selection bar by the selection, and hides it while the view moves', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    act(() => { lastScene().onView({ ...VIEW, selectionBox: { l: 100, t: 200, r: 300, b: 260 } }); });
    const bar = screen.getByRole('group', { name: 'פעולות על הבחירה' });
    expect(bar.style.left).toBe('200px');
    fireEvent.click(within(bar).getByRole('button', { name: 'סיבוב ברבע' }));
    expect(firstItem().widthCm).toBe(200);
    act(() => { lastScene().onView({ ...VIEW, moving: true, selectionBox: null }); });
    expect(screen.queryByRole('group', { name: 'פעולות על הבחירה' })).toBeNull();
  });

  it('opens the shortcuts card with ?, and esc closes it without letting go of the selection', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'Slash', shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'קיצורי מקלדת' })).toBeTruthy();
    fireEvent.keyDown(stage(), { code: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'קיצורי מקלדת' })).toBeNull();
    expect(lastScene().store.selection).toEqual(['a']);
  });
});
```

Run: `npx vitest run "src/app/(admin)/site/editor/site-editor.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — the 10 new tests (no toast text, no checks group, no minimap); the other 22 pass.

- [ ] **Step 7: Wire the overlays and the toasts into `SiteEditor`**

In `src/app/(admin)/site/editor/site-editor.tsx`:

1. Add after the line `import { SelectionActions } from './panels/selection-actions';`:

```tsx
import { ChecksBar } from './panels/checks-bar';
import { Minimap } from './panels/minimap';
import { ViewControls } from './panels/view-controls';
import { SelectionBar } from './panels/selection-bar';
import { ShortcutsCard } from './panels/shortcuts-card';
```

2. Replace everything from the line `  // ── edits ─────────────────────────────────────────────────────────────` down to and including the line `  // ── end of edits ──────────────────────────────────────────────────────` with:

```tsx
  // ── edits ─────────────────────────────────────────────────────────────
  /** The selected items that still exist — an undo can take one away. */
  function selected(): EditorItem[] {
    return store.selection
      .map((id) => findItem(store.doc, id))
      .filter((item): item is EditorItem => item !== undefined);
  }

  /**
   * What an edit that can be taken back says (spec §8, §10): a toast whose
   * ביטול is the store's undo. `store.undo` reads the store's latest state
   * (plan 03), so a toast may call it long after this render.
   */
  function saidWithUndo(message: string): void {
    show({
      message,
      tone: 'ok',
      undo: { label: 'ביטול', run: async () => { store.undo(); return { ok: true }; } },
    });
  }

  /** Everything asked about is locked: nothing moved, and the lead is told why (§8). */
  function lockedNotice(count: number): void {
    show({
      message: count === 1
        ? 'הפריט נעול. אפשר לשחרר את הנעילה ואז לשנות אותו.'
        : 'הפריטים הנבחרים נעולים. אפשר לשחרר את הנעילה ואז לשנות אותם.',
      tone: 'bad',
    });
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
    store.run('הסרה', ops, kept.map((item) => item.id));
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
    store.run('שכפול', ops, ids);
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
    store.run('סיבוב', ops);
  }

  function toggleLock(): void {
    const items = selected();
    if (items.length === 0) return;
    const locking = !items.every((item) => item.locked);
    const ops = lockOps(store.doc, store.selection, locking);
    if (ops.length === 0) return;
    store.run(locking ? 'נעילה' : 'שחרור נעילה', ops);
    const one = items.length === 1 ? items[0].label : null;
    saidWithUndo(locking
      ? (one === null ? `${items.length} פריטים ננעלו` : `הפריט ${one} ננעל`)
      : (one === null ? `הנעילה של ${items.length} פריטים שוחררה` : `הנעילה של ${one} שוחררה`));
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
    store.run('הזזה', ops);
  }

  /** A new item of `kind` with its north-west corner at `at`, selected once it lands. */
  function addAt(kind: SiteItemKind, at: { xCm: number; yCm: number }): void {
    const id = crypto.randomUUID();
    const ops = addOps(store.doc, kind, at, id);
    const added = ops.find((op): op is Extract<SiteOp, { type: 'add' }> => op.type === 'add');
    if (added === undefined) return;
    store.run(`הוספת ${SITE_KINDS[kind].label}`, ops, [id]);
    saidWithUndo(`הפריט ${added.item.label} נוסף למפה`);
  }
  // ── end of edits ──────────────────────────────────────────────────────
```

3. Insert directly above the line `        {/* floating panels, over the scene */}`:

```tsx
        <ChecksBar doc={store.doc} flags={store.flags} onGo={goTo} />
        <Minimap
          doc={store.doc}
          flags={store.flags}
          selection={store.selection}
          info={view}
          onJump={(xCm, yCm) => { sceneRef.current?.jumpTo(xCm, yCm); }}
        />
        <ViewControls
          info={view}
          keysOpen={keysOpen}
          onZoom={(factor) => { sceneRef.current?.zoomBy(factor); }}
          onFit={fit}
          onRotate={(dir) => { sceneRef.current?.rotateView(dir); }}
          onNorth={() => { sceneRef.current?.northUp(); }}
          onKeys={() => { setKeysOpen((open) => !open); }}
        />
        <SelectionBar
          box={view.moving || store.selection.length === 0 ? null : view.selectionBox}
          locked={selected().length > 0 && selected().every((item) => item.locked)}
          onTurn={turnSelection}
          onDuplicate={duplicateSelection}
          onLock={toggleLock}
          onRemove={removeSelection}
        />
        <div className={styles.cards}>
          {keysOpen ? <ShortcutsCard onClose={() => { setKeysOpen(false); }} /> : null}
        </div>
```

- [ ] **Step 8: Run this task's tests**

Run: `npx vitest run "src/app/(admin)/site/editor/panels/checks-bar.test.tsx" "src/app/(admin)/site/editor/panels/minimap.test.tsx" "src/app/(admin)/site/editor/panels/view-controls.test.tsx" "src/app/(admin)/site/editor/site-editor.test.tsx" "src/app/(admin)/copy-sweep.test.tsx" "src/app/(admin)/a11y-sweep.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: all pass, exit 0 — 16 panel tests, 32 editor tests (22 + 10), both sweeps.

Run: `npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor"` — expected no errors.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(admin)/site/editor/panels/checks-bar.tsx" "src/app/(admin)/site/editor/panels/checks-bar.test.tsx" \
  "src/app/(admin)/site/editor/panels/minimap.tsx" "src/app/(admin)/site/editor/panels/minimap.test.tsx" \
  "src/app/(admin)/site/editor/panels/view-controls.tsx" "src/app/(admin)/site/editor/panels/selection-bar.tsx" \
  "src/app/(admin)/site/editor/panels/shortcuts-card.tsx" "src/app/(admin)/site/editor/panels/view-controls.test.tsx" \
  "src/app/(admin)/site/editor/editor.module.css" "src/app/(admin)/site/editor/site-editor.tsx" \
  "src/app/(admin)/site/editor/site-editor.test.tsx"
git commit -m "feat(site): checks, view controls, minimap, selection bar, shortcuts — and every edit says what it did, with ביטול

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: Shade by hour — sun card, sun light, north in the plot drawer

**Files:**
- Create: `src/app/(admin)/site/editor/panels/sun-card.tsx`, `panels/sun-card.test.tsx`
- Modify: `src/app/(admin)/site/plot-drawer.tsx`; Create: `src/app/(admin)/site/plot-drawer.test.tsx`
- Modify: `src/app/(admin)/site/failure-messages.ts` (`NORTH_INVALID`)
- Modify: `src/app/(admin)/site/page.tsx` (the plot drawer gets `northDeg`)
- Modify: `src/app/(admin)/site/editor/editor.module.css` (append), `site-editor.tsx`, `site-editor.test.tsx` (append)

**Interfaces:**
- Consumes: `CAMP_SITE`, `jerusalemInstant`, `sunPosition`, `shadeAtHour`, `ShadeAtHour` (`sun.ts`); `northText` (Task 23); `createPlanAction`, `setPlotAction` with `PlotInput.northDeg` (plan 01 Task 6); `SITE_ERRORS`' `'north must be'` row (plan 01 Task 7). The scene lights the sun itself from `ui.sun`, `ui.hour`, `sunDate` and `doc.plot.northDeg` (plan 03) — this task only drives `ui` and passes no sun without a real day.
- Produces (contract): `SunCard({ hour, onHour, summary, northDeg, plotHref, sunDate })` (+ `hourText`); `NORTH_INVALID`; `PlotDrawer`'s `plan` gains `northDeg: number`.

Two decisions recorded after plan 01 (overview, "Amendments recorded after plan 02") meet here. `setPlot` bumps the plan's version, so a plot saved in the drawer reaches the editor as a newer `initial.version` after the drawer's `router.refresh()`. The store keeps its first `init` (spec §6.1; plan 03 Task 16), so `SiteEditor` takes the newer map itself: with nothing waiting to be saved, through `resolveConflict('theirs')` — the same reload a conflict offers; with edits waiting, by raising the conflict banner so the lead chooses. It is never keyed on the version, which would drop unsaved edits.

- [ ] **Step 1: Write the failing tests**

Create `src/app/(admin)/site/editor/panels/sun-card.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ShadeAtHour } from '@/lib/site/editor/sun';
import { hourText, SunCard } from './sun-card';

const HREF = '/site?season=s26&act=plot';

function renderCard(over: Partial<{ hour: number; summary: ShadeAtHour | null; northDeg: number; sunDate: string | null }> = {}) {
  const onHour = vi.fn();
  render(
    <SunCard
      hour={over.hour ?? 14}
      onHour={onHour}
      summary={over.summary === undefined ? { under: 13, full: 4, partial: 4, sun: 5 } : over.summary}
      northDeg={over.northDeg ?? 0}
      plotHref={HREF}
      sunDate={over.sunDate === undefined ? '2026-06-04' : over.sunDate}
    />,
  );
  return { onHour };
}

describe('shade by hour', () => {
  it('says what is really shaded at the hour, for the gate day', () => {
    renderCard();
    expect(screen.getByText('בשעה 14:00, מתוך 13 פריטים מתחת לרשתות: 4 בצל מלא, 4 בצל חלקי, 5 בשמש')).toBeTruthy();
    expect(screen.getByText('ביום פתיחת השער, 4.6.2026, במיקום של מידברן.')).toBeTruthy();
  });

  it('runs from 07:00 to 18:00 in quarter hours', () => {
    const { onHour } = renderCard();
    const slider = screen.getByRole('slider', { name: 'שעה ביום' }) as HTMLInputElement;
    expect([slider.min, slider.max, slider.step]).toEqual(['7', '18', '0.25']);
    expect(slider.getAttribute('aria-valuetext')).toBe('14:00');
    fireEvent.change(slider, { target: { value: '9.25' } });
    expect(onHour).toHaveBeenCalledWith(9.25);
    expect(hourText(9.25)).toBe('09:15');
    expect(hourText(17.75)).toBe('17:45');
  });

  it('says the sun is down, or that nothing is under a net, rather than counting nothing', () => {
    renderCard({ hour: 7, summary: null });
    expect(screen.getByText('בשעה 07:00 השמש מתחת לאופק, ואין צל להראות.')).toBeTruthy();
  });

  it('asks for a gate day instead of guessing one, and draws no slider', () => {
    renderCard({ sunDate: null, summary: null });
    expect(screen.getByText(/עוד לא נרשם תאריך כזה/)).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('says which way north is, and links to where it is set', () => {
    renderCard({ northDeg: 90, summary: { under: 0, full: 0, partial: 0, sun: 0 } });
    expect(screen.getByText('בשעה 14:00 אין פריטים מתחת לרשתות הצל.')).toBeTruthy();
    expect(screen.getByText('למעלה במפה פונה למזרח (90°)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'שינוי בהגדרות המגרש' }).getAttribute('href')).toBe(HREF);
  });
});
```

Create `src/app/(admin)/site/plot-drawer.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';

const { createPlanAction, setPlotAction } = vi.hoisted(() => ({ createPlanAction: vi.fn(), setPlotAction: vi.fn() }));
vi.mock('./actions', () => ({ createPlanAction, setPlotAction }));
const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));

import { NORTH_INVALID } from './failure-messages';
import { PlotDrawer } from './plot-drawer';

const PLAN = { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 30, notes: null };

function renderDrawer(plan: typeof PLAN | null = PLAN) {
  render(
    <ToastProvider>
      <PlotDrawer seasonId="s26" seasonName="ברן 26" plan={plan} items={[]} closeHref="/site?season=s26" />
    </ToastProvider>,
  );
}

const north = () => screen.getByLabelText('כיוון הצפון') as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  setPlotAction.mockResolvedValue({ ok: true });
  createPlanAction.mockResolvedValue({ ok: true, value: 'p1' });
});

describe('the plot settings', () => {
  it('ask for north in whole degrees, starting from the plan’s own', () => {
    renderDrawer();
    expect(screen.getByRole('heading', { name: 'הגדרות המגרש' })).toBeTruthy();
    expect(north().value).toBe('30');
  });

  it('refuse a north that is not a whole degree from 0 to 359, in Hebrew, and send nothing', () => {
    renderDrawer();
    for (const text of ['360', '12.5', '-1', '']) {
      fireEvent.change(north(), { target: { value: text } });
      fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
      expect(screen.getByText(NORTH_INVALID)).toBeTruthy();
    }
    expect(setPlotAction).not.toHaveBeenCalled();
  });

  it('send the north with the plot, and refresh the page', async () => {
    renderDrawer();
    fireEvent.change(north(), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() => {
      expect(setPlotAction).toHaveBeenCalledWith('p1', { widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 15, notes: null });
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('start a new map with north up', async () => {
    renderDrawer(null);
    fireEvent.click(screen.getByRole('button', { name: 'יצירת המפה' }));
    await waitFor(() => {
      expect(createPlanAction).toHaveBeenCalledWith('s26', expect.objectContaining({ northDeg: 0 }));
    });
  });
});
```

Append to `src/app/(admin)/site/editor/site-editor.test.tsx`:

```tsx
describe('shade by hour', () => {
  it('opens the sun card from the tool row and lights the sun for the gate day', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.click(screen.getByRole('button', { name: 'צל לפי שעה' }));
    expect(lastScene().ui.sun).toBe(true);
    const card = within(screen.getByRole('group', { name: 'צל לפי שעה' }));
    expect(card.getByText(/^בשעה 14:00/)).toBeTruthy();
  });

  it('moves the hour with the slider', async () => {
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.click(screen.getByRole('button', { name: 'צל לפי שעה' }));
    fireEvent.change(screen.getByRole('slider', { name: 'שעה ביום' }), { target: { value: '9.25' } });
    expect(lastScene().ui.hour).toBe(9.25);
    expect(screen.getByText(/^בשעה 09:15/)).toBeTruthy();
  });

  it('asks for a gate day, and lights no sun, when the season has none', async () => {
    renderEditor({ sunDate: null });
    await screen.findByTestId('scene');
    fireEvent.click(screen.getByRole('button', { name: 'צל לפי שעה' }));
    expect(lastScene().ui.sun).toBe(false);
    expect(screen.getByText(/עוד לא נרשם תאריך כזה/)).toBeTruthy();
  });
});

describe('a plot saved in the drawer', () => {
  const widened = () => ({ doc: siteDoc([siteItem({ id: 'a' })], { widthCm: 3000 }), version: 1 });

  it('is taken up at once when nothing is waiting to be saved', async () => {
    loadSiteDocAction.mockResolvedValue({ ok: true, value: widened() });
    const { rerenderWith } = renderEditor();
    await screen.findByTestId('scene');
    rerenderWith({ initial: widened() });
    await waitFor(() => { expect(lastScene().store.doc.plot.widthCm).toBe(3000); });
    expect(loadSiteDocAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/המפה שונתה ממקום אחר/)).toBeNull();
  });

  it('raises the choice, rather than dropping edits, when something is waiting to be saved', async () => {
    loadSiteDocAction.mockResolvedValue({ ok: true, value: widened() });
    const { rerenderWith } = renderEditor();
    await screen.findByTestId('scene');
    fireEvent.keyDown(stage(), { code: 'KeyR' }); // waiting: the queue sends after 500 ms
    rerenderWith({ initial: widened() });
    expect(screen.getByText('המפה שונתה ממקום אחר מאז שנפתחה. השינויים האחרונים שלך עוד לא נשמרו.')).toBeTruthy();
    expect(loadSiteDocAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'שמירת השינויים שלי מעליה' }));
    await waitFor(() => { expect(lastScene().store.doc.plot.widthCm).toBe(3000); });
    expect(firstItem()).toMatchObject({ widthCm: 200, depthCm: 300 });
    await waitFor(() => {
      expect(saveSiteChangesAction).toHaveBeenLastCalledWith('p1', 1, expect.any(Array));
    }, { timeout: 3000 });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run "src/app/(admin)/site/editor/panels/sun-card.test.tsx" "src/app/(admin)/site/plot-drawer.test.tsx" "src/app/(admin)/site/editor/site-editor.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `Failed to resolve import "./sun-card"`; `NORTH_INVALID` is not exported, and there is no `כיוון הצפון` field; the 5 new editor tests fail (no sun card; the plot stays 2600 wide); the 32 editor tests from Tasks 21–24 pass.

- [ ] **Step 3: The sun card**

Append to `src/app/(admin)/site/editor/editor.module.css`:

```css
/* ---- shade by hour ---------------------------------------------------- */

.sunCard { inline-size: 360px; }

.sunRow {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--text-dense);
}

.range {
  flex: 1;
  accent-color: var(--brand);
}
```

Create `src/app/(admin)/site/editor/panels/sun-card.tsx`:

```tsx
'use client';

/**
 * Shade by hour (spec §11): the hour, 07:00 to 18:00 in quarter hours, and
 * what is really in shade then — counted by `shadeAtHour` for the gate day
 * over the Midburn pin. Without a gate day the card says so and the scene
 * lights no sun: the map does not guess a day (§13). It says which way north
 * is, and links to the plot settings where that is set.
 */

import Link from 'next/link';
import type { ReactElement } from 'react';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import type { ShadeAtHour } from '@/lib/site/editor/sun';
import { northText } from './north';
import styles from '../editor.module.css';

/** 14.25 → "14:15". */
export function hourText(hour: number): string {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function summaryText(hour: number, summary: ShadeAtHour | null): string {
  const at = hourText(hour);
  if (summary === null) return `בשעה ${at} השמש מתחת לאופק, ואין צל להראות.`;
  if (summary.under === 0) return `בשעה ${at} אין פריטים מתחת לרשתות הצל.`;
  return `בשעה ${at}, מתוך ${summary.under} פריטים מתחת לרשתות: ${summary.full} בצל מלא, ${summary.partial} בצל חלקי, ${summary.sun} בשמש`;
}

/** "2026-06-04" → "4.6.2026". */
function dayText(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(day)}.${Number(month)}.${year}`;
}

export function SunCard({ hour, onHour, summary, northDeg, plotHref, sunDate }: {
  hour: number;
  onHour: (hour: number) => void;
  /** Null while the sun is down — or when there is no day to ask about. */
  summary: ShadeAtHour | null;
  northDeg: number;
  plotHref: string;
  sunDate: string | null;
}): ReactElement {
  return (
    <div className={cx(styles.card, styles.sunCard)} role="group" aria-label="צל לפי שעה" data-panel="true">
      {sunDate === null ? (
        <p className={styles.hint}>
          צל לפי שעה מחושב ליום פתיחת השער, ולשנה הזו עוד לא נרשם תאריך כזה. בלי תאריך המפה לא מנחשת יום; כשייקבע תאריך, הצל יחושב לפיו.
        </p>
      ) : (
        <>
          <div className={styles.sunRow}>
            <Icon name="sun" size={16} />
            <b><bdi>{hourText(hour)}</bdi></b>
            <input
              type="range"
              className={styles.range}
              min={7}
              max={18}
              step={0.25}
              value={hour}
              aria-label="שעה ביום"
              aria-valuetext={hourText(hour)}
              onChange={(event) => { onHour(Number(event.target.value)); }}
            />
          </div>
          <p className={styles.hint}><bdi>{summaryText(hour, summary)}</bdi></p>
          <p className={styles.meta}><bdi>{`ביום פתיחת השער, ${dayText(sunDate)}, במיקום של מידברן.`}</bdi></p>
        </>
      )}
      <p className={styles.meta}>
        <bdi>{northText(northDeg)}</bdi>
        {' · '}
        <Link href={plotHref} className={styles.link}>שינוי בהגדרות המגרש</Link>
      </p>
    </div>
  );
}
```

Run: `npx vitest run "src/app/(admin)/site/editor/panels/sun-card.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: 5 passed.

- [ ] **Step 4: North in the plot drawer**

In `src/app/(admin)/site/failure-messages.ts`, append after the line `export const ITEM_SIDE_INVALID = …`:

```ts
export const NORTH_INVALID = SITE_ERRORS.find(([prefix]) => prefix === 'north must be')![1];
```

In `src/app/(admin)/site/plot-drawer.tsx`:

1. Replace the line `import { PLOT_SIDE_INVALID } from './failure-messages';` with:

```tsx
import { NORTH_INVALID, PLOT_SIDE_INVALID } from './failure-messages';
```

2. In the props type, replace `  plan: { id: string; widthCm: number; depthCm: number; gridCm: number; notes: string | null } | null;` with:

```tsx
  plan: { id: string; widthCm: number; depthCm: number; gridCm: number; northDeg: number; notes: string | null } | null;
```

3. Add after the line `  const [grid, setGrid] = useState(String(plan?.gridCm ?? 50));`:

```tsx
  const [north, setNorth] = useState(String(plan?.northDeg ?? 0));
```

4. Add after the line `    && widthCm >= 100 && depthCm >= 100 && widthCm <= 50_000 && depthCm <= 50_000;`:

```tsx
  /* Whole degrees, 0–359: the same refusal `plan.ts` makes, made here first. */
  const northDeg = Number(north.trim());
  const northValid = north.trim() !== '' && Number.isInteger(northDeg) && northDeg >= 0 && northDeg <= 359;
```

5. Replace the two lines

```tsx
    if (!valid) { setRefusal(PLOT_SIDE_INVALID); return; }

    const input = { widthCm, depthCm, gridCm: Number(grid), notes: plan?.notes ?? null };
```

with:

```tsx
    if (!valid) { setRefusal(PLOT_SIDE_INVALID); return; }
    if (!northValid) { setRefusal(NORTH_INVALID); return; }

    const input = { widthCm, depthCm, gridCm: Number(grid), northDeg, notes: plan?.notes ?? null };
```

6. Replace the line

```tsx
        message: plan === null ? `נוצרה מפה ל${seasonName}` : 'גודל המגרש עודכן',
```

with:

```tsx
        message: plan === null ? `נוצרה מפה ל${seasonName}` : 'הגדרות המגרש עודכנו',
```

7. Replace the line

```tsx
      title={plan === null ? 'יצירת מפה' : 'גודל המגרש'}
```

with:

```tsx
      title={plan === null ? 'יצירת מפה' : 'הגדרות המגרש'}
```

8. Insert directly after the closing `</Field>` of the `plot-grid` field:

```tsx
        <Field
          id="plot-north"
          label="כיוון הצפון"
          hint="במעלות שלמות, מ־0 עד 359: לאן פונה החלק העליון של המפה. 0 הוא צפון. משמש רק לצל לפי שעה."
        >
          <input
            className={styles.plainInput}
            id="plot-north"
            type="number" min="0" max="359" step="1" inputMode="numeric"
            value={north}
            onChange={(event) => { setNorth(event.target.value); }}
          />
        </Field>
```

In `src/app/(admin)/site/page.tsx`, the plot drawer now needs the north. Replace every occurrence (there are two: in `drawers` and in the `?editor=3d` branch) of

```tsx
plan={{ id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm, notes: plan.notes }}
```

with:

```tsx
plan={{ id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm, northDeg: plan.northDeg, notes: plan.notes }}
```

and replace the button text `גודל המגרש` inside `plotLink` with `הגדרות המגרש`. In `src/app/(admin)/site/page.test.tsx`, the Task 20 test that reads `screen.getByRole('link', { name: /גודל המגרש/ })` no longer exists (Task 21 replaced it); search the file for `גודל המגרש` and, if any assertion still names it, change the name to `הגדרות המגרש`.

Run: `npx vitest run "src/app/(admin)/site/plot-drawer.test.tsx" "src/app/(admin)/site/page.test.tsx" "src/app/(admin)/site/failure-messages.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: all pass — 4 plot drawer, the page's 17, and the failure messages.

- [ ] **Step 5: Drive the sun, and take up a newer plot, in `SiteEditor`**

In `src/app/(admin)/site/editor/site-editor.tsx`:

1. Replace the line `  useCallback, useMemo, useRef, useState, useSyncExternalStore,` with:

```tsx
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
```

2. Add after the line `import { screenArrowToMap } from '@/lib/site/editor/camera';`:

```tsx
import { CAMP_SITE, jerusalemInstant, shadeAtHour, sunPosition } from '@/lib/site/editor/sun';
```

3. Add after the line `import { ShortcutsCard } from './panels/shortcuts-card';`:

```tsx
import { SunCard } from './panels/sun-card';
```

4. Add after the line `  const vars = useMemo(() => paletteVars(theme), [theme]);`:

```tsx

  /* Shade by hour (spec §11): the sun at the chosen quarter hour of the gate
     day, over the camp's pin, counted with the map's north. Only for a real
     `YYYY-MM-DD` day — anything else is no day, never a guess. */
  const gateDay = sunDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(sunDate) ? sunDate : null;
  const sun = ui.sun && gateDay !== null
    ? sunPosition(jerusalemInstant(gateDay, ui.hour), CAMP_SITE.latitude, CAMP_SITE.longitude)
    : null;
  const sunSummary = sun === null ? null : shadeAtHour(store.doc, sun);

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
    void store.resolveConflict('theirs');
  });
```

5. Replace the line `      {store.conflict === null ? null : (` with:

```tsx
      {store.conflict === null && !plotMovedUnderEdits ? null : (
```

6. Replace the line `          {keysOpen ? <ShortcutsCard onClose={() => { setKeysOpen(false); }} /> : null}` with:

```tsx
          {ui.sun ? (
            <SunCard
              hour={ui.hour}
              onHour={(hour) => { patchUi({ hour }); }}
              summary={sunSummary}
              northDeg={store.doc.plot.northDeg}
              plotHref={plotHref}
              sunDate={gateDay}
            />
          ) : null}
          {keysOpen ? <ShortcutsCard onClose={() => { setKeysOpen(false); }} /> : null}
```

7. Replace the `sceneUi` line

```tsx
  const sceneUi = useMemo<EditorUi>(() => ({ ...fullUi, sun: fullUi.sun && sunDate !== null }), [fullUi, sunDate]);
```

with (the same rule as the card: only a real day lights the sun):

```tsx
  const sceneUi = useMemo<EditorUi>(
    () => ({ ...fullUi, sun: fullUi.sun && sunDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(sunDate) }),
    [fullUi, sunDate],
  );
```

- [ ] **Step 6: Run this task's tests**

Run: `npx vitest run "src/app/(admin)/site/editor/panels/sun-card.test.tsx" "src/app/(admin)/site/plot-drawer.test.tsx" "src/app/(admin)/site/page.test.tsx" "src/app/(admin)/site/failure-messages.test.ts" "src/app/(admin)/site/editor/site-editor.test.tsx" "src/app/(admin)/copy-sweep.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: all pass, exit 0 — 5 sun card, 4 plot drawer, 17 page, the failure messages, 37 editor tests (32 + 5), the copy sweep.

Run: `npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site"` — expected no errors.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(admin)/site/editor/panels/sun-card.tsx" "src/app/(admin)/site/editor/panels/sun-card.test.tsx" \
  "src/app/(admin)/site/plot-drawer.tsx" "src/app/(admin)/site/plot-drawer.test.tsx" \
  "src/app/(admin)/site/failure-messages.ts" "src/app/(admin)/site/page.tsx" "src/app/(admin)/site/page.test.tsx" \
  "src/app/(admin)/site/editor/editor.module.css" "src/app/(admin)/site/editor/site-editor.tsx" \
  "src/app/(admin)/site/editor/site-editor.test.tsx"
git commit -m "feat(site): shade by hour for the gate day, north in the plot settings, and a saved plot reaching the open editor

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 26: The page switches over; the board, item drawer and remove page retire; PNG export

**Files:**
- Modify: `src/app/(admin)/site/page.tsx` (replaced whole), `src/app/(admin)/site/page.test.tsx` (replaced whole)
- Modify: `src/lib/site/views.ts` (replaced whole), `src/lib/site/views.test.ts` (replaced whole)
- Modify: `src/app/(admin)/site/actions.ts` (three actions out), `src/app/(admin)/site/site.module.css` (replaced whole), `src/app/(admin)/site/loading.tsx` (replaced whole)
- Modify: `src/app/(admin)/site/editor/site-editor.tsx`, `editor.module.css` (append), `site-editor.test.tsx`
- Create: `src/app/(admin)/site/editor/site-editor.no-webgl.test.tsx`
- Delete: `src/app/(admin)/site/site-board.tsx`, `site-board.test.tsx`, `item-drawer.tsx`, `remove-item.tsx`

**Interfaces:**
- Consumes: everything above; `SiteTable` (kept, spec §12); `SceneHandle.exportPng()`; `loadDoc`, `siteView`, `seasonsWithPlans` (`plan.ts`).
- Produces: `/site` renders `SiteEditor` by default with `fallback` = the item table; `SiteEditorProps.fallback?: ReactNode`; the "ייצוא תמונה" button. Removes: `SiteQuery.editor3d`, `SiteQuery.removing`, `REMOVE_ACT`, `removeItemHref`, `addItemAction`, `updateItemAction`, `removeItemAction`, the stat tiles and the outside banner, and four files. **Keeps** `addItem`, `updateItem`, `removeItem` in `plan.ts` — `plan.test.ts` uses them as fixtures.

- [ ] **Step 1: Prove nothing outside the camp map uses what retires**

Spec §12 checked this on 2026-09-24 against `60e1850`; the branch has moved since. Count with `node` (the RTK hook has truncated and inflated `grep` counts here — `CLAUDE.md`, "Traps"). Comments are stripped first, as `copy-sweep.test.tsx` does, so a sentence of history does not count as a use:

```bash
cd /Users/yarin/GitProjects/Shliff_Platform-lanes/site-3d
node -e "
const fs=require('fs'),p=require('path');
const retired=/site-board|item-drawer|remove-item|SiteBoard|ItemDrawer|RemoveItem\b|REMOVE_ACT|removeItemHref|addItemAction|updateItemAction|removeItemAction|editor3d/;
const code=(s)=>s.replace(/\/\*[\s\S]*?\*\//g,' ').split('\n').map((l)=>l.replace(/\/\/.*$/,'')).join('\n');
const hits=[];
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())walk(f);else if(/\.(ts|tsx)$/.test(f)&&retired.test(code(fs.readFileSync(f,'utf8'))))hits.push(f);}})('src');
const outside=hits.filter((f)=>!f.startsWith('src/app/(admin)/site/')&&!f.startsWith('src/lib/site/'));
console.log('files naming a retired thing:', hits.length);
console.log(hits.join('\n'));
console.log('outside the camp map:', outside.length);
"
```

Expected: a non-zero first count — the positive control, since `actions.ts`, `page.tsx`, `views.ts` and the four files themselves use these names — every listed file under `src/app/(admin)/site/` or `src/lib/site/`, and `outside the camp map: 0`. If the first count is 0, the instrument is dead: stop and find out why before deleting anything. If anything is outside, stop and ask the coordinator — per `docs/collab/protocol.md` §3 rule 4, a removal another area consumes does not happen in this PR.

- [ ] **Step 2: Write the failing tests**

Replace the whole of `src/lib/site/views.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { itemHref, parseSiteQuery, sunDateOf } from './views';

describe('the camp map’s address', () => {
  it('reads the season, the item to select and the drawer — and nothing the old board read', () => {
    expect(parseSiteQuery({ season: 's26', peek: 'a', act: 'remove', editor: '3d' }))
      .toEqual({ season: 's26', peek: 'a', plot: false, copy: false });
    expect(parseSiteQuery({ act: 'plot' })).toEqual({ season: '', peek: null, plot: true, copy: false });
    expect(parseSiteQuery({ act: ['copy', 'plot'] })).toEqual({ season: '', peek: null, plot: false, copy: true });
  });

  it('links to an item by selecting it on the map', () => {
    expect(itemHref({ season: 's26' }, 'a')).toBe('/site?season=s26&peek=a');
  });
});

describe('the day shade by hour is worked out for', () => {
  it('is the gate day as a calendar date in Israel, not in UTC', () => {
    // 22:30 UTC on 3 June is 01:30 on 4 June in Israel (summer time, UTC+3).
    expect(sunDateOf(new Date('2026-06-03T22:30:00Z'))).toBe('2026-06-04');
    expect(sunDateOf(new Date('2026-06-04T09:00:00Z'))).toBe('2026-06-04');
  });

  it('is nothing when the season has no gate day, rather than a guess', () => {
    expect(sunDateOf(null)).toBeNull();
  });
});
```

Replace the whole of `src/app/(admin)/site/page.test.tsx` with:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
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
/* The editor has its own tests, with the scene mocked. Here it only has to be
   handed the right things; the table it is given is rendered, as a phone and
   a browser without WebGL see it. */
vi.mock('./editor/site-editor', () => ({
  SiteEditor: (props: {
    initial: { doc: EditorDoc; version: number };
    initialSelection: string | null;
    sunDate: string | null;
    buildTasks: ReadonlyArray<{ id: string; title: string }>;
    plotHref: string;
    fallback?: ReactNode;
  }) => (
    <div
      data-testid="editor"
      data-selection={props.initialSelection ?? ''}
      data-sun={props.sunDate ?? ''}
      data-tasks={props.buildTasks.map((task) => task.title).join(',')}
      data-plot={props.plotHref}
    >
      <span data-testid="editor-map">{`editor:${props.initial.doc.items.length}:v${props.initial.version}`}</span>
      {props.fallback}
    </div>
  ),
}));

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
    insetCm: null, heightCm: null, locked: false, sort: 0, taskId: null, taskTitle: null, notes: null,
    updatedAt: new Date('2026-09-01T00:00:00Z'), updatedBy: 'lead@shliff.camp',
    outside: false, overlapping: false, shade: 'unshaded', ...over,
  };
}

function view(items: SiteItemView[]) {
  return {
    plan: PLAN,
    items,
    counts: {
      items: items.length, outside: items.filter((row) => row.outside).length, overlapping: 0, overlapPairs: 0,
      plotAreaM2: 624, shade: { nets: 0, shaded: 0, partly: 0, unshaded: items.length, shadedAreaM2: 0 },
    },
  };
}

/** What `loadDoc` answers for the same rows: the editor's document and the version it saves against. */
function loaded(ids: string[]): { doc: EditorDoc; version: number } {
  return {
    version: 3,
    doc: {
      plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 },
      items: ids.map((id, index) => ({
        id, kind: 'tent', label: `אוהל ${index + 1}`, xCm: 0, yCm: 0, widthCm: 300, depthCm: 300,
        heightCm: null, insetCm: null, sort: index, taskId: null, notes: null, locked: false,
      })),
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
async function renderPage(params: Record<string, string> = {}) {
  const page = await SitePage({ searchParams: Promise.resolve({ season: 's26', ...params }) });
  render(<ToastProvider>{page}</ToastProvider>);
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

  it('mounts the editor with the map it saves against, the season’s build tasks and the plot settings’ address', async () => {
    siteView.mockResolvedValue(view([item({ id: 'a' }), item({ id: 'b', label: 'אוהל 2' })]));
    loadDoc.mockResolvedValue(loaded(['a', 'b']));
    listTasks.mockResolvedValue([{ taskId: 't1', title: 'הקמת המטבח' }]);
    await renderPage();

    const editor = screen.getByTestId('editor');
    expect(screen.getByTestId('editor-map').textContent).toBe('editor:2:v3');
    expect(editor.getAttribute('data-tasks')).toBe('הקמת המטבח');
    expect(editor.getAttribute('data-plot')).toBe('/site?season=s26&act=plot');
    expect(loadDoc).toHaveBeenCalledWith({}, 'p1');
    expect(listTasks).toHaveBeenCalledWith({}, 's26', { kind: 'build' });
  });

  it('hands the editor the item table, which says each state in words and offers no delete page', async () => {
    siteView.mockResolvedValue(view([
      item({ id: 'in' }),
      item({ id: 'out', label: 'קראוון 1', kind: 'caravan', xCm: 2500, outside: true }),
    ]));
    loadDoc.mockResolvedValue(loaded(['in', 'out']));
    await renderPage();

    const table = within(screen.getByTestId('editor')).getByRole('table', { name: 'הפריטים במפה' });
    expect(within(table).getByRole('link', { name: 'קראוון 1' }).getAttribute('href')).toBe('/site?season=s26&peek=out');
    expect(within(table).getAllByText('מחוץ למגרש').length).toBeGreaterThan(0);
    // R11, on every row.
    expect(within(table).getAllByRole('img', { name: 'מקור: נרשם ידנית' })).toHaveLength(2);
    // Removal is undoable in the editor now; there is no confirmation page to link to.
    expect(within(table).queryByRole('link', { name: 'מחיקה' })).toBeNull();
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
    expect(screen.getByTestId('editor')).toBeTruthy();
  });

  it('is not found when the map vanished between the two reads', async () => {
    siteView.mockResolvedValue(view([item({ id: 'a' })]));
    loadDoc.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow();
  });

  it('is not found for a signed-in non-admin', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    await expect(renderPage()).rejects.toThrow();
  });
});
```

In `src/app/(admin)/site/editor/site-editor.test.tsx`, add to its `beforeAll`, after `stubMedia();`:

```tsx
  // jsdom draws nothing; a context object is enough for the editor's one-time WebGL question.
  HTMLCanvasElement.prototype.getContext = (() => ({ getExtension: () => null })) as unknown as HTMLCanvasElement['getContext'];
```

and append to the end of the file:

```tsx
describe('what a narrow screen gets, and the picture of the view', () => {
  const TABLE = <table aria-label="הפריטים במפה"><tbody><tr><td>אוהל 1</td></tr></tbody></table>;

  it('gives a screen under 900 px the table, and mounts no scene', () => {
    stubMedia({ wide: false });
    renderEditor({ fallback: TABLE });
    expect(screen.getByRole('table', { name: 'הפריטים במפה' })).toBeTruthy();
    expect(screen.queryByTestId('scene')).toBeNull();
  });

  it('saves a picture of the view as a PNG named for the season', async () => {
    scene.handle.exportPng.mockReturnValue('data:image/png;base64,AAAA');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.click(screen.getByRole('button', { name: 'ייצוא תמונה' }));
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.href).toBe('data:image/png;base64,AAAA');
    expect(link.download).toBe('מפת הקאמפ ברן 26.png');
    click.mockRestore();
  });

  it('says so, in Hebrew, when the picture cannot be made', async () => {
    scene.handle.exportPng.mockReturnValue(null);
    renderEditor();
    await screen.findByTestId('scene');
    fireEvent.click(screen.getByRole('button', { name: 'ייצוא תמונה' }));
    expect(await screen.findByText('לא הצלחנו לשמור תמונה של המפה. אפשר לנסות שוב.')).toBeTruthy();
  });
});
```

Create `src/app/(admin)/site/editor/site-editor.no-webgl.test.tsx` (its own file, because the editor asks about WebGL once per page load — a new module registry is a new page):

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { EditorDoc } from '@/lib/site/editor/model';
import type { SceneHandle, SceneViewProps } from './scene/scene-view';

vi.mock('../actions', () => ({ saveSiteChangesAction: vi.fn(), loadSiteDocAction: vi.fn() }));
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
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false,
  }],
  defaults: {},
};

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  // This browser gives no WebGL: every context comes back null.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

describe('the editor without WebGL', () => {
  it('puts the item table under the scene’s own notice, and draws no tool row', async () => {
    render(
      <ToastProvider>
        <SiteEditor
          initial={{ doc: DOC, version: 0 }}
          initialSelection={null}
          seasonName="ברן 26"
          sunDate={null}
          buildTasks={[]}
          plotHref="/site?season=s26&act=plot"
          fallback={<table aria-label="הפריטים במפה"><tbody><tr><td>אוהל 1</td></tr></tbody></table>}
        />
      </ToastProvider>,
    );
    expect(await screen.findByTestId('scene')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'הפריטים במפה' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'כלי העריכה' })).toBeNull();
    // The top bar still says where saving stands.
    expect(screen.getByText('כל השינויים נשמרו')).toBeTruthy();
  });
});
```

Run: `npx vitest run src/lib/site/views.test.ts "src/app/(admin)/site/page.test.tsx" "src/app/(admin)/site/editor/site-editor.test.tsx" "src/app/(admin)/site/editor/site-editor.no-webgl.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `parseSiteQuery` still returns `removing` and `editor3d`; the page still draws the board (and imports `./site-board`, which the new test file no longer mocks); no "ייצוא תמונה" button, no table below 900 px, no table without WebGL.

- [ ] **Step 3: The editor takes a fallback, knows its width and its WebGL, and exports a picture**

In `src/app/(admin)/site/editor/site-editor.tsx`:

1. Replace the line `  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type RefAttributes,` with:

```tsx
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode, type RefAttributes,
```

2. Replace the two lines

```tsx
  /** The plot drawer: size, grid and north. */
  plotHref: string;
}
```

with:

```tsx
  /** The plot drawer: size, grid and north. */
  plotHref: string;
  /**
   * The item table (`site-table.tsx`, rendered by the page): the map on a
   * screen under 900 px, and under the scene's no-WebGL notice (spec §7).
   */
  fallback?: ReactNode;
}
```

3. Insert directly above the line `/** The scene's group colours, handed to every panel as custom properties. */`:

```tsx
/* Under 900 px the table is the view (spec §7) and the scene is not even
   mounted, so a phone holds no WebGL context. The server cannot know the
   width; it renders the wide page and CSS hides it below 900 px until the
   client decides. */
const WIDE_QUERY = '(min-width: 900px)';

function readWide(): boolean {
  return window.matchMedia(WIDE_QUERY).matches;
}

function subscribeWide(onChange: () => void): () => void {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener('change', onChange);
  return () => { media.removeEventListener('change', onChange); };
}

/**
 * Whether this browser can give WebGL, asked once per page load. `SceneView`
 * says so in its own words when it cannot, but tells nobody; the editor needs
 * to know, to put the item table under that notice. The context made to ask
 * is let go at once.
 */
let webglAnswer: boolean | null = null;

function readWebgl(): boolean {
  if (webglAnswer === null) {
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      webglAnswer = context !== null;
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webglAnswer = false;
    }
  }
  return webglAnswer;
}

function subscribeNever(): () => void {
  return () => {};
}

function serverYes(): boolean {
  return true;
}

```

4. Add after the line `  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);`:

```tsx
  const wide = useSyncExternalStore(subscribeWide, readWide, serverYes);
  const webgl = useSyncExternalStore(subscribeNever, readWebgl, serverYes);
```

5. Insert directly above the line `  function runShortcut(shortcut: Shortcut): void {`:

```tsx
  /** "ייצוא תמונה" (spec §10): the current view as a PNG, named for the season. */
  function exportPicture(): void {
    const url = sceneRef.current?.exportPng() ?? null;
    if (url === null) {
      show({ message: 'לא הצלחנו לשמור תמונה של המפה. אפשר לנסות שוב.', tone: 'bad' });
      return;
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = `מפת הקאמפ ${seasonName}.png`;
    link.click();
  }

```

6. Insert directly above the line `  const editor = (`:

```tsx
  const scene = (
    <SceneView
      ref={sceneRef}
      store={store}
      ui={sceneUi}
      insets={INSETS}
      sunDate={sunDate}
      onView={onView}
      onNotice={onNotice}
    />
  );

```

7. Replace the block

```tsx
        <div className={styles.scene}>
          <SceneView
            ref={sceneRef}
            store={store}
            ui={sceneUi}
            insets={INSETS}
            sunDate={sunDate}
            onView={onView}
            onNotice={onNotice}
          />
        </div>
```

with:

```tsx
        {wide ? <div className={styles.scene}>{scene}</div> : null}
```

8. Insert directly above the line `            <ButtonLink size="sm" href={plotHref}>` (in the top bar's actions):

```tsx
            <Button size="sm" onClick={exportPicture} disabled={!wide || !webgl}>
              <Icon name="download" size={14} />
              ייצוא תמונה
            </Button>
```

9. Replace the line `      {editor}` with:

```tsx
      {webgl ? (
        <>
          {editor}
          <div className={styles.narrowView}>{props.fallback}</div>
        </>
      ) : (
        <div className={styles.fallback}>
          {/* Where the map would be: the scene says, in its own words, that it needs WebGL. */}
          <div className={styles.noScene}>{scene}</div>
          {props.fallback}
        </div>
      )}
```

Append to `src/app/(admin)/site/editor/editor.module.css`:

```css
/* ---- the item table: a narrow screen, and a browser without WebGL ------ */

.narrowView { display: none; }

.fallback {
  flex: 1;
  min-block-size: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
}

/* The scene's own box, holding its no-WebGL sentence where the map would be. */
.noScene {
  position: relative;
  flex-shrink: 0;
  block-size: 360px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
}

/* Spec §7: under 900 px the table is the view. Matches `WIDE_QUERY`. */
@media (max-width: 899.98px) {
  .editorArea { display: none; }
  .narrowView {
    display: block;
    flex: 1;
    min-block-size: 0;
    overflow-y: auto;
    padding: var(--space-4);
  }
}
```

- [ ] **Step 4: The page, the addresses and the actions**

Replace the whole of `src/lib/site/views.ts` with:

```ts
import {
  ACT_PARAM, PEEK_PARAM, closePeekHref, openActHref, openPeekHref,
} from '@/components/ui/drawer-url';

export const SITE_PATH = '/site';

/** `?act=plot`: the plot drawer — create the map, or change its size, grid and north. */
export const PLOT_ACT = 'plot';
/** `?act=copy`: the drawer that copies another season's map into this one. */
export const COPY_ACT = 'copy';

export type RawParams = Record<string, string | string[] | undefined>;

export interface SiteQuery {
  season: string;
  /** `?peek=<id>`: the item selected when the map loads — a deep link (spec §12). */
  peek: string | null;
  plot: boolean;
  copy: boolean;
}

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function parseSiteQuery(params: RawParams): SiteQuery {
  const act = one(params[ACT_PARAM]);
  return {
    season: one(params.season),
    peek: one(params[PEEK_PARAM]) || null,
    plot: act === PLOT_ACT,
    copy: act === COPY_ACT,
  };
}

/** Only the season survives from one URL to the next (R5); drawers are the kit's. */
function carried(params: RawParams): URLSearchParams {
  const next = new URLSearchParams();
  const season = one(params.season);
  if (season) next.set('season', season);
  return next;
}

/** The page itself, with any drawer closed. */
export function siteHref(params: RawParams): string {
  return closePeekHref(SITE_PATH, carried(params));
}

/** The map with this item selected when it loads (the table's rows link here). */
export function itemHref(params: RawParams, id: string): string {
  return openPeekHref(SITE_PATH, carried(params), id);
}

export function plotHref(params: RawParams): string {
  return openActHref(SITE_PATH, carried(params), PLOT_ACT);
}

export function copyHref(params: RawParams): string {
  return openActHref(SITE_PATH, carried(params), COPY_ACT);
}

/**
 * The day shade by hour is worked out for (spec §11): the season's gate day,
 * as the calendar date it is in Israel. Null when the season has none — the
 * sun card then asks for one rather than guessing a day (§13).
 */
export function sunDateOf(startsOn: Date | null): string | null {
  if (startsOn === null) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(startsOn);
  const part = (type: 'year' | 'month' | 'day') => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
```

Replace the whole of `src/app/(admin)/site/page.tsx` with:

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import { listTasks } from '@/lib/work/tasks';
import { loadDoc, seasonsWithPlans, siteView } from '@/lib/site/plan';
import {
  copyHref, parseSiteQuery, plotHref, siteHref, sunDateOf, type RawParams,
} from '@/lib/site/views';
import { TopBar, SeasonChip } from '@/components/shell/top-bar';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { SiteEditor } from './editor/site-editor';
import { SiteTable } from './site-table';
import { PlotDrawer } from './plot-drawer';
import { CopyDrawer } from './copy-drawer';
import styles from './site.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'מפת הקאמפ' };

/**
 * מפת הקאמפ — where everything goes this year.
 *
 * One map per season. The page reads it once and hands it to the editor
 * (spec §6.1); from then on the editor's store is the truth and saves in the
 * background, so nothing here re-reads after an edit. The item table goes
 * with it: the editor shows it on a screen under 900 px and under its
 * no-WebGL notice (§7), so a phone, a screen reader and an old browser all
 * still read the map.
 *
 * Every number on this screen was typed by somebody (R11): no workbook holds
 * a map, and the chips say so.
 */
export default async function SitePage(
  { searchParams }: { searchParams: Promise<RawParams> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const params = await searchParams;
  const query = parseSiteQuery(params);
  const { current } = await resolveSeason(db, query.season || undefined);

  const crumbs = [{ label: 'מפת הקאמפ' }];

  if (current === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={crumbs} />
        <h1>מפת הקאמפ</h1>
        <EmptyState
          kind="nothing-yet"
          noun="שנים"
          action={{ label: 'ייבוא מהגיליון', href: '/imports' }}
        />
      </main>
    );
  }

  /* The URL the sidebar wrote may carry no `season`; every link this page
     builds carries the one it resolved, so a switch of year survives a
     drawer (R5). */
  const here: RawParams = { season: current.id };
  const closeHref = siteHref(here);
  const view = await siteView(db, current.id);
  const others = (await seasonsWithPlans(db)).filter((plan) => plan.seasonId !== current.id);

  if (view === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={crumbs} chip={<SeasonChip seasonName={current.name} />} />
        <h1>מפת הקאמפ</h1>
        <EmptyState
          kind="nothing-this-season"
          noun="מפות"
          seasonName={current.name}
          action={{ label: 'יצירת מפה', href: plotHref(here) }}
        />
        {others.length === 0 ? null : (
          <div className={styles.invitations}>
            <ButtonLink size="sm" href={copyHref(here)}>
              <Icon name="copy" size={14} />
              {`העתקה מ${others[0].seasonName}`}
            </ButtonLink>
          </div>
        )}
        {query.plot ? (
          <PlotDrawer seasonId={current.id} seasonName={current.name} plan={null} items={[]} closeHref={closeHref} />
        ) : null}
        {query.copy && others.length > 0 ? (
          <CopyDrawer seasonId={current.id} seasonName={current.name} sources={others} closeHref={closeHref} />
        ) : null}
      </main>
    );
  }

  const { plan, items } = view;
  const loaded = await loadDoc(db, plan.id);
  // Null only if the plan vanished between `siteView` and here.
  if (loaded === null) notFound();

  /* `?peek=` selects an item when the map loads (spec §12) — only one that is
     on this season's map. */
  const initialSelection = query.peek !== null && loaded.doc.items.some((entry) => entry.id === query.peek)
    ? query.peek
    : null;
  const buildTasks = (await listTasks(db, current.id, { kind: 'build' }))
    .map((task) => ({ id: task.taskId, title: task.title }));

  return (
    <main className={styles.editorPage}>
      <h1 className="sr-only">{`מפת הקאמפ · ${current.name}`}</h1>
      {/* Never keyed on the plot or the version: a remount would drop
          unsaved edits. A newer version is taken up inside (Task 25). */}
      <SiteEditor
        initial={loaded}
        initialSelection={initialSelection}
        seasonName={current.name}
        sunDate={sunDateOf(current.startsOn)}
        buildTasks={buildTasks}
        plotHref={plotHref(here)}
        fallback={(
          <SiteTable
            items={items}
            params={here}
            season={current.id}
            empty={<EmptyState kind="nothing-this-season" noun="פריטים במפה" seasonName={current.name} />}
          />
        )}
      />
      {query.plot ? (
        <PlotDrawer
          seasonId={current.id}
          seasonName={current.name}
          plan={{ id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm, northDeg: plan.northDeg, notes: plan.notes }}
          items={items}
          closeHref={closeHref}
        />
      ) : null}
    </main>
  );
}
```

In `src/app/(admin)/site/actions.ts` (as plan 01 Task 7 left it):

1. Delete the line `import type { SiteItemKind } from '@/db/schema/site';`.
2. In the import from `'@/lib/site/plan'`, delete `addItem`, `removeItem`, `updateItem` and `type ItemPatch`, keeping the rest of the names as they are.
3. Delete the three functions `addItemAction`, `updateItemAction` and `removeItemAction`, each with the doc comment above it — the block that starts at `/** Returns the new item's id so the board can select what it just dropped. */` and ends with `removeItemAction`'s closing `}`.

Nothing else in `actions.ts` changes: `createPlanAction`, `setPlotAction`, `copyPlanAction`, `saveSiteChangesAction` and `loadSiteDocAction` stay exactly as they are. `tsc` and eslint's unused-import rule check that nothing now unused was left behind.

Replace the whole of `src/app/(admin)/site/site.module.css` with:

```css
/* Tokens only, logical properties throughout (A10). The kit components carry
   their own modules; nothing below restyles one. The editor's own styles
   are in `editor/editor.module.css`. */

.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-block-size: 0;
}

/* The editor's page: the whole panel, no reading measure and no padding —
   the scene is the page (spec §10). Beats the global `main` rule by class. */
.editorPage {
  flex: 1;
  min-block-size: 0;
  display: flex;
  flex-direction: column;
  max-inline-size: none;
  margin: 0;
  padding: 0;
}

.invitations {
  display: flex;
  justify-content: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

/* ---- drawers --------------------------------------------------------- */

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

/* The kit ships no number control (`TextInput` hard-codes type="text"), so
   a metre box is a plain input drawn to the same metrics. 16px so iOS does
   not zoom the page on focus. */
.plainInput {
  inline-size: 100%;
  min-block-size: var(--control-h);
  padding-inline: var(--space-3);
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--panel);
  color: var(--ink);
  font-size: var(--input-font-phone);
}

.formError {
  margin: 0;
  color: var(--bad);
  font-size: var(--text-meta);
}

.preview {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-meta);
}

/* ---- the table's two-line cell --------------------------------------- */

.title {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  line-height: var(--leading-cell);
}

.pills {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

@media (max-width: 768px) {
  .pair { grid-template-columns: 1fr; }
  .plainInput { min-block-size: var(--tap-min); }
}
```

Replace the whole of `src/app/(admin)/site/loading.tsx` with:

```tsx
import { SkeletonPage, SkeletonTable, SkeletonText } from '@/components/ui/skeleton';

/**
 * E3. What /site shows while its queries run: a line for the tool row, then
 * the item table — the view a phone and a browser without WebGL get, and the
 * one shape of this page a skeleton can honestly draw. The four stat tiles
 * retired with the board (spec §12). No figure is drawn, not even a zero.
 */
export default function SiteLoading() {
  return (
    <SkeletonPage label="טוען את מפת הקאמפ…">
      <SkeletonText lines={1} />
      <SkeletonTable rows={6} columns={7} />
    </SkeletonPage>
  );
}
```

- [ ] **Step 5: Retire the board, the item drawer and the remove page**

```bash
git rm "src/app/(admin)/site/site-board.tsx" "src/app/(admin)/site/site-board.test.tsx" \
  "src/app/(admin)/site/item-drawer.tsx" "src/app/(admin)/site/remove-item.tsx"
```

Run Step 1's command again. Expected: `files naming a retired thing: 0` and `outside the camp map: 0`. (`plan.test.ts` still calls `addItem`, `updateItem` and `removeItem` — the library functions stay; the pattern names only the retired actions, hrefs and files.)

- [ ] **Step 6: Run the camp map's tests, the guards, typecheck and lint**

Run: `npx vitest run "src/app/(admin)/site" src/lib/site "src/app/(admin)/copy-sweep.test.tsx" "src/app/(admin)/a11y-sweep.test.tsx" "src/app/(admin)/empty-states.test.tsx" "src/app/(admin)/route-modules.test.ts" src/app/use-server-exports.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: every file passes, exit 0. In particular: `views.test.ts` 4; `page.test.tsx` 12; `site-editor.test.tsx` 40 (37 + 3); `site-editor.no-webgl.test.tsx` 1; no `site-board.test.tsx` any more; the `'use server'` export guard; E1 (the table still has its `empty`), E3 (a `loading.tsx` still exists), and both sweeps. Read the JSON's `numFailedTests` and compare with the exit code — a non-zero exit with 0 failures means dead workers, not green.

Run: `npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site" src/lib/site` — expected no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/site/views.ts src/lib/site/views.test.ts \
  "src/app/(admin)/site/page.tsx" "src/app/(admin)/site/page.test.tsx" "src/app/(admin)/site/actions.ts" \
  "src/app/(admin)/site/site.module.css" "src/app/(admin)/site/loading.tsx" \
  "src/app/(admin)/site/editor/site-editor.tsx" "src/app/(admin)/site/editor/editor.module.css" \
  "src/app/(admin)/site/editor/site-editor.test.tsx" "src/app/(admin)/site/editor/site-editor.no-webgl.test.tsx"
git status --short
git commit -m "feat(site): the 3D editor is the camp map — the board, the item drawer and the remove page retire

The item table stays, as the view under 900 px and without WebGL. ?peek=
selects an item on load. PNG export of the current view.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(`git rm` staged the four deletions. Read `git status --short` first: only this task's paths.)

---

### Task 27: Verification and hand-off — the full suite, a browser, the collab docs, the PR body

**Files:**
- Modify: `docs/collab/claims.md` (the camp-map row of §3)
- Modify, only if `next dev` rewrote it: `AGENTS.md`
- Create, **not committed** (`/.superpowers/` is gitignored): `.superpowers/site-3d/pr-body.md` and the screenshots under `.superpowers/site-3d/`

**Interfaces:**
- Consumes: everything plans 01–04 built.
- Produces: the numbers the PR states, a browser check of every gesture in spec §8, and a PR body on disk. The PR itself is not opened here.

This task is the coordinator's: the full suite runs once, here, and nowhere else in this plan (`CLAUDE.md`: three lanes each running a full suite at once killed all three). The browser check never saves to the shared development database (overview, "Amendments recorded after plan 03"): writes are blocked in the browser before the map is opened, and the one flow that needs a real write — two tabs racing — runs only if the camp lead says yes.

- [ ] **Step 1: Make sure nobody else is mid-run**

```bash
pgrep -fl vitest
pgrep -fl "next build"
```

Expected: no output from either. If a run is going, wait for it to end (Monitor with an until-loop on `pgrep -fl vitest`); do not start a second. A mass red while another run is going is not evidence of anything.

- [ ] **Step 2: Run the full suite, once**

```bash
cd /Users/yarin/GitProjects/Shliff_Platform-lanes/site-3d
OUT=".vitest/json/run-$$-full.json"
npx vitest run --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile "$OUT"
echo "exit=$? report=$OUT"
```

(`timeout` 600000 on the Bash call; the suite takes minutes.) Write down the `exit=` value and the report path.

- [ ] **Step 3: Read the verdict with instruments the suite did not produce**

```bash
node -e "const r=require(require('path').resolve(process.argv[1]));console.log(JSON.stringify({total:r.numTotalTests,passed:r.numPassedTests,failed:r.numFailedTests,pending:r.numPendingTests,todo:r.numTodoTests,files:r.numTotalTestSuites,failedFiles:r.numFailedTestSuites}))" "<the report path from Step 2>"
node -e "const fs=require('fs'),p=require('path');let n=0;(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())w(f);else if(/\.test\.tsx?$/.test(e.name))n++;}})('src');console.log('test files on disk:',n)"
node -e "const fs=require('fs'),p=require('path');const hits=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())w(f);else if(/\.test\.tsx?$/.test(e.name)&&/\b(it|describe|test)\.(skip|todo)\(/.test(fs.readFileSync(f,'utf8')))hits.push(f);}})('src');console.log('files with a deliberate skip:',hits.length,hits.join(' '))"
```

The suite is green only if all of these hold:
1. `exit=0` **and** `failed: 0`. A non-zero exit with `failed: 0` means workers died (a `SIGKILL` under memory pressure is an "Unhandled Error", not a failure): read the console's `Unhandled Errors` block, check `pgrep -fl vitest`, and rerun Step 2 once when the box is quiet.
2. `files` equals `test files on disk`. Fewer means a file never ran.
3. `pending` equals the tests inside the files with a deliberate skip, and is `0` if there are none. Tests a killed worker never ran come back `pending`, not failed — 32 once did, with no `.skip` anywhere.

A failure is investigated, not labelled: rerun just that file with the capped command before calling it anything, and fix it test-first in the file that owns it. Keep the JSON line — its `total`, `passed` and `files` go into the PR body.

- [ ] **Step 4: Typecheck, lint and build, as CI does**

Run: `npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npm run lint` — expected no errors (CI runs exactly this).
Run: `npx next build` (after `pgrep -fl vitest` shows nothing) — expected exit 0, and in the route table `/site` marked `ƒ` (dynamic). CI runs the build too; a `'use server'` file that exports a non-function, or `ssr: false` outside a Client Component, is only caught here.

- [ ] **Step 5: The browser check's preconditions — stop if any fails**

These are plan 03 Task 20 Step 15's checks, unchanged; each one that fails is a **STOP and ask the camp lead**, never a fix:

1. `docker ps -a --filter name=shliff` — `shliff-pg` `Up`, publishing **5433**. Stopped or missing: STOP. It is stopped on purpose to relieve memory pressure; do not start it.
2. Migration `0012` in the local database (read-only):
   `docker exec shliff-pg psql -U shliff -d shliff -tAc "select count(*) from information_schema.columns where table_name in ('site_plans','site_items') and column_name in ('version','north_deg','height_cm','locked')"` — expected `4`. Anything else: STOP (applying it writes to the shared development database).
3. A season with a map (read-only):
   `docker exec shliff-pg psql -U shliff -d shliff -tAc "select s.id, s.name, s.starts_on, count(i.id) from site_plans p join seasons s on s.id = p.season_id left join site_items i on i.plan_id = p.id group by s.id, s.name, s.starts_on order by s.name"` — pick a season with items; call its id `<season>`. Note whether its `starts_on` is empty (the sun card then shows its invitation — that is a check too). None with items: STOP.
4. The worktree's `.env.local` exists (plan 03 Task 20 made it; `git check-ignore -v .env.local` names `.gitignore`). Never stage it.
5. A free port: `lsof -nP -iTCP:3000 -sTCP:LISTEN`; if anything answers, use 3001, then 3002… Start `npm run dev -- --port <port>` with the Bash tool's `run_in_background`, and poll `curl -s -o /dev/null -w '%{http_code}' http://localhost:<port>/signin` until it prints `200`.

- [ ] **Step 6: Load the browser tools, and have the camp lead sign in**

Load the Playwright MCP tools in one call: ToolSearch `select:mcp__plugin_playwright_playwright__browser_navigate,mcp__plugin_playwright_playwright__browser_snapshot,mcp__plugin_playwright_playwright__browser_click,mcp__plugin_playwright_playwright__browser_drag,mcp__plugin_playwright_playwright__browser_press_key,mcp__plugin_playwright_playwright__browser_take_screenshot,mcp__plugin_playwright_playwright__browser_console_messages,mcp__plugin_playwright_playwright__browser_run_code_unsafe,mcp__plugin_playwright_playwright__browser_evaluate,mcp__plugin_playwright_playwright__browser_resize,mcp__plugin_playwright_playwright__browser_tabs,mcp__plugin_playwright_playwright__browser_type,mcp__plugin_playwright_playwright__browser_handle_dialog`.

`browser_navigate` to `http://localhost:<port>/signin`, then **STOP and ask the camp lead** to sign in in that Playwright window, or for a local admin's credentials (typed with `browser_type`, submitted with `browser_click`). There is no development bypass, and `scripts/create-admin.ts` writes to the shared database — not without their go-ahead.

- [ ] **Step 7: Block every write before the map opens, and prove the block holds**

With `browser_run_code_unsafe`, pass as `code`:

```js
async (page) => {
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST' || !request.headers()['next-action']) return route.continue();
    let args = null;
    try { args = JSON.parse(request.postData() ?? ''); } catch { args = null; }
    // One string (or null) argument is a read: loadSiteDocAction(planId), the rail's counts.
    // Every write this page can make takes more, or an object: save, plot, create, copy.
    const read = Array.isArray(args) && args.length === 1 && (typeof args[0] === 'string' || args[0] === null);
    return read ? route.continue() : route.abort('failed');
  });
  return 'writes are blocked; reads pass';
}
```

`browser_navigate` to `http://localhost:<port>/site?season=<season>`, wait two seconds, `browser_snapshot`. Expected: the top bar with "כל השינויים נשמרו", "ייצוא תמונה" and "הגדרות המגרש"; the tool row; the side panel open on "הוספה למפה"; the inspector reading "המגרש" with "נרשם ידנית"; the checks bar; the view controls; the minimap.

**Positive control on the block, before anything else:** click the tab "במפה", then a row of a non-square item (it is selected and flies to the middle of the free area), press `r` with `browser_press_key`, wait two seconds, `browser_snapshot`. Expected: "לא נשמר —" with "ניסיון חוזר" in the top bar and, under it, "השמירה נכשלה, אולי אין חיבור. אפשר לנסות שוב." — the save was sent and blocked. If instead it reads "כל השינויים נשמרו", **the block did not hold and a write reached the database**: press `Meta+z` at once (the undo saves the inverse and puts the map back), stop, and tell the camp lead the plan's version moved by two.

From here on every edit shows "לא נשמר" — that is the block working, and the error banner's being on screen is itself one of the checks.

- [ ] **Step 8: Walk spec §8 — once in 3D and light, once in plan and dark**

Two ways to point at the map:
- **An item's middle:** click its row in "במפה" — `fitIds` flies it to the middle of the free area — then this gives the point (`browser_run_code_unsafe`):
  `async (page) => { const s = await page.getByRole('region', { name: 'מפת הקאמפ' }).boundingBox(); return { x: s.x + 316 + (s.width - 316 - 280) / 2, y: s.y + 56 + (s.height - 56 - 64) / 2 }; }`
  (316 and 280 are the inspector's and the side panel's insets, 56 and 64 the checks bar's and the view controls'.)
- **Bare ground:** the point 40 px inside the free area's bottom-left corner: `{ x: s.x + 316 + 40, y: s.y + s.height - 64 - 40 }`, checked bare in a screenshot first.

A drag is `async (page) => { await page.mouse.move(X, Y); await page.mouse.down(); await page.mouse.move(X + DX, Y + DY, { steps: 12 }); await page.mouse.up(); }` with the numbers filled in; hold a key around it with `page.keyboard.down('Shift')` … `page.keyboard.up('Shift')` (and `Alt`, `Control`), and a right-drag passes `{ button: 'right' }` to `down` and `up`. Take a screenshot (`browser_take_screenshot`, filename `site-3d-<n>-<what>.png`) wherever the expectation is visual.

Pass 1 — 3D (the opening view), light (`browser_evaluate`: `() => { document.documentElement.dataset.theme = 'light'; }`):

| # | Gesture (§8) | Expected |
|---|---|---|
| 1 | Click an item (its middle) | Its label is highlighted, the inspector shows its name and "נרשם ידנית", handles appear, the selection bar floats above it |
| 2 | Click another item's **label** | That item is selected |
| 3 | Shift + click a third item | "נבחרו 2 פריטים" in the inspector, chips per kind, one row per kind |
| 4 | Drag the selected item 120 px | It moves in steps of the grid; guides and gap readouts show during the drag (screenshot mid-drag: take it inside the code, `await page.screenshot({ path: '<scratchpad>/drag.png' })` before `up`); after the drop the position in the inspector is a multiple of the grid step |
| 5 | Alt + drag the same item 37 px | The new position is not a multiple of the grid step |
| 6 | Drag an east handle outward, then far inward past the west edge | Width grows in grid steps; pulled past the far edge it stops at 0.1 m |
| 7 | Drag bare ground | The view moves; no item moves; the zoom % is unchanged |
| 8 | Shift + drag bare ground over two items | A rectangle is drawn; both are selected |
| 9 | Right-drag (and Ctrl + drag) | The view orbits; the compass needle turns with it; no context menu |
| 10 | Wheel over an item, 5 notches in | The zoom % grows, and the item under the pointer stays under it |
| 11 | Double-click an item | The view flies to it |
| 12 | Lay out 4 toilets in a row (library, then several-items "סידור בשורה" with 0.5), zoom out with `-` until one label reads "4 תאי שירותים", click it | The view zooms until the four labels separate |
| 13 | Drag the "מקרר" tile from the library onto bare ground inside the fence, then another past the fence | A ghost follows the pointer and says its kind and size; past the fence it says "מחוץ לגדר"; each lands where dropped, selected, with the toast "הפריט מקרר … נוסף למפה" and "ביטול" |
| 14 | Click the "אוהל" tile | A tent lands at the free spot nearest the middle of the view |
| 15 | Click a shade net that is not selected, then drag across it | The click selects it; the drag pans the view and leaves the net where it was |
| 16 | Keys, on a selected item: `ArrowRight`, `Shift+ArrowUp`, `r`, `l`, `Delete`, `Meta+d`, `Meta+z`, `Meta+Shift+z`, `Meta+a`, `Escape`, `v`, `m`, `2`, `3`, `f`, `q`, `e`, `+`, `-`, `Shift+Slash` | One grid step right; a metre up the screen; a quarter turn about the middle; locked (a second `Delete` says "הפריט נעול…"); removed with a "ביטול" toast; a copy beside it; undo; redo; every visible item but nets selected; nothing selected; the select and measure tools; plan; 3D; fit; the view turns right, then left; zoom in and out; the shortcuts card |
| 17 | A Hebrew layout: `browser_evaluate` on the focused stage — `() => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ר', code: 'KeyR', bubbles: true })); }` | The selected item turns — the key's place, not its letter |
| 18 | The checks bar: press each chip twice | Each press selects the next case and flies to it |
| 19 | The minimap: click a corner of the plot in it, then drag in it | The view goes there, and follows the drag |
| 20 | The inspector: type `2,5` in רוחב + Enter; `abc` + Enter; lock the item and look at the boxes | The width is 2.5 m about the item's middle; "צריך מספר במטרים…" in Hebrew under the box; with the lock, רוחב, עומק, גובה, ממערב, מצפון are disabled |
| 21 | Several tents of two widths selected: the width box | Empty, with "מעורב"; "לשמור גם כברירת המחדל של אוהל" checked says the sizes differ and stores nothing |
| 22 | "צל לפי שעה" in the tool row; slide to 07:00, 12:00, 17:45 | With a gate date: shadows move and the card's counts change; without one: the invitation, and no sun |
| 23 | `browser_console_messages` with `level: "error"` | None. A `THREE` warning at `warning` level is noted, not a failure |

Pass 2 — plan (`2`), dark (`browser_evaluate`: `() => { document.documentElement.dataset.theme = 'dark'; }`): repeat rows 1–11, 13, 15, 16, 18 and 19. Also check by eye that the panels, the scene, the group swatches in the library and in the minimap, the selection bar (inverted) and the toasts all read in dark, and that a swatch's colour in a panel is the colour of its items in the scene.

In both passes, the map never mirrors: west is left, the align-west button moves items left.

- [ ] **Step 9: The other views**

1. **Narrow:** `browser_resize` to 820 × 900, `browser_snapshot`. Expected: the item table "הפריטים במפה" is the page; no tool row, no scene. Back to 1440 × 900.
2. **No WebGL:** open a new tab (`browser_tabs` with `action: "new"`), and in it, before navigating, `browser_run_code_unsafe` with `async (page) => { await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; }); }`, then re-run Step 7's block in that tab and navigate to the map. Expected: "המפה צריכה דפדפן עם גרפיקה תלת־ממדית פעילה." where the map would be, the item table under it, the top bar still saying "כל השינויים נשמרו". Close the tab.
3. **The picture:** `browser_run_code_unsafe` with `async (page) => { const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ייצוא תמונה' }).click()]); return file.suggestedFilename(); }`. Expected: `מפת הקאמפ <season name>.png`.
4. **The plot settings:** click "הגדרות המגרש". Expected: the drawer "הגדרות המגרש" with "כיוון הצפון"; type `400` and press "שמירה": "כיוון הצפון נמדד במעלות שלמות, מ־0 עד 359" and nothing is sent. Close it with "ביטול" — do not save (the block would refuse it anyway).

- [ ] **Step 10: The conflict banner — only with the camp lead's yes**

The two-tab race needs two real saves. **Ask the camp lead** whether this one flow may write to the development database.

- **Yes:** open a second tab without the block (a new `page` has no route), open the same map in both. In tab B move an item and wait for "כל השינויים נשמרו". In tab A (the block lifted: `browser_run_code_unsafe` with `async (page) => { await page.unrouteAll(); }`) move a different item. Expected in tab A: "המפה שונתה ממקום אחר מאז שנפתחה. השינויים האחרונים שלך עוד לא נשמרו." with "טעינת הגרסה העדכנית" and "שמירת השינויים שלי מעליה". Press "שמירת השינויים שלי מעליה": "כל השינויים נשמרו", and reloading tab B shows both moves. Repeat with a fresh race and "טעינת הגרסה העדכנית": tab A shows tab B's map and its own move is gone. Then undo every move in both tabs (`Meta+z` until the undo button is disabled) so the map is as it was, and say so in the PR body.
- **No:** do not run it. The PR body says the conflict path is covered by `site-editor.test.tsx` ("turns a stale version into a choice…", "resends my changes over the new version…", "a plot saved in the drawer…") and by `plan.test.ts` against pglite ("answers a stale version with the current one and writes nothing"), and was not exercised in a browser.

- [ ] **Step 11: Leave everything as it was found**

1. In the blocked tab, press "טעינת הגרסה העדכנית" (a read, which the block lets through): every unsaved edit of the walk is dropped and the map is the database's again. Expected: "כל השינויים נשמרו", and the minimap shows the map as it was at Step 7.
2. Close the browser (`browser_close` if loaded, else leave the tab), stop the dev server (the background task's stop, or `kill` the pid `lsof -nP -iTCP:<port> -sTCP:LISTEN` names).
3. Copy the screenshots the MCP saved (its replies name their paths) into `.superpowers/site-3d/`.
4. `git status --short`. If `AGENTS.md` is modified, it is the Next.js block `next dev` regenerates (`CLAUDE.md`, "Traps"):

```bash
git add AGENTS.md
git commit -m "chore: AGENTS.md's Next.js block as next dev writes it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Nothing else may be uncommitted: `.env.local` and `.superpowers/` are ignored, `.vitest/json/` holds only run reports.

- [ ] **Step 12: Say what is in flight — `docs/collab/claims.md`**

Read `docs/collab/claims.md`, and §1 of it first (it is built to be checked). In §3, replace the whole row that begins `| @Yarin-Shitrit | Camp map (מפת הקאמפ) | \`feat/site-map-3d\`` with the row below, putting in the two numbers from Step 3's JSON line and today's date:

```
| @Yarin-Shitrit | Camp map (מפת הקאמפ) | `feat/site-map-3d` | **ready for review** — the 3D editor (spec `docs/superpowers/specs/2026-09-24-site-map-3d-editor-design.md`, plans `2026-09-24-site-3d-00…04`) is `/site`; the SVG board, the item drawer and the remove page are retired, the item table stays as the narrow-screen and no-WebGL view. Full suite <total> tests in <files> files, 0 failed. Touches shared surfaces: `package.json` + `package-lock.json` (`three`, the R1 exception in `ownership.md`), migration **`0012`** (generated, **not applied to Railway** — the camp lead's step, `docs/deploy.md` §6), this file and `ownership.md`. PR not yet opened; review goes to @josefcohen96 | <today> |
```

Bump the `**updated: …**` stamp at the top to today. Then:

```bash
git add docs/collab/claims.md
git commit -m "docs(collab): the camp map's 3D editor is ready for review

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 13: Write the PR body to a file**

Create `.superpowers/site-3d/pr-body.md` (gitignored; the camp lead opens the PR). Fill every `<…>` from this task's own output — Step 3's JSON line, Step 8–10's results — never from memory:

```markdown
## What this does

The camp map (`/site`) becomes a 3D editor: one scene seen from above (plan) or in 3D, edited in both. Edits show at once and save in the background in versioned batches; a conflict between two leads is a choice on screen, never an overwrite. Labels never overlap. Several items are sized together, per kind, with מעורב where they differ, and a size can become the kind's default. Shade by hour shows where the nets' shade falls at a chosen hour of the gate day.

Spec: `docs/superpowers/specs/2026-09-24-site-map-3d-editor-design.md`. Plans: `docs/superpowers/plans/2026-09-24-site-3d-00-overview.md` … `-04-panels-page.md`.

## Retired

`site-board.tsx` (+ test), `item-drawer.tsx`, `remove-item.tsx`, `REMOVE_ACT` / `removeItemHref`, `addItemAction` / `updateItemAction` / `removeItemAction`, the four stat tiles and the outside banner. Nothing outside `src/app/(admin)/site/**` and `src/lib/site/**` used them (checked with a comment-stripping scan before deleting). `addItem` / `updateItem` / `removeItem` stay in `plan.ts` — `plan.test.ts` uses them.

## Shared surfaces touched

- `package.json`, `package-lock.json` — `three@0.186.1` and `@types/three@0.186.0`, pinned. The camp lead's exception to ruling R1 (spec D1), recorded in the `package.json` row of `docs/collab/ownership.md` in this PR; `three` is imported only under `src/app/(admin)/site/editor/scene/`, enforced by `site/editor/three-guard.test.ts`.
- `drizzle/0012_site_3d_editor.sql`, `drizzle/meta/0012_snapshot.json`, `drizzle/meta/_journal.json` — the shared migration sequence. **Not applied to Railway**: that is the camp lead's manual step (`docs/deploy.md` §6), and `/site` needs it before this deploys.
- `docs/collab/claims.md` — the camp-map row.
- `docs/collab/ownership.md` — the `package.json` row records the R1 exception.

## Tests

Full suite, capped (`--maxWorkers=4`): **<total> tests in <files> files, <passed> passed, 0 failed, <pending> pending** (`exit=0`; files run = test files on disk). `npx tsc --noEmit` clean, `npm run lint` clean, `next build` green with `/site` dynamic.

## Checked in a browser

Local dev server against the development database, with every write blocked in the browser (reads only), signed in by the camp lead: every gesture in spec §8 in 3D and light, and again in plan and dark; the keyboard by key position (a Hebrew-layout `KeyR` turns an item); library drag and click; the inspector's three states, a typed `2,5`, a refused `abc`, a lock disabling size and place; מעורב; the checks bar, minimap, view controls, selection bar, shortcuts card; toasts with ביטול; shade by hour <with the gate date / as an invitation — say which>; the narrow-screen table; the no-WebGL notice with the table under it; PNG export. Console: <no errors / list>. Screenshots: `.superpowers/site-3d/` (not committed; ask for them).

Conflict banner: <exercised with two tabs, with the camp lead's approval, and both moves undone afterwards / not exercised in a browser — covered by `site-editor.test.tsx` and `plan.test.ts` (pglite)>.

## Before merging

- Apply `0012` to Railway (`docs/deploy.md` §6).
- Review from @josefcohen96 (shared surfaces above).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Read the file back once with the Read tool: every `<…>` must be gone.

---

## When Task 27 is done

`/site` is the 3D editor, the suite and the build are green with the numbers written down, every gesture in spec §8 was seen working in a browser in both views and both themes without a write reaching the shared database, `claims.md` says the work is ready for review, and the PR body is on disk for the camp lead to open the PR with.
