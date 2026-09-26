# מפת הקאמפ, rebuilt: a 3D editor that is easy to operate

**Status:** approved 2026-09-24. Replaces the SVG board that `ad81bb2`
put on `/site`. The page, its URL and its data stay; the editor, the way it saves
and three of its files do not.

**Mock:** <https://claude.ai/artifact/JAXMTZecw7xQNBKWThVUSP> — six working
artboards (overview, one item, multi-selection, shade by hour, labels before and
after). Use it for layout, copy and behaviour. It draws with a hand-written
canvas projection; this spec does not (§3).

---

## 1. What this is for

The camp map is where the lead decides where every tent, caravan, shade net and
toilet goes this year. The board that shipped on `ad81bb2` works, but it is hard
to operate and it misbehaves:

- **It saves on every drag and then reloads the page's data.** Each drop is a
  server action followed by `router.refresh()`, and the board throws its working
  copy away whenever new rows arrive. A second drag started before the first
  round trip lands is overwritten by stale rows — the item jumps back.
- **Labels collide.** Every label is drawn at one font size in the middle of its
  item, so a 70 cm fridge carries a label wider than itself, and four toilet
  cabins in a row print four labels on top of each other.
- **It cannot be navigated.** No zoom, no pan, no undo, no multi-selection. A
  26 × 24 m plot is squeezed into the panel's width and small things are
  unclickable.

Success is checkable:

1. A lead can place, move, resize, turn, duplicate and remove items with the
   mouse or the keyboard, and undo any of it.
2. Nothing jumps. A change shows the moment it is made and is saved in the
   background; the screen always says whether everything is saved.
3. No two labels overlap, at any zoom, in either view.
4. The map can be looked at from above (plan) or in 3D, and edited in both.
5. Several items can be selected and sized together, per kind, and a size can be
   kept as that kind's default.
6. Two leads editing at once never silently overwrite each other (§6.4).
7. No new service, no special hardware: a browser with WebGL, which every
   supported desktop browser has.

## 2. Decisions already made

| # | Decision | By |
|---|---|---|
| D1 | **Libraries may be added; services and special hardware may not.** This is the camp lead's exception to ruling R1 (`docs/collab/ownership.md`, `package.json` row) for this feature. It admits `three` and `@types/three` — nothing else is needed. | camp lead, 2026-09-24 |
| D2 | **One scene, two views.** Plan (from above, orthographic) is the precise mode; 3D tilts the same scene. Every edit works in both. Dragging on empty ground moves the view, as on a map. | camp lead accepted the recommendation, 2026-09-24 |
| D3 | **Four schema additions:** item height, item lock, the plot's north, and a plan version. Plus one new table for kind defaults. §5. | same |
| D4 | **Kind defaults are camp-wide**, not per season. A tent's size is a fact about the camp's equipment, which survives from one burn to the next; the copy-from-last-year flow already carries per-season layout. | same |
| D5 | **Quarter turns only.** No rotation column, as today (`src/db/schema/site.ts:52`): a turn swaps width and depth, so "inside the fence" and "overlaps" stay four comparisons. The turn now pivots on the item's centre, which is what a lead expects in 3D; the old corner pivot was chosen for a flat board. | same |

## 3. Approaches considered for the scene

**A — Hand-written projection on a 2D canvas** (what the mock does). No
dependency and fully testable, but it paints in back-to-front order, so two
overlapping items — a state this map must be able to show — draw in the wrong
order. Picking, shadows and an orthographic plan view would all be hand-written.

**B — `three`, used directly (recommended).** WebGL with a real depth buffer, so
overlaps render correctly. Raycasting for picking, shadow maps for shade by hour,
and orthographic and perspective cameras all come with it. One dependency, no
React coupling: React owns the panels, a small adapter owns the scene. `three`'s
scene graph and raycaster run in Node without a GPU, so the adapter is testable
in the existing suite.

**C — `three` through `@react-three/fiber`.** Declarative scene in JSX. It adds a
second renderer tied to React's internals (React 19.2, Next 16.3 here), a larger
upgrade surface, and usually `drei` with its own tree of dependencies. It buys
little for ~50 boxes.

**B.** The editor's rules — geometry, snapping, label layout, camera maths, the
sun, commands and history — are plain TypeScript with no `three` import, so if
the renderer ever changes, only the adapter does.

