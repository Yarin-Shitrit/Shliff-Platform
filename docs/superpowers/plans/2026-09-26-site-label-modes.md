# מפת הקאמפ — three ways to label: floating, none, printed on the item — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Standing of this document (read first).** `src/app/(admin)/site/**` and
> `docs/superpowers/plans/**` are @Yarin-Shitrit's areas (`docs/collab/ownership.md`).
> This plan is written by @josefcohen96 as a change **proposed into** the camp
> map, with the same standing as #41 (item groups) and #42 (the sofa's facing):
> reviewed by @Yarin-Shitrit, never self-merged, and every edit it asks for is
> additive. It was drafted on 2026-09-26 while `feat/site-item-groups` (saved
> plans, migration `0018`) was still uncommitted in the working tree; **nothing
> in the tree was changed to write it.** Execute it only from a fresh branch off
> `origin/main` after that work lands — it edits `site-editor.tsx` and the
> editor's tests, which the saved-plans work also edits.

**Goal:** The tool row's "תוויות" switch becomes a three-way choice. *Floating* is what the map does today: a DOM label placed by `label-layout.ts`, never overlapping, grouped when crowded. *None* hides them. *Printed* draws each item's name onto the item itself — the number on a tent's roof slope, the caravan's name on its roof and long wall, the tank's name on its lid, the net's name on its cloth — as ink that is lit, shadowed and foreshortened with the surface, and that therefore also lands in the exported PNG.

**Architecture:** One new value on `EditorUi` (`labels: 'floating' | 'none' | 'printed'`, replacing the boolean) reaches the engine, which already re-syncs the scene and re-lays the labels when the UI key changes. *Where* a print goes is a pure module with no `three` in it (`src/lib/site/editor/prints.ts`: shape, size, facing and inset in, face rectangles in centimetres out). *How* it is drawn is two small files in the scene adapter: a rasteriser that turns a label into a white-ink alpha texture (`scene/print-texture.ts`, cached by text, one texture per distinct label, theme-independent) and a builder that lays a thin `THREE.PlaneGeometry` decal on each face (`scene/prints.ts`, `userData.part === 'print'`, click-through, casts no shadow, `polygonOffset` so it never fights the face under it). `SceneSync` applies and removes prints by a key of its own — the label text and the font epoch — so a rename re-prints without rebuilding geometry, and a rebuild (resize, turn) re-applies the same print. The ink colour is the material's `color`, set by `restyleItemObject` from a new palette entry, so a theme flip recolours without re-rasterising. No schema, no migration, no dependency, no server change.

**Tech Stack:** Next.js 16.3.4 (App Router), React 19.2.8, TypeScript (strict), `three@0.186.1` (already a dependency; imported only under `site/editor/scene/`), vitest 5 + Testing Library + jsdom (node environment by default; canvas 2D is **not** available in tests), CSS Modules on `src/app/tokens.css`.