`three` is loaded only by `/site`, through `next/dynamic` with SSR off, so no other
page grows. The exact `next/dynamic` form is checked against
`node_modules/next/dist/docs/` before it is written (`AGENTS.md`).

## 4. Units and how they fit

```
page.tsx (server)            loads plan, items, kind defaults, build tasks
  └─ SiteEditor (client)     owns the editor store; lays out the panels
       ├─ useEditorStore     state + commands + history      ← src/lib/site/editor/*
       ├─ SaveQueue          batches ops → saveSiteChangesAction
       ├─ SceneView (dynamic, no SSR)
       │    ├─ SceneSync     items → three meshes, by id
       │    ├─ CameraRig     camera state → three camera (persp ⇄ ortho)
       │    ├─ Picking       screen point → item / handle / ground
       │    └─ Gestures      pointer state machine → commands
       ├─ LabelsLayer        DOM labels, placed by label-layout.ts
       └─ panels             toolbar, library, list, inspector, checks,
                             view controls, minimap, selection bar, sun card,
                             shortcuts, toasts
```

**Pure, no DOM, no `three` — `src/lib/site/`**

| File | Does | Depends on |
|---|---|---|
| `geometry.ts` *(exists)* | overlap, inside, resize, snap, shaded rect, areas; gains `turnAboutCentre`, `unionRect`, `gapsAround` | — |
| `derive.ts` *(exists)* | outside / overlapping / shade flags and counts | geometry |
| `kinds.ts` *(exists)* | presets; gains height, plural label, shape | — |
| `defaults.ts` | effective size of a kind = stored default ?? preset | kinds |
| `editor/model.ts` | the editor's item and plan types, from the server's rows | — |
| `editor/commands.ts` | every edit as a pure function: `(state, args) → { state, ops, inverse }` | geometry, defaults |
| `editor/history.ts` | undo / redo stacks of `{ ops, inverse }` | — |
| `editor/ops.ts` | the save-op types, coalescing, and the validator the server also runs | kinds |
| `editor/snapping.ts` | grid snap, alignment guides, gap readouts | geometry |
| `editor/placement.ts` | the free spot nearest a point | geometry |
| `editor/camera.ts` | camera state, projection, fit, zoom-at-cursor, orbit limits | — |
| `editor/label-layout.ts` | places labels with no overlaps (§9) | — |
| `editor/sun.ts` | sun position, shadow offset, shade-at-hour counts (§11) | geometry |

**Client — `src/app/(admin)/site/editor/`:** `site-editor.tsx`,
`use-editor-store.ts`, `save-queue.ts`, `scene/{scene-view.tsx, scene-sync.ts,
meshes.ts, camera-rig.ts, picking.ts, gestures.ts}`, `labels-layer.tsx`, and one
file per panel under `panels/`.

Every unit answers three questions without opening another: what it does, how it
is called, what it depends on. The adapter (`scene/`) is the only code that
imports `three`.

## 5. Data model — migration `0012`

`0011` is logistics' (`docs/collab/claims.md`), so this is `0012`, generated
with `drizzle-kit generate` and applied to Railway by the camp lead by hand, as
`0009`–`0011` were (`docs/deploy.md` §6).

**`site_plans`**
- `version integer not null default 0` — incremented by every saved batch (§6.4).
- `north_deg integer not null default 0` — the compass bearing the map's "up"
  points to. 0 means up is north, which is what today's map already implies.
  Edited in the plot drawer. Used only by shade by hour.

**`site_items`**
- `height_cm integer` — **null means the kind's height**, and the inspector says
  so ("גובה ברירת מחדל"). Used for drawing and for shadows, never for validation.
- `locked boolean not null default false` — a locked item cannot be dragged,
  nudged, resized, turned or removed until it is unlocked.

**`site_kind_defaults`** (new; camp-wide, D4)
- `kind text primary key`, `width_cm integer not null`, `depth_cm integer not
  null`, `height_cm integer not null`, `inset_cm integer`, `updated_at`,
  `updated_by`.
- A row overrides the preset in `kinds.ts`. No row means the preset. "Back to the
  standard size" deletes the row.

`copyPlan` copies `height_cm` and `north_deg`, resets `locked` to false (a lock
is this year's statement), and keeps its refusal to overwrite an existing map.

## 6. Saving

### 6.1 The store owns the truth after load

The page loads rows once. From then on the editor store is what the screen
shows. There is no `router.refresh()` after an edit, which is what makes today's
board jump.

### 6.2 Commands, ops and history

Every edit is a pure command in `commands.ts` returning the next state, the ops
that persist it, and the inverse ops that undo it. History keeps
`{ label, ops, inverse }` per user action — a drag, a nudge, a multi-row
arrangement is one entry. Undo applies the inverse to the store and sends the
inverse ops to be saved, so an undo is saved like any other edit. History lives
for the session only.

Ops:

```ts
type SiteOp =
  | { type: 'add'; item: NewItem }                  // id is client-made (crypto.randomUUID)
  | { type: 'update'; id: string; patch: ItemPatch } // ItemPatch gains heightCm, locked
  | { type: 'remove'; id: string }
  | { type: 'setKindDefault'; kind: SiteItemKind; size: KindSize | null };
```

### 6.3 The queue

`save-queue.ts` coalesces before it sends: updates to one id merge, an add
followed by updates becomes one add, an add followed by a remove sends nothing.
It sends 500 ms after the last change, one request at a time, and flushes
immediately on `visibilitychange` and `pagehide`. While anything is unsent, a
`beforeunload` guard warns before the tab closes.

The top bar says one of: **כל השינויים נשמרו**, **שומר…**, or **לא נשמר —
ניסיון חוזר** with a retry button. Never nothing.

### 6.4 The server applies a batch or refuses it whole

`saveSiteChangesAction(planId, baseVersion, ops)` → `applySiteOps` in
`plan.ts`, in one transaction (the `run-import.ts` helper):

1. Lock the plan row and compare `version` with `baseVersion`.
2. Validate every op with the same validator the client ran (`ops.ts`), plus
   the checks only the server can make: the item belongs to this plan, the task
   is a build task of this season, the id is a UUID not already used.
3. Apply, bump `version`, and return the new version.

**A version mismatch is a conflict, and a conflict is a visible decision.** The
editor stops sending and shows a banner: *"המפה שונתה ממקום אחר מאז שנפתחה.
השינויים האחרונים שלך עוד לא נשמרו."* It offers two actions:

- **טעינת הגרסה העדכנית** — reload the server's map and drop the unsent changes.
- **שמירת השינויים שלי מעליה** — resend the pending ops against the new version.
  Ops naming items that no longer exist are dropped and listed by name.

A validation refusal (rare, because the client ran the same rules) stops the
queue, shows the Hebrew reason, and offers the reload.

## 7. The scene

**Meshes** (`meshes.ts`), one builder per shape, as in the mock: box; sofa (seat
plus back); tent (walls plus gable roof along the longer side); cylinder (water,
grey water, boiler); fire (low cylinder, ember top); shade net (four poles plus a
translucent cloth at the net's height, with the unshaded strip outlined). Group
colours are the mock's, scoped to the scene, in light and dark. Edges are drawn
so boxes read in plan view.

**`SceneSync`** keeps a `Map<id, Object3D>` and diffs the store's items into the
scene: create, update the transform and geometry, dispose on remove. It never
rebuilds the whole scene.

**Cameras** (`camera.ts` holds the state; `camera-rig.ts` applies it). The state
is `{ target, distance, yaw, pitch }`. 3D uses a perspective camera (FOV 30°,
pitch clamped to 18°–89°). Plan uses an orthographic camera looking straight
down, framed to match: frustum height = 2 · distance · tan(fov / 2). Switching
animates the perspective camera to pitch 90 and then swaps, so there is no jump.
Zoom goes toward the cursor; "fit" frames the plot, or the selection, inside the
area the panels leave free.

**Picking** raycasts against item meshes, and against the cloth only when no
solid item is hit. Handles are picked in screen space first. The ground plane
gives the drag point.

**Lighting.** A hemisphere light plus one directional light. With shade by hour
on, the directional light is the sun (§11) and casts shadows.

**No WebGL:** `SceneView` catches the renderer's failure and shows, in Hebrew,
that the map needs a browser with 3D graphics turned on. Under it goes the item
table (`site-table.tsx`, kept for this) so nothing is lost. The same table is
the view on screens narrower than 900 px.

## 8. Interaction

**Mouse and trackpad**

| Gesture | Result |
|---|---|
| Click an item or its label | select it |
| Shift / ⌘ + click | add to or remove from the selection |
| Drag an item | move the selection: grid snap, then alignment guides; clear gaps to neighbours and the fence shown while dragging |
| Alt + drag | move without snapping |
| Drag a handle | resize, opposite edge fixed, snapped, never under 10 cm |
| Drag empty ground | move the view |
| Shift + drag empty ground | select everything inside the rectangle |
| Right-drag / Ctrl + drag (3D) | orbit |
| Wheel / pinch | zoom toward the cursor |
| Double-click an item | fly to it |
| Click a grouped label ("4 תאי שירותים") | zoom until the group separates |
| Drag from the library | place with a live preview that says if it is outside the fence or overlapping |
| Click in the library | place at the free spot nearest the middle of the view |

A **shade net that is not selected** selects on click but does not move on drag,
which pans the view instead. Otherwise a net that covers half the lounge would
move every time someone tried to pan across it.

**Keyboard** — read from `event.code`, so it works with a Hebrew layout:
arrows move by one grid step and Shift + arrows by a metre, relative to the
screen, so "up" means away from the viewer in any orientation; `R` turn, `L`
lock, `Delete` remove, `⌘D` duplicate, `⌘Z` / `⇧⌘Z` undo and redo, `⌘A` select
all but nets, `Esc` clear, `V` / `M` select or measure tool, `2` / `3` plan or
3D, `F` fit, `Q` / `E` turn the view, `+` / `−` zoom, `?` the shortcuts card.

**Removing** needs no confirmation dialog: it removes, and a toast offers
**ביטול** for five seconds. Locked items are skipped and the toast says so.

## 9. Labels that never overlap

`label-layout.ts` is a pure function from `{ id, text size, anchor, item box
on screen, priority, kind, base label }[]` plus the free screen area, to placed
rectangles. The DOM layer (`labels-layer.tsx`) only draws what it is given. It
updates transforms directly in the render loop, without a React render.

1. **Priority:** selected, then hovered, then items with a problem, then larger
   footprint first. Nets rank last and anchor on their north edge, so a net's
   label never sits in the middle of the furniture under it.
2. **Candidates, in order:** inside the item if it fits; above; below; the two
   sides; the four corners; two rows further out. Anything outside the item gets
   a leader line to its anchor.
3. **Obstacles:** labels already placed, the selection's handles and toolbar,
   and the floating panels. Labels never go under a panel.
4. **Groups:** neighbours of the same kind and base label whose centred labels
   would collide form a group. The group first tries to place every member close
   to its item; if any fails, it shows one label, "4 תאי שירותים", with a dot on
   each member. Zooming in splits it.
5. **Stability:** each label tries last frame's position first, so labels do not
   jump while the view turns.
6. **Too small:** an item under 3 px on screen is not labelled unless it is
   selected or hovered.
7. **Sizes:** the selected item's label adds its size ("3 × 3 מ׳").

A third style, **printed** (plan `2026-09-26-site-label-modes`), draws the
item's own name on its faces as part of the scene and takes no part in this
layout: it never groups, never adds the size, never moves, and is in the
exported picture. The tool row chooses between floating, none and printed; the
choice is remembered per browser.

## 10. Panels

Layout as in the mock: the admin shell, a top bar, a tool row, and the scene
filling the rest, with floating panels over it.

- **Tool row:** select / measure; undo / redo; plan / 3D; a three-way labels
  control (מרחפות / בלי / מודפסות); toggles for shade by hour, hiding nets,
  snapping.
- **Library** (right): search; kinds grouped as in `kinds.ts`, each tile
  showing its effective default size, with a dot when the default has been
  changed. **במפה** tab: every item grouped by kind group, searchable. A row
  selects and flies to its item; Shift adds it to the selection. Each group can
  be hidden. This list is also the keyboard and screen-reader route through the
  map.
- **Inspector** (left), one of three states:
  - *Nothing selected:* the plot — size and grid (linking to the plot drawer),
    area, north, a count per group (click selects the group), shaded area and
    number of nets, and every problem as a row that jumps to it. Marked
    "נרשם ידנית".
  - *One item:* name, kind, width / depth / height and position in metres
    (typed, checked, applied on Enter or blur), unshaded strip for nets, the
    build task, notes, and status chips (outside the fence, overlapping *with
    whom*, in a net's unshaded strip, shaded). "Save these sizes as the default
    for this kind" and "back to the default". Turn, duplicate, lock and remove.
  - *Several items:* chips per kind ("6 אוהלים · 2 קראוונים"). **One row per
    kind** with width / depth / height. A value that differs across the
    selection shows empty, with placeholder **מעורב** — never a made-up number.
    Typing applies to every item of that kind in the selection, each resized
    about its own centre. **"לשמור גם כברירת המחדל של ⟨kind⟩"** stores the
    kind's default. If the selected items of that kind still differ, the panel
    says so and stores nothing until they match. Then align (six buttons),
    distribute evenly (three or more unlocked items), and arrange in a row
    with a typed gap.
    Turn, duplicate, lock and remove.
- **Checks** (top centre): "N מחוץ לגדר", "N חפיפות", "N בשולי רשת צל", or
  "הכול תקין". Each press selects the next case and flies to it. These replace
  the four stat tiles and the outside-the-fence banner.
- **View controls** (bottom centre): zoom, zoom level, fit, turn view, a compass
  that returns north to the top, a scale bar, and the shortcuts card.
- **Minimap** (bottom left): the whole plot from above, with the visible area
  outlined. Click or drag moves the view.
- **Selection bar**, floating next to the selection: turn, duplicate, lock,
  remove. Hidden while the view moves.
- **Toasts** for add, remove, duplicate and lock, with **ביטול** where an undo
  exists.
- **Export:** "ייצוא תמונה" saves a PNG of the current view.

## 11. Shade by hour

Shows where the nets' shade actually falls at a chosen hour, and counts what is
really shaded then.

- **Sun position** (`sun.ts`): the NOAA solar-position approximation from date,
  clock time in Asia/Jerusalem, latitude and longitude. Pure, and tested against
  published values.
- **Where and when:** the burn site is one camp-wide constant,
  `CAMP_SITE = { latitude: 30.6154, longitude: 34.7988 }` — the Midburn event
  pin the camp lead gave on 2026-09-24. The camp's own spot on the playa is not
  known yet and does not need to be: a kilometre moves the sun by about 0.01°.
  The date is the season's `startsOn`. Without one, the toggle opens an
  invitation to set the gate date instead of guessing a day.
- **Orientation:** `north_deg` from the plot drawer. The card says which way
  north is and links there.
- **Drawing:** the directional light takes the sun's direction and casts real
  shadows; items are lit by it.
- **Counting:** for items under any net's footprint, the net's shaded rectangle
  translated by `height · cot(elevation)` away from the sun decides full, part
  or none: "בשעה 14:00, מתוך 13 פריטים מתחת לרשתות: 4 בצל מלא, 4 בצל חלקי,
  5 בשמש".
- **The time slider** runs 07:00–18:00 in quarter hours.

## 12. What stays and what retires

| Stays | Retires |
|---|---|
| `page.tsx` (rewritten around `SiteEditor`), `loading.tsx` | `site-board.tsx` and its test — replaced by the editor |
| `plot-drawer.tsx` (+ a north field), `copy-drawer.tsx` | `item-drawer.tsx` — the inspector does its job |
| `site-table.tsx` — the no-WebGL and narrow-screen view | `remove-item.tsx` and `REMOVE_ACT` — removal is undoable, so no confirmation page |
| `?peek=<id>` — now selects that item on load (deep link) | `addItemAction`, `updateItemAction`, `removeItemAction` — replaced by `saveSiteChangesAction` |
| `createPlanAction`, `setPlotAction` (+ north), `copyPlanAction` | the four stat tiles and the outside-the-fence banner — replaced by the checks bar and the inspector |
| `plan.ts` readers and validators, `geometry.ts`, `derive.ts` | |

Nothing outside `src/app/(admin)/site/**`, `src/lib/site/**` and
`src/db/schema/site.ts` imports any of what retires (checked 2026-09-24 against
`60e1850`).

## 13. The product's rules, applied

- **Never guesses:** mixed sizes show as mixed; a default is stored only when the
  sizes agree; a conflict between two leads is a choice on screen; the sun needs
  a real date; an item that overlaps or crosses the fence is flagged, never
  moved for the lead.
- **Every figure links to what changes it:** check chips, problem rows and group
  counts select their items; the plot size opens the plot drawer; the north
  opens it too.
- **Every number says where it came from:** everything on this screen is typed
  by a lead, and the inspector says "נרשם ידנית". Heights and sizes still on
  their kind's default say "ברירת מחדל".
- **An empty state is an invitation:** no map → create or copy (as today); an
  empty map → the library is open and says how to place the first item; no date
  for the sun → set the gate date.
- **No English on a Hebrew screen:** every new refusal in `plan.ts` gets a prefix
  in `failure-messages.ts`, including the conflict, the height, the lock, the
  kind default and the op validator. The no-WebGL notice and the toasts are
  Hebrew.

## 14. Testing

The suite runs with the capped command in `CLAUDE.md`.

- **Pure modules** (`src/lib/site/**`, node environment), written test-first:
  geometry additions, defaults, commands and their inverses (apply then undo
  gives the starting state, for every command), history, op coalescing and
  validation, snapping and gaps, placement, camera maths (project then unproject
  round-trips; fit contains the rectangle), label layout (no two rectangles
  intersect across seeded random layouts; groups form and split; stability),
  and sun (against published values).
- **Database** (`plan.test.ts`, pglite): `applySiteOps` applies a batch, bumps
  the version, refuses a stale version, refuses an invalid batch whole, refuses
  ids from another plan. Kind defaults read and write; `copyPlan` handles the new
  columns.
- **Scene adapter, without a GPU:** `three`'s scene graph and raycaster run in
  Node. `SceneSync` diffs are asserted on the scene graph; picking is asserted
  by casting rays at known screen points. `gestures.ts` is a state machine
  driven by synthetic pointer events against a fake picker.
- **Panels** (jsdom, Testing Library) with `SceneView` mocked: the inspector's
  three states, "מעורב", saving a default only when uniform, the Hebrew
  validation messages, the checks bar cycling, the library, the list, the save
  indicator states, the conflict banner.
- **The page** (`page.test.tsx`): empty-season invitations, the editor mounted
  with the loaded rows, `?peek=` selecting an item.
- **In a browser, before the PR:** the app runs locally and the Playwright MCP
  (installed in the camp lead's Claude Code, not in the repo) drives each
  gesture in §8, in plan and 3D, light and dark, with screenshots. Playwright is
  not added to `package.json`: D1 admits only `three`, and the MCP needs
  nothing from the repo.

## 15. Shared surfaces touched

For the PR body's `## Shared surfaces touched`, per `protocol.md` §3:

- `package.json`, `package-lock.json` — `three`, `@types/three` (D1, the R1
  exception). The `package.json` row in `docs/collab/ownership.md` is edited in
  the same PR to record the exception (`protocol.md` §4).
- `drizzle/0012_*.sql` and `drizzle/meta/*` — the shared migration sequence.
- `docs/collab/claims.md` — the camp-map row. It currently names a branch that no
  longer exists; it will name `feat/site-map-3d`.

Everything else is inside the camp-map area.

## 16. Out of scope

Free rotation; editing on a phone (phones get the table, §7); live presence or
simultaneous-edit merging beyond §6.4; textures and models; drawing free paths,
zones or neighbouring camps; printing layouts beyond the PNG export; a history
that survives a reload.

> **Narrowed 2026-09-25 (`feat/site-utility-lines`, migration `0013`).** One
> kind of path is now in scope: a **pipe or cable between two items**
> (`site_lines`), so the camp can read off how many metres of hose and cable
> to buy. It is not a free path — its ends are items, it follows them, and it
> may join only the kinds its utility reaches (`src/lib/site/lines.ts`: water
> between a drinking-water tank, a shower and a sink; power between the
> generator, a fridge and a light). Bends are typed in the line's panel.
> Everything else in this list stands.

## 17. Risks

| Risk | Mitigation |
|---|---|
| `three` or `next/dynamic` behaves differently in Next 16.3 | Read `node_modules/next/dist/docs/` first; the first scene task ships a bare scene on `/site` and checks it in a browser before anything builds on it |
| Two bundles of `three` (`three` and `three/addons` resolving differently) | Import from `three` and `three/addons/...` only; the bundle is checked once, early |
| The WebGL context is lost (a GPU reset, a laptop lid) | Listen for `webglcontextlost` / `restored`; show a Hebrew notice and rebuild the scene from the store |
| Labels cost frame time | Layout runs only when the camera or items change, not every frame; measured at 200 items |
| The conflict banner is rare, so its code rots | Covered by `plan.test.ts` and a panel test that forces a mismatch |
| The camp's exact spot differs from the event pin | Irrelevant at this scale (§11); the constant is one line if it ever matters |