**Spec:** `docs/superpowers/specs/2026-09-24-site-map-3d-editor-design.md` §7 (the scene), §9 (labels that never overlap), §10 (the tool row's toggles). This plan adds a third label style beside §9's; it changes nothing in §9's layout. The binding interface contract is `docs/superpowers/plans/2026-09-24-site-3d-00-overview.md`, which Task 1 amends first, by its own rule.

**Mock:** <https://claude.ai/artifact/UKzJUkrsV3DFjFnoC4qodf> — the Burn 26 model with the three-way switch (מרחפות · בלי · מודפסות על הפריט). Its rules for which face carries the print, how large, and which way it reads are the ones below; its Hebrew copy for the three modes is the tool row's. The mock bakes the ink into the face's own texture; production lays a decal instead (Task 4 says why — the dark theme), and the two are indistinguishable on screen.

## Global Constraints

Every task's requirements include these. Copied from the spec, `CLAUDE.md` and the rulings the earlier site plans were given.

- **Additive.** `EditorUi.labels` changes type (boolean → union) and that is the one non-additive edit; it is inside the camp map area and reaches no other area (`grep -rn "labels:" src --include=*.tsx --include=*.ts` outside `site/` finds `src/lib/site/labels.ts`, an unrelated module, and nothing else). Nothing is removed or renamed that another area consumes. No shared surface is touched: no schema, no migration, no `package.json`, no `src/components/ui/**`, no `hebrew.ts`.
- **`three` is imported only** under `src/app/(admin)/site/editor/scene/**` (`three-guard.test.ts`). The face-placement module in `src/lib/site/editor/` never imports `three`, React or the DOM.
- **Tests run without a GPU and without canvas 2D.** `document.createElement('canvas').getContext('2d')` is `null` under jsdom and `document` is undefined in the node environment. The rasteriser returns `null` where it cannot draw and everything above it tolerates that: the item is still built, the mode still switches, nothing throws. Every scene test injects a fake rasteriser.
- **Hebrew only on screen.** The three mode names, the tool row's group name and the export toast are Hebrew; no English string reaches a rendered element. Gender-neutral: "מרחפות", "בלי", "מודפסות" describe labels, not people.
- **Units:** every length in the pure module is whole centimetres (`Math.round` on outputs); three's metres appear only inside `scene/`. x grows east, y south, z up; three is (x, z, y) · 0.01 (`meshes.ts`, `worldOf`). The map **never mirrors for RTL**, and neither does a print: a top-face print has its top edge north and reads from the south; a west-wall print reads from the west.
- **A print never decides anything.** It is drawn from `item.label` and only `item.label`: no size suffix (§9.7), no grouping (§9.4), no issue mark — problems stay what they are today, a tint on the body and a flag in the checks bar.
- **Colours** come from `scene/palette.ts` (scoped data, like the rest of the scene's) — one new entry, `ink`, in both themes. Nothing in `tokens.css` changes.
- **Tests** run with the capped command, always with a unique output file:
  `npx vitest run <paths> --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`.
  A non-zero exit with zero failures means workers died, not green. Run only your task's paths; the full suite is the coordinator's (Task 7 runs the site scope).
- **Typecheck** with `npx tsc --noEmit`; **lint** with `npx eslint <paths>` (on the Windows laptop there is no `rtk`; on the lead's machine use `rtk proxy npx eslint`).
- **Read files with the Read tool, not `cat`** where the RTK hook is installed.

## Review Focus

Inputs and conditions no feature test would naturally hit. Each has its test in the named task.

1. **A rename while printed.** Editing the label in the inspector must re-print the item without rebuilding its geometry: `geometryKey` does not contain the label, and `SceneSync` keeps a separate print key. The object identity in the scene is the same before and after. → Task 5, `scene-sync.prints.test.ts` "re-prints a renamed item on the same object".
2. **The web font arrives after the first frame.** Labels are measured again today (`engine.remeasure`); prints must be rasterised again, once, and not on every frame. → Task 5, "re-rasterises once when the font epoch changes".
3. **No canvas 2D** (jsdom, a headless browser, a tab with canvas blocked). The rasteriser returns `null`; the item is built without a print; switching modes throws nothing. → Task 2 (`print-texture.test.ts` "returns null without a 2D context") and Task 4 (`prints.test.ts` "places nothing when the rasteriser has nothing").
4. **A turned tent and a turned sofa.** A tent whose ridge runs north–south (`widthCm < depthCm`) prints on its **west** slope, reading from the west; a sofa's seat print keeps clear of the back for every `facing` 0–3. → Task 3, `prints.test.ts` (pure) "moves the tent's print to the west slope when the ridge turns" and "keeps the seat print off the back for every facing".
5. **A theme flip while printed.** The ink is recoloured by `restyleItemObject` (no rebuild, no new texture); the texture cache is not touched. → Task 4, `meshes.prints.test.ts` "recolours the ink on a restyle and keeps the texture".
6. **Two hundred items, mode switched on for the first time.** Prints are built when the mode is first turned on, not at load, and the switch back removes them and frees the planes but not the cached textures. Measured, not assumed: the sync with 200 labelled boxes and a fake rasteriser finishes under 20 ms in node. → Task 5, "builds prints only when asked, and drops them when not".
7. **The PNG export.** With floating labels the picture has no labels and the toast says so (today's copy). With prints the picture has them and the toast must not claim otherwise. → Task 6, `site-editor.test.tsx` "names what the exported picture carries".

## Where to work

- A fresh branch off `origin/main`, `feat/site-label-modes`, in its own worktree — the shared-index trap in `CLAUDE.md` applies, and on 2026-09-26 the main tree held an unfinished merge (`docs/collab/claims.md`, `docs/deploy.md`, `drizzle/meta/_journal.json` unmerged) plus the uncommitted saved-plans work.
- Start only after `feat/site-item-groups` (both commits: groups and saved plans) has merged, or rebase this plan's understanding of `site-editor.tsx` on what merged. `git diff --name-only feat/site-label-modes...origin/main` before every merge from `main`.
- Stage by path; never `git add -A`. Use `/usr/bin/git log` where the RTK hook is installed.

## Decisions taken here, and the ones left open

Taken, so the tasks are unambiguous:

- **D1 — one value, not two.** `EditorUi.labels` becomes `LabelMode = 'floating' | 'none' | 'printed'` rather than keeping the boolean and adding a style beside it. One truth, one control; the compiler finds every fixture (six test files list `labels: true`). The alternative — `labels: boolean` plus `labelStyle` — was rejected because two fields for one three-way control invites the fourth, meaningless state.
- **D2 — a decal, not a baked texture.** The mock paints the ink into the face's own texture. Production cannot: `MeshLambertMaterial.map` multiplies the material colour, so it can only darken, and the dark theme needs light ink on dark faces. A thin plane 1 cm off the face with `polygonOffset`, `receiveShadow`, no `castShadow`, `pick: false`, and the ink as the material's `color` over a white alpha mask gives the same picture in both themes and lets a restyle recolour it. The mock's earlier version was exactly this and looked the same.
- **D3 — which items print.** Every shape has a face: box → top; cylinder and fire → the cap; tent → the slope that faces south (or west, when the ridge runs north–south); sofa → the seat, clear of the back; net → the cloth, in a band 1 m inside its north edge (§9.1's reason: never over the lounge under it). A solid taller than 150 cm also prints on one wall: the west wall when it is deeper than it is wide (a caravan), else the south wall (a shower, a toilet, the kitchen). The mock tuned these; the numbers are in Task 3.
- **D4 — fit, do not clip.** A print is fitted inside a fraction of its face (top 86 % × 70 %; wall 84 % × 50 %; cap 72 % × 50 %; roof 80 % × 78 %; net 40 % × 20 %; seat 86 % × 70 % of the free seat), keeping the text's own proportions. A 30 cm splitter therefore carries a 26 cm print — small, like a real stencil on a small box. There is no minimum and no "too small to print" rule: a print that is too small to read at this zoom is simply unreadable until zoomed, which is what §9.6 exists to avoid for floating labels and is the point of the printed style.
- **D5 — the ink.** `palette.ink`: light `#2B2622`, dark `#ECEEF2`. Constant under hover, selection and problems; the body's tint carries those. A selected item's floating label adds its size (§9.7); its print does not.
- **D6 — not saved.** Like the underlay's `shown`/`opacity` (D19) and today's `labels`, the mode is how this viewer looks at the map, lives in `EditorUi`, and starts at `'floating'` (the spec's opening state, "labels on") on every load.

Open, for the camp lead — answer before Task 6, none blocks Tasks 1–5:

- **Q1** Should the opening state stay `'floating'`, or become `'printed'` once it exists? (D6 assumes floating.)
- **Q2** Should a viewer's choice be remembered per browser (`localStorage`, like the mock)? Nothing else in the editor is, so D6 says no; it is a one-line follow-up if wanted.
- **Q3** Should the printed style get a key in `keyboard.ts`? None of the toggles has one today; this plan adds none.

## File map

| File | Task | Change |
|---|---|---|
| `docs/superpowers/plans/2026-09-24-site-3d-00-overview.md` | 1 | Interface contract: `LabelMode`, `EditorUi.labels`, `SyncInput.labelMode`, the two new scene files, the pure module |
| `src/app/(admin)/site/editor/scene/scene-view.tsx` | 1 | `export type LabelMode`; `EditorUi.labels: LabelMode` |
| `src/app/(admin)/site/editor/scene/engine.ts` | 1, 5 | `layoutLabels` gates on `=== 'floating'`; `syncScene` passes the mode and the print textures; `remeasure` bumps the font epoch |
| `src/app/(admin)/site/editor/panels/toolbar.tsx` (+ `.test.tsx`) | 1 | The `תוויות` toggle becomes a three-button `seg` |
| `src/app/(admin)/site/editor/site-editor.tsx` (+ tests) | 1, 6 | `INITIAL_UI.labels: 'floating'`; the export toast by mode |
| fixtures listing `labels: true` (compiler-driven sweep) | 1 | `toolbar.test.tsx`, `scene-view.test.tsx`, `site-editor*.test.tsx`, `underlay.scene.test.tsx` — whatever `tsc` names |
| `src/lib/site/editor/prints.ts` (+ `.test.ts`) | 3 | **New.** Pure: `printFaces(...)` → face rectangles in cm |
| `src/app/(admin)/site/editor/scene/print-texture.ts` (+ `.test.ts`) | 2 | **New.** The rasteriser and its cache |
| `src/app/(admin)/site/editor/scene/prints.ts` (+ `.test.ts`) | 4 | **New.** `applyPrints`, `clearPrints`: faces + textures → decal planes on the item's group |
| `src/app/(admin)/site/editor/scene/palette.ts` | 4 | `ink` in both themes |
| `src/app/(admin)/site/editor/scene/meshes.ts` (+ `meshes.prints.test.ts`) | 4 | `Part` gains `'print'`; `restyleItemObject` colours it; `disposeObject` skips shared textures |
| `src/app/(admin)/site/editor/scene/scene-sync.ts` (+ `scene-sync.prints.test.ts`) | 5 | `SyncInput.labelMode`, `SyncInput.prints`; a print key per item |
| `docs/superpowers/specs/2026-09-24-site-map-3d-editor-design.md` | 6 | §9 gains a closing paragraph, §10's toggle list names the three modes |
| `docs/collab/claims.md` | 7 | One row for this work; `updated:` stamp |

---

### Task 1: The mode exists end to end — type, contract, tool row, engine gate

**Files:**
- Modify: `docs/superpowers/plans/2026-09-24-site-3d-00-overview.md` (Interface contract — before any code, by its own rule)
- Modify: `src/app/(admin)/site/editor/scene/scene-view.tsx` (`LabelMode`, `EditorUi`)
- Modify: `src/app/(admin)/site/editor/scene/engine.ts` (`layoutLabels`)
- Modify: `src/app/(admin)/site/editor/panels/toolbar.tsx`, `toolbar.test.tsx`
- Modify: `src/app/(admin)/site/editor/site-editor.tsx` (`INITIAL_UI`)
- Modify (sweep, compiler-driven): every fixture with `labels: true` / `labels: false`

**Interfaces:**
- Produces: `export type LabelMode = 'floating' | 'none' | 'printed';` and `EditorUi.labels: LabelMode` in `scene-view.tsx`.
- Contract text to add under "Scene adapter" in the overview:

```ts
// scene-view.tsx — Task 1 of 2026-09-26-site-label-modes
export type LabelMode = 'floating' | 'none' | 'printed';
// EditorUi.labels: LabelMode   ('floating' = §9's DOM labels; 'printed' = the item's name on its faces, Tasks 2–5)
```

- [ ] **Step 1: Amend the contract** — the block above, plus placeholders for Tasks 2–5's exports (copy their "Produces" lines from this plan verbatim).

- [ ] **Step 2: Write the failing toolbar test.** In `toolbar.test.tsx`, replace the `תוויות` toggle expectation with:

```tsx
it('offers the three label modes as one group, pressed by the current one', () => {
  const onUi = vi.fn();
  render(<Toolbar ui={{ ...UI, labels: 'printed' }} onUi={onUi} canUndo={false} canRedo={false} onUndo={noop} onRedo={noop} />);
  const group = screen.getByRole('group', { name: 'תוויות' });
  const buttons = within(group).getAllByRole('button');
  expect(buttons.map((b) => b.textContent?.trim())).toEqual(['מרחפות', 'בלי', 'מודפסות']);
  expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
  fireEvent.click(buttons[1]);
  expect(onUi).toHaveBeenCalledWith({ labels: 'none' });
});
```

- [ ] **Step 3: Make it pass.** In `toolbar.tsx`, replace the single toggle with a `seg` group in the same style as תוכנית/תלת־ממד:

```tsx
<div className={styles.seg} role="group" aria-label="תוויות">
  {([['floating', 'מרחפות'], ['none', 'בלי'], ['printed', 'מודפסות']] as const).map(([mode, name]) => (
    <button key={mode} type="button" className={styles.segButton} aria-pressed={ui.labels === mode} onClick={() => { onUi({ labels: mode }); }}>
      {mode === 'floating' ? <EditorIcon name="tag" size={14} /> : null}
      {name}
    </button>
  ))}
</div>
```

  (The tag icon stays on the first button so the group is still recognisable as the labels control at a glance; no new icon is added.)

- [ ] **Step 4: The engine's gate.** In `engine.ts` `layoutLabels`, `if (!ui.labels || this.cam === null)` becomes `if (ui.labels !== 'floating' || this.cam === null)`. `uiKey` already joins `ui.labels`, so the string value keeps the dirty-marking as is.

- [ ] **Step 5: `INITIAL_UI.labels: 'floating'`** and the sweep: run `npx tsc --noEmit` and fix every fixture it names (`labels: true` → `'floating'`, `labels: false` → `'none'`). Do not touch a fixture the compiler did not name.

- [ ] **Step 6: Run** `toolbar.test.tsx`, `scene-view.test.tsx`, `site-editor.test.tsx`, `three-guard.test.ts` with the capped command; `npx tsc --noEmit`; lint the touched files. Commit: `feat(site): the labels switch has three positions — floating, none, printed (printed draws nothing yet)`.

---

### Task 2: `print-texture.ts` — a label as white ink on a clear texture

**Files:**
- Create: `src/app/(admin)/site/editor/scene/print-texture.ts`, `print-texture.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Print { texture: THREE.Texture; /** width ÷ height of the drawn text block */ aspect: number }
export interface PrintRasteriser {
  /** The same text gives the same Print until reset(); null where nothing can be drawn (no canvas 2D). */
  print(text: string): Print | null;
  /** The font changed (document.fonts.ready): forget every texture so the next print() draws afresh. */
  reset(): void;
  dispose(): void;
  /** How many textures are held — for tests and the 200-item measurement. */
  readonly size: number;
}
export function canvasRasteriser(font: () => string, maxAnisotropy: number): PrintRasteriser;
```

- The texture is **white ink on transparent**: `ctx.fillStyle = '#FFFFFF'`, `direction = 'rtl'`, `textAlign = 'center'`, `textBaseline = 'middle'`, 128 px tall, width from `measureText` plus 20 px of padding each side, weight 700, the family from `font()` (the engine already reads the stage's computed font for `this.text.font`; pass that). `texture.anisotropy = maxAnisotropy`, `texture.colorSpace = THREE.SRGBColorSpace` is **not** set (an alpha mask has no colour). One texture per distinct text, held in a `Map`; `reset()` disposes and clears; `dispose()` the same.
- Returns `null` when `document` is undefined or `getContext('2d')` is `null` — and caches the null too, so a blocked canvas is asked once, not per item per frame.

- [ ] **Step 1: Tests** (`// @vitest-environment jsdom` at the top): "returns null without a 2D context" (jsdom's canvas has none — assert `print('אוהל 1')` is `null` and `size` is `0`); "gives one texture per text" using a stubbed `HTMLCanvasElement.prototype.getContext` that returns a minimal fake 2D context (`measureText` → `{ width: text.length * 60 }`, `fillText`, `fillRect`, `save`, `restore`, `translate`, `scale`, `rotate` as no-ops) — assert `print(a) === print(a)`, `print(a) !== print(b)`, `aspect` ≈ (width + 40) / 128, `size` counts distinct texts; "forgets everything on reset" (the fake's `fillText` spy is called again after `reset()`).

- [ ] **Step 2: Implement** as specified; `THREE.CanvasTexture(canvas)`; `texture.needsUpdate = true` once.

- [ ] **Step 3: Run** the file and `three-guard.test.ts`; commit: `feat(site): a label rasterised once as ink, cached by its text`.

---

### Task 3: `src/lib/site/editor/prints.ts` — where a print goes, in centimetres, with no `three`

**Files:**
- Create: `src/lib/site/editor/prints.ts`, `prints.test.ts`

**Interfaces:**
- Produces:

```ts
export type PrintFace = 'top' | 'cap' | 'seat' | 'cloth' | 'roofSouth' | 'roofWest' | 'wallSouth' | 'wallWest';
export interface PrintSpot {
  face: PrintFace;
  /** Centre of the printable rectangle, map cm from the item's north-west ground corner (x east, y south, z up). */
  xCm: number; yCm: number; zCm: number;
  /** The rectangle's extent along the reading direction and across it, cm; the print is fitted inside `fracW × fracH` of it. */
  widthCm: number; heightCm: number;
  fracW: number; fracH: number;
  /** Tilt of the face from horizontal, degrees, toward the reader: 0 for a top, 90 for a wall, the roof's pitch for a slope. */
  tiltDeg: number;
  /** Where a reader stands to read it upright: south of it (text top to the north / up the slope / up the wall) or west of it. */
  readFrom: 'south' | 'west';
}
export function printSpots(shape: SiteKindShape, widthCm: number, depthCm: number, heightCm: number, facing: number, insetCm: number | null): PrintSpot[];
/** The print's own size on a spot: fitted by D4, keeping `aspect` (width ÷ height). Whole centimetres. */
export function fitPrint(spot: PrintSpot, aspect: number): { widthCm: number; heightCm: number };
```

- The rules (D3, D4), per shape:
  - `box`: `top` at `z = h`, centre `(w/2, d/2)`, extent `(w, d)`, `readFrom: 'south'` — except when `d > 1.5·w`, then extent `(d, w)` and `readFrom: 'west'` (the text runs along the long side). Plus, when `h ≥ 150`: `wallWest` at `x = 0`, centre `(0, d/2, h/2)`, extent `(d, h)`, `tiltDeg: 90`, `readFrom: 'west'` when `d > w`; else `wallSouth` at `y = d`, centre `(w/2, d, h/2)`, extent `(w, h)`, `tiltDeg: 90`, `readFrom: 'south'`.
  - `cylinder`, `fire`: `cap` at `z = h`, extent `(w, d)`, `fracW 0.72, fracH 0.5`.
  - `sofa`: `seat` at `z = h·0.5`, the seat rectangle minus the back's slab on the facing edge (`thick = max(15, 26 % of the side the back runs along)` — the same rule as `meshes.ts`'s `sofaBack`: north at 0, then east, south, west), `readFrom: 'south'`.
  - `tent`: when `w ≥ d`, `roofSouth`: the slope from the eave `(y = d, z = h/2)` to the ridge `(y = d/2, z = h)`; centre at the slope's middle; extent `(w, slopeLength)` with `slopeLength = hypot(d/2, h/2)`; `tiltDeg = atan2(h/2, d/2)`; `readFrom: 'south'`; `fracW 0.8, fracH 0.78`. When `w < d`, `roofWest`: the slope from `(x = 0, z = h/2)` to `(x = w/2, z = h)`; extent `(d, hypot(w/2, h/2))`; `readFrom: 'west'`.
  - `net`: `cloth` at `z = h`, centre `(w/2, min(100, d/4))` from the north edge, extent `(w, d)`, `fracW 0.4, fracH 0.2`, `readFrom: 'south'`. (`insetCm` is accepted for symmetry and unused: the band is by the edge, not the strip.)
  - `fitPrint`: `wCm = min(fracW·widthCm, aspect·fracH·heightCm)`, `hCm = wCm / aspect`, both rounded.

- [ ] **Step 1: Tests.** Numbers, not shapes: a 700 × 250 × 270 caravan → `top` reading from the west with extent `(700, 250)` and `wallWest` centred `(0, 125, 135)`; a 100 × 100 × 210 shower → `top` + `wallSouth`; a 180 × 80 × 75 table → `top` only; a 300 × 300 × 200 tent → `roofSouth` centred `(150, 225, 150)`, `tiltDeg ≈ 33.69`; the same tent as 200 × 300 → `roofWest` (Review Focus #4); a sofa 200 × 90 × 80 at each facing 0–3 → one `seat` at `z = 40` whose rectangle does not intersect the back's slab (compute the slab from the same rule and assert no overlap); a 120 × 120 × 130 water tank → `cap`; an 800 × 800 × 300 net → `cloth` centred `(400, 100, 300)`; `fitPrint` on the caravan's top with aspect 4 → `(602, 150)`; on the shower's south wall with aspect 3 → `(84, 28)`.

- [ ] **Step 2: Implement**, then run the file, `npx tsc --noEmit`, lint. Commit: `feat(site): where a name is printed on each shape, in centimetres`.

---

### Task 4: `scene/prints.ts` — the decal on the face; the ink in the palette and the restyle

**Files:**
- Create: `src/app/(admin)/site/editor/scene/prints.ts`, `prints.test.ts`
- Modify: `src/app/(admin)/site/editor/scene/palette.ts` (`ink`), `meshes.ts` (`Part`, `restyleItemObject`, `disposeObject`)
- Create: `src/app/(admin)/site/editor/scene/meshes.prints.test.ts`

**Interfaces:**
- Produces:

```ts
// scene/prints.ts
/** Lays one decal per spot on the item's group; the texture is the rasteriser's, shared, and never disposed here. Nothing is added when the rasteriser returns null. */
export function applyPrints(object: THREE.Group, label: string, spots: readonly PrintSpot[], rasteriser: PrintRasteriser, look: ItemLook): void;
/** Removes every `print` part and frees its geometry and material (not its texture). */
export function clearPrints(object: THREE.Group): void;
// palette.ts
//   ScenePalette.ink: string   — light '#2B2622', dark '#ECEEF2'
// meshes.ts
//   type Part gains 'print'; restyleItemObject: case 'print': material.color.set(palette.ink)
//   disposeObject: a material whose `map` came from the rasteriser is disposed, its map is not (userData.sharedMap === true on the print's material)
```

- The decal: `new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), new THREE.MeshLambertMaterial({ map, transparent: true, alphaTest: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))`, `receiveShadow = true`, `castShadow = false`, tagged `part: 'print'`, `pick: false`, `renderOrder = 1`. Placed 1 cm off the face along its normal. Orientation, from a plane that starts vertical facing +Z (south) with its text top up:
  - `tiltDeg 0`, `readFrom 'south'`: `rotation.x = -π/2` (lying flat, text top to the north).
  - `tiltDeg 0`, `readFrom 'west'`: the same, then `rotation.y = -π/2` (text top to the east; a reader west of it sees it upright).
  - `tiltDeg 90`, `readFrom 'south'`: no rotation (the south wall). `readFrom 'west'`: `rotation.y = -π/2` (faces −X).
  - a roof slope, `readFrom 'south'`: `rotation.x = -(π/2 − tilt)`; `readFrom 'west'`: `rotation.z = π/2 − tilt` after `rotation.y = -π/2` — use a parent `THREE.Group` per decal so the two rotations compose in that order.
  - All of it is a lookup from `PrintSpot`, so the orientation is tested by the resulting world normal and up vector, not by reading Euler angles.

- [ ] **Step 1: Tests** (`prints.test.ts`, node, a fake rasteriser returning a `THREE.DataTexture` 4 × 1 with aspect 4): a caravan's top decal has world normal ≈ (0, 1, 0), lies at `y = 2.71`, and its local up maps to world +X (reads from the west); its wall decal has normal ≈ (−1, 0, 0) at `x = −0.01`; a tent's roof decal's normal is the south slope's `(0, cos φ, sin φ)` with `φ = atan2(1, 1.5)`; every decal has `castShadow === false`, `userData.pick === false`, `userData.part === 'print'`; the decal's `PlaneGeometry` parameters equal `fitPrint(spot, 4)` in metres; `clearPrints` leaves no `print` part and calls `dispose` on the geometry and the material but **not** on the texture (spy); a rasteriser returning `null` adds nothing and throws nothing (Review Focus #3).
- [ ] **Step 2: `meshes.prints.test.ts`:** build a tent, apply a print, `restyleItemObject(object, { theme: 'dark', … })` → the print material's colour equals `SCENE_PALETTE.dark.ink` and its `map` is the same object as before (Review Focus #5); `disposeObject` on the group does not dispose the shared map.
- [ ] **Step 3: Implement**; run both files with `meshes.test.ts` and `three-guard.test.ts`; `tsc`; lint. Commit: `feat(site): a name printed on the item's face, as ink the theme recolours`.

---

### Task 5: `SceneSync` applies prints by their own key; the engine feeds it

**Files:**
- Modify: `src/app/(admin)/site/editor/scene/scene-sync.ts`
- Create: `src/app/(admin)/site/editor/scene/scene-sync.prints.test.ts`
- Modify: `src/app/(admin)/site/editor/scene/engine.ts` (`syncScene`, `remeasure`, construction, `dispose`)

**Interfaces:**
- Produces: `SyncInput.labelMode: LabelMode` and `SyncInput.prints: PrintRasteriser | null` (null = draw no prints, whatever the mode; the engine passes null until the first `'printed'` so nothing is rasterised at load — Review Focus #6); `SyncInput.fontEpoch: number` (bumped by the engine's `remeasure`; part of the print key so every print is redrawn once after the font arrives — Review Focus #2).
- `SceneSync` keeps `private readonly printKeys = new Map<string, string>()`. Per shown item, after the build/restyle branch: `const printKey = input.labelMode === 'printed' && input.prints !== null ? `${drawn.label}|${input.fontEpoch}` : ''`. If the object was just built, or `printKeys.get(id) !== printKey`: `clearPrints(object)`, then if `printKey !== ''` `applyPrints(object, drawn.label, printSpots(shape, w, d, h, facing, inset), input.prints, look)`; `printKeys.set(id, printKey)`. `drop(id)` deletes the key. Geometry key is untouched (Review Focus #1).
- `restyleItemObject` already traverses the group, so a print built earlier is recoloured by the existing restyle branch — nothing more in `sync`.
- Engine: `this.prints: PrintRasteriser | null = null`; `syncScene` creates it lazily (`canvasRasteriser(() => this.font, this.renderer.capabilities.getMaxAnisotropy())`) the first time `ui.labels === 'printed'`; `remeasure()` calls `this.prints?.reset()` and `this.fontEpoch += 1` and marks `sceneDirty`; `dispose()` disposes it. `uiKey` already includes `ui.labels`, so a mode change re-syncs.

- [ ] **Step 1: Tests** (node, fake rasteriser counting `print()` calls): "adds a print to every shown item in printed mode and none in floating or none"; "builds prints only when asked, and drops them when not" — sync 200 boxes as `'floating'` → 0 calls; as `'printed'` → 200 calls and 200 `print` parts, timed under 20 ms; back to `'floating'` → 0 parts, textures still `size === 200`; "re-prints a renamed item on the same object" — the group instance is identical before and after, the print's material map changed; "re-rasterises once when the font epoch changes" — the counter grows by the item count exactly once; "re-applies the print after a resize rebuilds the item"; "a hidden group takes its prints with it" (the objects are dropped).
- [ ] **Step 2: Implement** in `scene-sync.ts` and `engine.ts`. In `scene-view.test.tsx` (jsdom, the engine mocked as today) add one expectation: the engine is asked to sync with `labelMode: 'printed'` when the prop says so.
- [ ] **Step 3: Run** `scene-sync.test.ts`, `scene-sync.prints.test.ts`, `scene-view.test.tsx`, `three-guard.test.ts`; `tsc`; lint. Commit: `feat(site): printed labels follow their items — renamed, resized, re-fonted, hidden`.

---

### Task 6: The export toast says what the picture carries; the spec says the style exists

**Files:**
- Modify: `src/app/(admin)/site/editor/site-editor.tsx` (`EXPORTED` → `exportedNotice(mode)`), `site-editor.test.tsx`
- Modify: `docs/superpowers/specs/2026-09-24-site-map-3d-editor-design.md` (§9 closing paragraph; §10 the toggles line)

**Interfaces:**
- `function exportedNotice(mode: LabelMode): string` — `'floating'` → today's `'התמונה נשמרה, בלי התוויות שעל המפה.'`; `'none'` → `'התמונה נשמרה.'`; `'printed'` → `'התמונה נשמרה, עם השמות המודפסים על הפריטים.'`.
- Spec §9, appended: *"A third style, **printed** (plan `2026-09-26-site-label-modes`), draws the item's own name on its faces as part of the scene and takes no part in this layout: it never groups, never adds the size, never moves, and is in the exported picture. The tool row chooses between floating, none and printed."* §10's toggles line: "toggles for labels" → "a three-way labels control (מרחפות / בלי / מודפסות)".

- [ ] **Step 1: Test** in `site-editor.test.tsx` beside the existing export test: with `labels` set to `'printed'` through the tool row, the toast after export reads the printed sentence (Review Focus #7); with `'none'`, the short one.
- [ ] **Step 2: Implement**; the spec edits; run `site-editor.test.tsx`; `tsc`; lint. Commit: `feat(site): the export toast names the labels the picture carries`.

---

### Task 7: Verification and hand-off — the site scope, a browser, the claims row, the PR body

**Files:**
- Modify: `docs/collab/claims.md` (one row + the `updated:` stamp; nothing else in the file)

- [ ] **Step 1: The scoped run**, with a unique output file and the exit code cross-checked against the failure count: `src/app/(admin)/site`, `src/lib/site`, `src/test`. Record files, tests, failed, pending, exit code. Zero pending, or find out why.
- [ ] **Step 2: `npx tsc --noEmit`; lint every touched file.**
- [ ] **Step 3: In a browser** (`docker ps -a --filter name=shliff` first; `shliff-pg` on 5433 may be stopped on purpose — ask the camp lead before starting it): on ברן 26's map, switch מרחפות → בלי → מודפסות in 3D, plan and after a Q/E turn; both themes; rename a printed item in the inspector and watch it re-print; resize a tent through a handle; hover and select a printed item (body tints, ink does not); hide the sleep group and bring it back; export a PNG in each mode and read each toast; reload and confirm the opening state is Q1's answer. Note anything that reads wrong at the top of the PR body.
- [ ] **Step 4: `claims.md`** — the row: `@josefcohen96 | Camp map — three label styles | feat/site-label-modes | ready for review — proposed into @Yarin-Shitrit's area; no shared surface, no migration; scoped run N files / M tests / 0 failed; review goes to @Yarin-Shitrit, not self-merged | <date>`.
- [ ] **Step 5: Push; open the PR** with the body below; request review from @Yarin-Shitrit.

## PR body

```markdown
## What changed

The map's labels switch has three positions: floating (as before), none, and printed — the item's own name drawn on its roof, lid, cloth or wall as part of the scene, in both themes, and in the exported picture.

## Shared surfaces touched

none — every file is inside the camp map area (@Yarin-Shitrit's), proposed into it like #41 and #42. No schema, no migration, no dependency. Two of its documents are edited: the site-3d overview's interface contract (additive) and spec §9/§10 (a paragraph and a phrase).

## Verification

- `npx tsc --noEmit` → <result>
- scoped: `npx vitest run "src/app/(admin)/site" src/lib/site src/test --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"` → <N passed, 0 failed, 0 pending, in K files; exit 0>
- In a browser: <Task 7 Step 3, what was walked and what was seen>

## Open questions (answered before merge)

- Q1 opening state — <answer>
- Q2 remembered per browser — <answer>
- Q3 a key — <answer>

## Claims

`docs/collab/claims.md` gains one row for this branch; delete it when merged.
```
