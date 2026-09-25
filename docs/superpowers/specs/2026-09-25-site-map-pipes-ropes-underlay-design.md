# מפת הקאמפ, extended: pipes and cables, shade-net ropes, and an image to trace

**Status:** draft for the camp lead's review, 2026-09-25. Nothing here is built.

**Read first:** `2026-09-24-site-map-3d-editor-design.md` — "the editor spec"
below. This spec uses its words (ops, the save queue, the version check, the
checks bar, the inspector's three states, the label layout) without explaining
them again. Decisions continue its numbering: D1–D5 are the editor spec's, D6
onward are this one's.

**Checked against** `origin/main` at `0e113e1`: `/site` is the editor, the old
board and `addItem`/`updateItem`/`removeItem` are gone, and `applySiteOps` is
the only write path. The last migration is `0012`.

Three parts. **Each can ship alone** (§24 gives the order and what ties them).

- **A — Pipes and cables (צנרת וכבלים).** Lines for water, power and grey-water
  drains, drawn between items, with branches, lengths, a purchase summary and
  checks for what is not connected.
- **B — Shade-net ropes (חבלי רשתות צל).** A net's ropes are drawn to their
  stakes, and the rope edge becomes the net's real footprint.
- **C — An image to trace (תמונת רקע).** A photo or scan of the sketch lies
  under the map, scaled from one known distance, and items are placed on it by
  hand.

---

## 1. What this is for

**A.** The camp lead: *"set pipes so I can connect the water tank with showers
and other objects."* Done means:

1. A lead draws a water pipe from the tank to the showers, a cable from the
   generator to the fridges, and a drain from the showers to the grey-water
   tank, with bends and branches, in plan or 3D, and can edit or undo any of it.
2. Every route is on the map with its length.
3. The plot inspector says how much to buy: metres per type, and the fittings.
   Every figure selects the lines it counts.
4. The checks bar catches a shower with no water line or no drain, a fridge
   with no power, a line that ends nowhere, and a line past the fence.

**B.** *"The shades are tied with ropes to the ground in a diagonal line …
it should be considered as part of the area calculation as the real edge
instead of the current edge of the shade."* Done means:

1. A net's ropes are drawn down to their stakes.
2. Once an angle is set, the fence check, the overlap check, the gaps shown
   while dragging and the plot's area taken all use the rope edge. Shade is
   still cast by the cloth alone.
3. The net's inspector shows the shaded ground, the cloth and the rope
   footprint, and how each was worked out.

**C.** *"Analyze such images so we can upload one and get the layout on the
editor"*, which the camp lead chose to do as trace-over, not recognition. Done
means:

1. A lead uploads a photo or scan of the sketch, and it lies under the map,
   see-through.
2. Marking two points and typing the distance between them sets the scale.
   Moving and quarter turns align the image.
3. Items are placed on top by hand, as today.
4. Only the camp's admins can see the image.

## 2. Decisions

The first five are the camp lead's (2026-09-25) and are binding. The rest are
this spec's, for review. §27 lists the ones most worth a second look.

| # | Decision | By |
|---|---|---|
| D6 | **One line tool for three kinds of line: water, power and grey-water drain.** Lines are drawn by clicking. A line starts on an item. Bends are clicked on the ground, snap to the grid and can be dragged later. The line ends on an item. Its length is the length of the route. | camp lead |
| D7 | **Branching.** A new line may start on an existing line, making a T. The checks follow connectivity through branches, and the purchase list counts length and T fittings. | camp lead |
| D8 | **The rope edge is the net's footprint** for the fence check, the overlap and walkway checks and the plot's area taken. Shade is cast by the cloth only. Ropes are drawn in 3D down to their anchors. | camp lead |
| D9 | **The rope angle is set in degrees from the ground.** There is one camp-wide default for nets and a per-net override. The same angle applies on all four sides. The stake offset is the cloth's height ÷ tan(angle), outward from each edge. | camp lead |
| D10 | **Trace-over, not recognition.** A lead uploads an image, calibrates its scale from one known distance and places items by hand. No new service is added, and Claude vision was declined. | camp lead |
| D11 | **Connectivity passes through every item a line touches.** It is worked out separately for each line type. A shower is connected when a chain of lines of that type, and the items they touch, reaches a source (§5). | this spec |
| D12 | **A line type is checked only once it has a line.** A map with no water lines raises no "shower without water", so no existing map changes on the day this ships (§10). | this spec |
| D13 | **A line end names what it is attached to, and a broken name is never repaired silently.** The name is a plain reference, not a foreign key. If the item or line it names is gone, the end sits at its last saved point and is flagged as an open end (§6). | this spec |
| D14 | **A line's end on an item moves with the item.** The end is kept as a point on the item's rectangle, so moving or resizing the item never writes to the line. Removing the item detaches the end in the same undo step (§6). | this spec |
| D15 | **What to buy is the route length, rounded up to the whole metre for each type.** Fittings are counted. No allowance is added (§11). | this spec |
| D16 | **There is no rope angle until the camp sets one.** Until then a net is checked by its cloth, as today, and the inspectors ask for an angle (§12). | this spec |
| D17 | **Rope angles are whole degrees from 20° to 80°** (§12). | this spec |
| D18 | **A net's height now moves its footprint.** The editor spec §5 kept heights for drawing and shadows only. Under D9 a net's height sets its rope offset, so it can put the net past the fence. Heights of other kinds are still never checked. | follows from D9 |
| D19 | **The image's placement belongs to the map; the lead's view of it does not.** Placement, scale, turn and calibration are saved with the plan, versioned and undoable. Opacity and show/hide are view settings, like the labels switch (§17). | this spec |
| D20 | **Images are PNG, JPEG or WebP, up to 4 MB, and private.** They are stored through the existing storage driver and served only by a route that admits admins (§16). | this spec |
| D21 | **Three migrations, one per part: `0013` ropes, `0014` lines, `0015` image**, in the suggested build order. The camp lead applies each one to Railway by hand, as with `0012` (`docs/deploy.md` §6). | this spec |

## 3. What exists today, and what this spec had to define

- **There is no walkway check.** The nearest thing is the set of gap readouts
  shown while dragging (`gapsAround`, editor spec §8). They measure the clear
  ground to non-net neighbours and to the fence. This spec takes "walkway
  check" to mean those readouts. With ropes, they measure to a net's stake
  line (§14).
- **There is no "area taken".** The plot inspector shows the plot's area and
  the shaded area. This spec adds **שטח תפוס**: the union of every item's
  footprint, with nets measured by their rope footprint, clipped to the plot
  (§14).
- **Nets never take part in an overlap** (`overlapPairs`). Things stand under a
  net; that is what it is for. So the overlap rule for ropes covers the band
  between the cloth edge and the stakes. It has its own chip (§15), because
  "overlaps a net" is normally fine.
- **Heights were never checked** (editor spec §5). D18 changes that, for nets
  only.
- **The editor spec's §16 ruled out "drawing paths".** Lines here are utility
  routes. Walkways and zones stay out (§25).
- **There is no light or sink kind** (`kinds.ts`). §5 says what stands in for
  them.

## 4. Units and how they fit

Every rule of the editor spec still holds. Lengths are whole centimetres; x
grows east, y grows south and z grows up; the map never mirrors for RTL;
`three` is imported only under `scene/`; and no dependency is added.
`three/addons/lines/*` ships inside `three@0.186.1` through its `"./addons/*"`
export, and `three-guard.test.ts` already covers `three/…` imports.

**New files**

| File | Part | Does | Depends on |
|---|---|---|---|
| `src/lib/site/lines.ts` | A | line types and their rules; resolving ends on items, on lines (T) and on the ground; route length; nearest-edge attachment; the point at a distance along a route | geometry, model |
| `src/lib/site/line-checks.ts` | A | the networks for each type; unconnected items; open ends; lines past the fence | lines |
| `src/lib/site/line-summary.ts` | A | the purchase summary (§11) | lines |
| `src/lib/site/editor/line-commands.ts` | A | every line edit as ops, with the same three rules as `commands.ts` | lines, ops |
| `src/app/(admin)/site/editor/scene/line-tool.ts` | A | the drawing tool as a pure state machine, like `gestures.ts` | lines |
| `src/app/(admin)/site/editor/scene/line-meshes.ts` | A | lines in the scene (`three/addons/lines/Line2.js`) | three |
| `src/app/(admin)/site/editor/panels/inspector-line.tsx` | A | the inspector for one selected line | lines |
| `src/lib/site/editor/degrees.ts` | B | reads typed whole degrees and returns a Hebrew refusal when needed, as `metres.ts` does for lengths | — |
| `src/lib/site/underlay.ts` | C | the image's placement on the map; map ↔ image points; calibration; quarter turns | geometry |
| `src/lib/site/image-facts.ts` | C | reads an image's type and size in pixels from its first bytes | — |
| `src/lib/site/underlay-limits.ts` | C | the upload limits and their Hebrew, in one module with no imports, like `upload-limits.ts` | — |
| `src/app/(admin)/site/underlay/[planId]/route.ts` | C | `POST`: stores an uploaded image | storage, auth |
| `src/app/(admin)/site/underlay/[planId]/[file]/route.ts` | C | `GET`: serves the file to admins only | storage, auth |
| `src/app/(admin)/site/editor/scene/underlay-mesh.ts` | C | the textured plane | three |
| `src/app/(admin)/site/editor/panels/underlay-card.tsx` | C | the image card: upload, calibrate, align, opacity, show/hide | underlay |

**Files that change:** `src/db/schema/site.ts`, `geometry.ts`, `derive.ts`,
`defaults.ts`, `editor/{model,ops,commands,placement}.ts`, `plan.ts`,
`use-editor-store.ts`, `scene/{engine,scene-sync,meshes,palette,gestures,scene-view}.ts(x)`,
`keyboard.ts`, `site-editor.tsx`, and the panels `toolbar`, `checks-bar`,
`inspector-plot`, `inspector-item`, `inspector-multi`, `objects-panel` and
`minimap`, plus `failure-messages.ts`. §23 lists the interface-contract changes.

---

# Part A — Pipes and cables

## 5. Line types, sources, and what must be connected

| Type | On screen | A line is called | Colour, pattern | Sources | Flagged when not connected to a source |
|---|---|---|---|---|---|
| `water` | מים | צינור מים | teal, solid | `water` (מיכל מי שתייה) | `shower` |
| `power` | חשמל | כבל חשמל | violet, short dashes | `generator` (גנרטור) | `fridge` |
| `drain` | ניקוז | צינור ניקוז | olive, long dashes | `greywater` (מים אפורים) | `shower` |

- **Any line may start or end on any item.** The table only says which items
  are the roots of a network, and which items are flagged when no line of that
  type reaches a root.
- **Connectivity (D11).** For each type, the items and the lines of that type
  form a graph, and T junctions join lines to lines. An item is connected when
  its part of the graph holds a source. So tank → shower 1 → shower 2 connects
  both showers: a line drawn on from a shower is the lead saying the pipe
  carries on from there. A boiler needs no special case: tank → דוד → showers
  connects the showers through it.
- **Why only these kinds are flagged.** In any camp, a shower with no water or
  no drain, or a fridge with no power, is a planning miss. A kitchen may run on
  jerrycans, a caravan may have its own battery, and a boiler may run on gas.
  Flagging those would be a guess about this camp (§27 Q3). They can all be
  connected; they are just never flagged.
- **Lights and sinks.** Neither kind exists. A power line that ends on a net or
  on the bar stands for the lights hung there. A water line to the bar or the
  kitchen stands for its sink. Neither is flagged when missing (§27 Q4).
- A line that touches another type's source, such as a power cable to the water
  tank for a pump, is allowed and not flagged.
- **Colours** are new entries in `scene/palette.ts`, the scene's scoped palette,
  with light and dark values. Proposed values: water `#0F7394` / `#5CC4E6`,
  power `#7B3FC4` / `#B79AF2`, drain `#6B6A1F` / `#C2BE63`. Each clears 3:1
  against `plot` in its theme (WCAG 1.4.11), and each is kept apart from
  `guide` (the snap-line blue), `bad`, `warn` and `selected`. The planner may
  tune the values, but the contrast check stays. The panels read them through
  the `--scene-*` custom properties `SiteEditor` already sets. The dash
  patterns mean colour is never the only thing that tells the types apart.

## 6. Data — migration `0014`

```
site_lines
  id          uuid primary key            -- made by the client, like an item's
  plan_id     uuid not null → site_plans(id) on delete cascade
  type        text not null               -- 'water' | 'power' | 'drain'
  label       text not null               -- "צינור מים 3"
  route       jsonb not null              -- { from, bends, to }, below
  notes       text
  created_at, updated_at timestamptz not null default now()
  updated_by  text
  index on plan_id
```

```ts
type SiteLineType = 'water' | 'power' | 'drain';
type Point = [number, number];                       // whole cm, map coordinates
type LineEnd =
  | { on: 'item'; itemId: string; u: number; v: number; at: Point }  // u, v: thousandths of the item's width and depth from its north-west corner
  | { on: 'line'; lineId: string; alongCm: number; at: Point }      // a T: this far along the other line, from its start
  | { on: 'ground'; at: Point };                                    // an open end
interface EditorLine { id: string; type: SiteLineType; label: string;
  from: LineEnd; bends: Point[]; to: LineEnd; notes: string | null }
// EditorDoc gains `lines: EditorLine[]`; the server stores { from, bends, to } as `route`.
```

- **`at`** is always the end's point on the map as it stood when the line was
  last saved. For an open end it is the whole answer. For the other two kinds
  it is only a fallback (D13).
- **An end on an item** is a point on the item's rectangle, kept as fractions.
  It follows every move and resize without any write to the line (D14). A
  quarter turn keeps the fractions, so an end on the east side stays on the
  east side, and a turn never swings a pipe the lead did not touch.
- **A T** is kept as a distance along the other line (its host). Dragging the
  host's bends slides the T along with it. If the host becomes shorter than
  that distance, the T sits at the host's end.
- **Limits:** at most 200 bends per line, each point inside `POSITION_RANGE`,
  and `u` and `v` whole numbers from 0 to 1000.

**Why one table with a JSON route.** A route is always written whole and never
queried point by point. With a table of points, every bend drag would become a
delete and an insert. `source.ts` already stores grids as `jsonb` in the same
way.

**Why a plain reference instead of a foreign key (D13).** A key inside JSON
cannot carry a foreign key in any case. More to the point, a hard key would
turn a rare race into a refused batch that throws away the lead's unsaved work.
The race: the other lead removed the shower this pipe runs to. Instead, a name
that points at nothing falls back to `at` and is flagged as an open end. That
is visible, and the system never repairs it silently. The commands keep names
right in the normal case: removing an item or a line first re-points every end
attached to it to the ground, at its current place, in the same history entry.
Undo then re-attaches them.

**When an item that a line end is attached to is…**

| … | the end |
|---|---|
| moved or resized | moves with it. The route's last segment stretches, and the length and checks update live, while the drag is still going on (the engine resolves lines against its drag preview). |
| turned | keeps its side of the item |
| locked | is unaffected. A lock fixes the item, so the end stays because the item does. A line may still start or end on a locked item, and the end may be re-attached elsewhere, because that changes the line, not the item. |
| removed | is detached to the ground where it was, and flagged. Undo re-attaches it. |
| changed to another kind | stays. The checks read the new kind. |
| hidden with its group | still draws. Hiding lines has its own switch (§8). |

`copyPlan` copies lines too, with new ids, re-pointing their ends to the copied
items and lines. It therefore makes the copied items' ids in code instead of
leaving that to the database, so it can map old ids to new ones.

## 7. Ops, saving and undo

```ts
type SiteOp = /* the editor spec's four */
  | { type: 'addLine'; line: EditorLine }
  | { type: 'updateLine'; id: string; patch: LinePatch }   // label, type, notes, from, bends, to
  | { type: 'removeLine'; id: string };
```

- **The same queue, the same version check.** There is no new action.
  `saveSiteChangesAction` carries the new ops, `applySiteOps` applies them in
  its one transaction, and the plan's version goes up once per batch as today.
  A version mismatch is the same conflict banner.
- **Validation.** `lineRefusal` and `linePatchRefusal` in `ops.ts` are run by
  the client before queueing and by the server before writing: one set of
  rules. The server alone checks that the line is on this plan and that a new
  id is a UUID not already used. It does not check that the named items exist
  (D13). An update or remove that names a missing line is skipped and reported
  as items are (the `applySiteOps` hotfix now in flight), never a crash.
- **`applyOps` / `invertOps` / `coalesceOps`** follow the item rules. Updates to
  one line merge. An `addLine` followed by updates becomes one `addLine`. An
  `addLine` followed by a `removeLine` sends nothing. Everything else keeps its
  order. References are not ordered on the server (D13), so a detach and a
  remove may arrive in either order.
- **Undo** records one history entry per user action: a drawn line, a bend
  drag, a re-attach, or a removal together with its detaches. Each inverse is
  the obvious one: `removeLine` ↔ `addLine` of the whole line, `updateLine` ↔
  the previous fields, and a removal's detaches ↔ the re-attaches.
- **After a conflict, "save mine".** The store's `applyEach` treats line ops as
  it treats item ops. Updates and removes naming a missing line are dropped and
  listed. An add of an id the server already has becomes an update (ruling S2).
  An end that names a missing item is kept: it resolves to `at` and is flagged.

## 8. Drawing and editing

**The tool.** The tool row gets a third tool, **קווים** (key `P`), after
selection and measuring. While it is active, a small segmented choice
**מים · חשמל · ניקוז** appears beside it. Pressing `P` again moves to the next
type. A hint strip under the tool row says what the next click does (§20).

| Input | Waiting for a start | While drawing |
|---|---|---|
| Click an item | starts the line on it | ends the line on it, and the line is saved |
| Click a line | starts a T on it | ends the line with a T on it, saved |
| Click the open end of a line | carries on that line | same as clicking a line |
| Click the ground | nothing; the hint says a line starts on an item or a line | adds a bend, snapped to the grid |
| Alt + click | — | adds a bend without snapping (as Alt + drag today) |
| Shift + click | — | sets the new segment at a multiple of 45° from the last point |
| Enter, or double-click | — | ends the line here, open; saved and flagged |
| Backspace / Delete | — | removes the last bend, never the selection |
| Esc | leaves the tool | drops the line; nothing is saved |
| Drag, wheel, right-drag | move, zoom and orbit the view, as today | the same |

- **Where an end sits on an item:** at the point on the item's edge nearest to
  the route's previous point. The start's point is fixed when the second point
  is placed. This is a placement rule like snapping: it is visible, and the end
  can be dragged elsewhere afterwards.
- **Where a T sits:** at the point on the host nearest to the click.
- **What is under the pointer,** in priority order: an open line end, then an
  item (a solid item before a net, as picking does today), then a line, then
  the ground.
- **Loops.** A line cannot branch from itself or from a line that branches from
  it. The tool does not offer such a target: the cursor shows "not allowed" and
  the hint says why.
- **Ending open.** D6 has a line end on an item. Enter lets a lead stop a
  route short, to finish later, rather than lose it. The open end is saved and
  flagged in the checks bar until it is finished, and clicking it with the tool
  carries the line on.
- **Readout while drawing:** a pill reading "קטע 3.5 מ׳ · סה״כ 12.4 מ׳".
- Drawing works the same in plan and in 3D.

**Selecting and editing (the selection tool)**

- Clicking a line (within 6 screen pixels of it) selects it, and Shift adds it
  to the selection. Where both are under the pointer, an item wins over a line
  and a line wins over a net. The marquee selects items only.
- A selected line shows handles. A handle at each bend can be dragged (snapped),
  and double-clicking it removes the bend. A small handle in the middle of each
  segment can be dragged to insert a bend. A handle at each end can be dropped
  on an item, a line or the ground, to re-attach the end or leave it open.
- **Delete** removes the selected lines and items with no dialog, and a toast
  offers ביטול. When a removed line has lines branching from it, their ends
  detach to the ground at the T and are flagged, and the toast says how many.
- Arrows, turn, lock and duplicate act on items only. A selection of lines
  alone ignores them. Lines have no lock (§25).
- **The "במפה" list** gets a group, **צנרת וכבלים**, with lines under each
  type, each row showing the line's label and length. A row selects the line
  and flies to it. Each type can be hidden; a hidden line is removed from the
  scene, as a hidden group is, so it cannot catch a click.
- `?peek=<id>` may name a line.

**The line inspector** (one line selected) shows:

- the name, the type and the notes;
- the route's length and its segments;
- the two ends, each a button that selects what the end is attached to, or the
  pill "קצה פתוח";
- its fittings: bends by angle, and the T's it hosts;
- the remove action, and the "נרשם ידנית" chip.

The type can be changed only when no T joins the line to another line.
Otherwise the field is disabled and says why.

**Several things selected, lines among them.** The several-items inspector
shows a chip, "2 קווים", which selects just the lines. Sizes, alignment and
arranging act on the items only.

## 9. How lines look

- **Where they draw.** Lines lie on the ground, 2 cm up: above the grid, the
  shade patches and the image, and below everything that stands. They use
  screen-width lines (`Line2` / `LineMaterial` from `three/addons`): 3 px, 4 px
  when hovered, and 5 px with a halo in `selected` when selected. A flagged line
  gets a halo in `bad` if it is past the fence, or in `warn` if it has an open
  end.
- **Under an item.** The hidden part of a line shows through at 35%, drawn in a
  second pass without depth testing, so a route is never invisible. In 3D, lines
  stay flat on the ground and do not climb into the shower.
- **Markers.** An end on an item gets a small filled dot. A T gets a small
  square. An open end gets a hollow ring in `warn`.
- **Picking** is done in screen space, as the distance to the projected
  segments, the same way handles are picked today. Line meshes are click-through
  (`userData.pick = false`), so a line never blocks an item.
- **Labels.** Every line gets a length label, "12.4 מ׳". It goes through the
  same label layout (editor spec §9), anchored at the middle of the line's
  longest segment, ranked below every item and never grouped. In a crowd, item
  labels win and line labels drop out. A selected line's label reads "צינור מים
  2 · 12.4 מ׳" and is placed first. Each of its segments then also shows its own
  length as a small pill, like the gap readouts while dragging. While a line is
  being drawn or a bend dragged, the live pill replaces these. The labels
  switch hides line labels too.
- The minimap draws lines as thin strokes in their colours, and the PNG export
  includes them. Lines cast no shadow in shade by hour.

## 10. Checks

These are three new cases. Like the others they are derived and never stored.
`line-checks.ts` works them out from the resolved lines, in the browser, after
every change, and the store adds them to its flags.

| Chip | Tone | Case | A press selects |
|---|---|---|---|
| "N חיבורים חסרים" / "חיבור חסר אחד" | warn | a flagged kind (§5) whose network of that type has no source. There is one case per item and type, so a shower missing both water and a drain counts twice. | the item |
| "N קצוות פתוחים" / "קצה פתוח אחד" | warn | an end on the ground; an end naming an item or line that is not on the map; or a T that cannot be placed (a loop) | the line |
| "N קווים מחוץ לגדר" / "קו אחד מחוץ לגדר" | bad | any point of the route past the fence. The plot is a rectangle, so checking the route's points is enough. | the line |

- **Types start checking with their first line (D12).** Nothing changes on
  existing maps when this ships. The first pipe of a type turns on the check
  for that type. The purchase section lists which types are being checked.
- **A type with lines but no source on the map** flags every item of its
  flagged kinds, and the type's summary row names what is missing, for example
  "אין במפה מיכל מי שתייה". That is the likely fix.
- **Problem rows** in the plot inspector follow the same order: "בלי מים:
  מקלחת 2", "בלי ניקוז: מקלחת 2", "בלי חשמל: מקרר 1", "קצה פתוח: צינור מים 3",
  "מחוץ לגדר: כבל חשמל 2".
- **The item inspector** shows the pills "בלי מים", "בלי ניקוז" and "בלי חשמל"
  on a flagged item, and lists the lines attached to any item as buttons
  ("קווים: צינור מים 1, צינור ניקוז 2").
- **Not checked:** lines crossing items or each other, lines through a net's
  rope band, the direction of flow, and sizes.

## 11. The purchase summary

This is a new section of the plot inspector (the inspector shown when nothing
is selected), **צנרת וכבלים**, below "צל". Each type that has lines gets one
block:

| Figure | How it is worked out | A press selects |
|---|---|---|
| **לקנייה** — `48 מ׳` | the type's route lengths added up and rounded up to the next whole metre | every line of the type |
| מסלול — `47.35 מ׳ · 5 קווים` | the exact sum, to the centimetre | the same |
| מחברי T (for power, **מפצלים**) | one for every line that starts or ends on another line | the lines that branch |
| זוויות 90° · 45° · אחרות (water and drain only) | for each bend: a turn within 5° of 90 counts as 90°; within 5° of 45 counts as 45°; any other turn of 5° or more counts as אחרות; a turn under 5° is straight and needs no fitting | the lines with such bends |
| חיבורים לפריטים | line ends on items: taps, adapters, plugs | the lines with such ends |

- **Why round the total and not each line.** Pipe and cable are sold by the
  metre and cut from stock. Rounding each line up would count the same offcut
  several times. The total rounded up is the smallest figure that is never
  short of the drawn route.
- **Why no allowance.** The rise from the ground into a tap, the sag, and the
  waste all depend on the camp's gear. A fixed margin would be a guess (§27
  Q5). The section says so in one line.
- **Why elbows for pipes and not for cables.** A cable bends. A rigid pipe needs
  an elbow at a corner. PE hose bends gently too, which is why the angles are
  shown rather than turned into a single "elbows" figure: the lead decides what
  a 23° turn needs.
- Every figure says where it came from ("מחושב מהקווים שצוירו במפה"), and the
  plot inspector's header already carries "נרשם ידנית".
- With no lines, the section is an invitation, with a button that switches to
  the line tool (§20).

---

# Part B — Shade-net ropes

## 12. The rope footprint

- **The offset** is round(h ÷ tan θ). *h* is the net's height (its own if set,
  else its kind's, as `itemHeight` gives). *θ* is its angle (its own if set,
  else the camp's net default). The offset runs outward from every edge of the
  cloth. The footprint is the cloth's rectangle grown by the offset on every
  side. It is still a rectangle, so "inside the fence" stays four comparisons
  (D5).
- **Example:** an 8 × 8 m net, 3 m high, with ropes at 45°, has an offset of
  3 m and a footprint of 14 × 14 m.
- **Range (D17): whole degrees from 20 to 80.** At 90° a rope hangs straight
  down and holds nothing. Towards 0° the stake runs off towards infinity. At 20°
  the stake sits 2.7 times the height out (8.2 m for a 3 m net), and anything
  shallower is almost certainly a typo. At 80° the stake sits 0.18 times the
  height out (53 cm for 3 m). Angles outside the range are refused in Hebrew.
- **No default until one is set (D16).** Shipping with 45° would change what
  every existing net's checks say on day one, from a number nobody measured.
  Until the camp sets its angle, a net without its own angle has no rope
  footprint and is checked by its cloth, as today. The net inspector and the
  plot inspector both ask for an angle.
- **Three nested rectangles:** shaded ground ⊂ cloth ⊂ rope footprint. The inset
  (`insetCm`) shrinks the shade inward from the cloth edge. The ropes grow the
  footprint outward from the same edge. Neither changes the other, and
  `shadedRect` does not change.
- **Ropes and stakes.** Each corner pole gets two ropes, each at right angles to
  one of its sides. That is the layout that makes the footprint a rectangle.

## 13. Data — migration `0013`

- `site_items.rope_angle_deg integer`. Null means the camp's default for nets.
  Only nets carry one: `storedPatch` clears it on any other kind, as it does
  the inset.
- `site_kind_defaults.rope_angle_deg integer`. It is read only on the `shade`
  row, and null means no default has been set.
- **Model changes:** `EditorItem.ropeAngleDeg`, `ItemPatch.ropeAngleDeg` and
  `KindSize.ropeAngleDeg` (nets only, like `insetCm`). `LOCKED_FIELDS` gains
  `ropeAngleDeg`, because the angle moves the footprint. No op is added: the
  angle travels in `update` and `setKindDefault`.
- **Setting the camp default** is a `setKindDefault` for `shade` that carries the
  current effective size and the new angle. If the camp has no net row yet,
  this writes one with the preset size, and the library tile gains its
  "changed" dot. That is true: a net default has been set.
- The refusal is prefixed `a rope angle must be` and has a Hebrew line in
  `failure-messages.ts`. `copyPlan` copies the column.

## 14. Which functions switch to the rope footprint

| Function | File | Uses | Why |
|---|---|---|---|
| `PlacedItem` | geometry.ts | gains `ropeCm` (0 for anything but a net with an angle) | the one place the offset lives |
| `ropeOffsetCm(heightCm, angleDeg)` | geometry.ts | new | D9's formula, whole cm |
| `groundRect(item)` | geometry.ts | new: the rectangle grown by `ropeCm` | the footprint |
| `inRopeBand(rect, net)` | geometry.ts | new: overlaps the net's footprint and is not wholly inside its cloth | the overlap rule for ropes |
| `unionAreaM2(rects, plot)` | geometry.ts | new | area taken |
| `outsideIds` | geometry.ts | **footprint** | the fence check (D8) |
| `overlapPairs` | geometry.ts | cloth, unchanged | nets are never part of an overlap pair; ropes get their own check |
| `shadedRect`, `shadeState`, `shadeCounts` | geometry.ts | **cloth**, unchanged | shade is cast by the cloth only (D8) |
| `gapsAround` | geometry.ts | signature unchanged; callers pass nets' footprints as obstacles | the "walkway" readouts |
| `resize`, `turnAboutCentre`, handles | geometry.ts, engine.ts | cloth | a net's size is its cloth |
| `ItemShape`, `toPlaced(item, defaults)` | derive.ts | gains height and angle; fills `ropeCm` | the offset needs the kind defaults |
| `derive(plot, items, defaults)` | derive.ts | outside by footprint; new `ropePairs` (`[netId, itemId]`) and `onRopes`; `counts.takenAreaM2` | the flags and the plot figures |
| `deriveView` | plan.ts | passes `kindDefaults` | the no-WebGL item table agrees with the editor |
| `shadeAtHour` | sun.ts | **cloth**, unchanged: casts `shadedRect`; "under a net" means under its cloth | ropes cast no shade |
| `shadeTimeline` | shade-timeline.ts | through `shadeAtHour`, unchanged | — |
| `nearestFreeSpot` | editor/placement.ts | a new net needs its footprint inside the fence; a solid item's spot must not be in any net's rope band | placing items |
| `landsClear` (duplicate) | editor/commands.ts | the same rule | duplicating items |
| `ghostVerdict` | scene/engine.ts | the same rule, with a pill for the rope band | the library's drag preview |
| `snapMoveOf` gap obstacles | scene/engine.ts | nets whose cloth the moving item does not touch count as obstacles, measured to their footprint; a moving net measures from its footprint | the "walkway" readouts |
| `geometryKey` | scene/meshes.ts | includes `ropeCm` | a rope change rebuilds the net |
| labels, marquee, fit, selection box | engine.ts | cloth | unchanged |

`use-editor-store.ts` passes `doc.defaults` to `derive`, and its flags gain
`onRopes` and `ropePairs`.

## 15. Drawing and the inspector

- **In the scene.** From the top of each corner pole, two ropes run to stakes
  one offset out, at right angles to each side. Each stake is a 3 cm peg. The
  footprint is outlined dashed on the ground in `clothEdge`, or in `bad` when
  the footprint crosses the fence. Ropes and outline are click-through, cast no
  shadow, and hide with the nets. In plan view the ropes show as eight short
  strokes from the corners, and the dashed outline shows the band.
- **The net's inspector:** the "צל" section becomes **צל וחבלים**.
  - A field, "זווית החבלים מהקרקע", in degrees. Its placeholder shows the camp's
    default, and the meta line reads "ברירת המחדל של רשתות צל" while the net
    follows that default. It is read by `readDegrees`.
  - Three rows, one per rectangle:
    - "מצל בפועל" 7 × 7 מ׳ · 49 מ״ר
    - "הבד" 8 × 8 מ׳ · 64 מ״ר
    - "עם החבלים" 14 × 14 מ׳ · 196 מ״ר, with the source line "היתדות 3 מ׳ מהבד:
      גובה 3 מ׳ ÷ tan 45°".
  - Two links: "שמירת הזווית כברירת המחדל של רשתות צל" and "חזרה לזווית ברירת
    המחדל".
  - With no angle anywhere, the section is an invitation (§20).
  - Pills: "החבלים יוצאים מהגדר" (bad) when only the footprint crosses the fence.
    "בשטח החבלים: אוהל 3, אוהל 4" (warn) is a button that selects those items.
- **Any other item** standing in a net's rope band gets the pill "בשטח החבלים של
  רשת צל 1", a button that selects both.
- **Checks bar:** a new chip, "N בשטח החבלים" (warn), whose cases are
  `ropePairs`. The problem row reads "בשטח החבלים: אוהל 3 · רשת צל 1".
- **Plot inspector.** A new row after "שטח", **שטח תפוס**: "412.5 מ״ר מתוך 624 ·
  66%", with the meta line "כולל החבלים של רשתות הצל" whenever any net has
  ropes. It selects every item it counts. Under "צל", a line reads "זווית
  החבלים: 45° לכל הרשתות"; without an angle, it is the invitation, with a
  button that selects the first net so its inspector opens on the field.
- The minimap draws each net's footprint dashed. The several-items inspector is
  unchanged (§25).

---

# Part C — An image to trace

## 16. Storage and privacy

- **One image per plan**, which means one per season's map. `copyPlan` does not
  copy it: last year's sketch is not this year's plot.
- **The file** is stored through `getStorage()`. That is `STORAGE_DRIVER=blob`
  in production and the local driver in development (`.uploads/`, which git
  ignores). The key is `site-underlays/<planId>/<sha256>.<ext>`. Because the key
  is the file's own hash, uploading the same file twice writes nothing new, and
  a replaced file keeps its own key so that undo can bring it back.
- **The row** (`site_underlays`, §17) holds the key and the placement.
- **Who can see it:** signed-in admins, who are the only users the platform has,
  working on this map. Blobs are written with `access: 'private'`, so there is
  never a public URL. The bytes reach a browser only through the `GET` route,
  which calls `requireAdmin` and serves only keys under that plan's prefix. No
  third party sees the image: there is no recognition service (D10), and nothing
  is sent to Claude. Uploads live in storage, never in git, so the repository
  being private does not come into it.
- **The PNG export** ("ייצוא תמונה") includes the image when it is shown. Hiding
  it first keeps it off the export, and the card says so.
- **Removing the image from the map does not erase the file.** Undo needs the
  file, and the storage driver has no delete. The remove toast says so, and
  erasing is out of scope (§25, §26).

**`POST /site/underlay/<planId>`.** It follows `/api/uploads`' contract: nothing
throws, the server answers with machine codes, and the client turns those into
Hebrew (§20). The checks run in this order:

1. `requireAdmin`, else 401 `unauthorized`.
2. The plan exists, else 404 `unknown plan`.
3. A file was sent, else 400 `missing file`.
4. It is at most 4 MB, else 413 `file too large`. Vercel refuses request bodies
   over 4.5 MB before the route runs, and answers in English. This is the same
   reasoning as `upload-limits.ts`.
5. Its type, read from both the bytes and the name, is PNG, JPEG or WebP. PDF,
   HEIC and anything else get 415 with the code `pdf`, `heic` or `unsupported
   file type`, so each refusal can say what to do instead.
6. Its size in pixels, read from the header by `image-facts.ts`, is 100–8192 px
   on each side, else 422 `image too small` or `image too large`.
7. `storage.put` succeeds, else 503 `storage unavailable`.
8. It answers 201 `{ storageKey, contentType, sizeBytes, filename }`.

The route writes nothing to the database: the editor saves the placement as an
op (§17).

*Why a route and not a server action:* server actions accept 1 MB request
bodies by default (`serverActions.bodySizeLimit`, in
`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`).
Raising that means editing `next.config.ts`, which is shared. The upload route
pattern already exists.

**`GET /site/underlay/<planId>/<sha256>.<ext>`:**

- `requireAdmin`, else 401.
- The name must match `^[0-9a-f]{64}\.(png|jpg|webp)$`, else 404.
- `storage.get` must succeed, else 404.
- The response carries the bytes with a `Content-Type` taken from the
  extension, `Cache-Control: private, max-age=31536000, immutable` (the name is
  the content's hash, so it never changes), and `X-Content-Type-Options:
  nosniff`.
- The response is at most 4 MB, which is under Vercel's 4.5 MB response limit.

## 17. Data — migration `0015`

```
site_underlays
  plan_id          uuid primary key → site_plans(id) on delete cascade   -- one per plan
  storage_key      text not null
  content_type     text not null           -- image/png | image/jpeg | image/webp
  size_bytes       integer not null
  filename         text not null
  centre_x_cm      integer not null        -- where the image's middle sits on the map
  centre_y_cm      integer not null
  width_cm         integer not null        -- the map length of the image's width, as displayed
  rotation_tenths  integer not null default 0   -- clockwise from above, tenths of a degree, 0–3599
  calibration      jsonb                   -- { from: [u, v], to: [u, v], distanceCm } or null
  uploaded_at      timestamptz not null default now()
  uploaded_by      text
  updated_at, updated_by
```

- **Calibration points** are fractions of the displayed image (0–1), so they
  hold whatever size the browser decodes the image at. A null calibration means
  the image has not been calibrated, and the card says so.
- **Rotation is free, in tenths of a degree,** but only calibration sets it
  (§18). D5's "quarter turns only" is about items, whose rectangles feed the
  checks. The image feeds no check.
- **The model:** `EditorDoc.underlay: EditorUnderlay | null`. `EditorUnderlay`
  mirrors the row without its timestamps.
- **The op:** `{ type: 'setUnderlay'; underlay: EditorUnderlay | null }`. Its
  inverse is the previous value. It coalesces like `setKindDefault`: the last
  value wins, in the first one's place. The server runs `underlayRefusal` to
  check the shape, checks that the key is under *this* plan's prefix, and then
  upserts or deletes the row. It writes `uploaded_at` and `uploaded_by` when the
  key changes.
- **The view (D19):** `EditorUi.underlay: { shown: boolean; opacity: number }`.
  It lives for the session and is never saved. Whenever the map has an image it
  is shown, at 50%.

## 18. Upload, calibration, alignment

1. **The invitation.** The plot inspector gets a row, **תמונת רקע**, which
   opens the card. With no image, the card is an invitation with an **העלאת
   תמונה** button; a file can also be dropped on the card. The tool-row toggle
   (step 6) appears only once the map has an image. The client checks the type and size first, by the same
   rules as the server, and decodes the image once to be sure the browser can
   show it before sending anything.
2. **Placed but not yet calibrated.** The image is centred on the plot, as wide
   as the plot, at 50% opacity. That is only a way to see it, not a scale. The
   card says "קנה המידה זמני עד הכיול", and the editor goes straight on to
   calibration. Skipping leaves the badge "לא כוילה" on the card until the image
   is calibrated.
3. **Calibration** is a tool. It switches the view to plan and back when done.
   - The lead clicks point A on the image, then point B.
   - A small form asks for the distance in metres, read by `readMetres` with
     `SIDE_RANGE` (10 cm – 500 m). It also offers **"הקו הזה מקביל לגדר"**.
   - Applying scales the image about A, so that A stays where it is on the map
     and AB on the map equals the typed distance. With the parallel box ticked,
     the image also turns about A until AB lies along the nearer map axis. This
     is how a photographed sketch gets straightened from the same two clicks,
     with no rotation dial.
   - The whole calibration is one history entry, "כיול תמונת הרקע".
   - Two points closer than 20 screen pixels are refused, and so is a point that
     is off the image.
4. **Alignment** (**הזזה** in the card).
   - Dragging the image moves it, freely, in whole centimetres.
   - The arrows nudge it by 10 cm, or by a metre with Shift.
   - **סיבוב רבע ימינה / שמאלה** turn it about its centre.
   - Esc, or **סיום**, returns to the selection tool.
   - Each drag, nudge and turn is one undo step.
5. **Tracing** needs nothing new. Outside the calibration and alignment tools
   the image is click-through, and items are placed from the library as they
   are today.
6. **Opacity** is a slider from 10% to 100% in steps of 10. The tool-row toggle
   shows and hides the image.
7. **Replacing the image** keeps its centre and width and clears the calibration,
   because the scale belonged to the old image. The card then asks for a new
   calibration.
8. **Removing the image** is `setUnderlay(null)`, with a ביטול toast.

**What the card reports:** the file name; "מכסה על המפה 31.2 × 27.6 מ׳"; and
"כויל לפי 26 מ׳ שסומנו על התמונה", with the calibration segment drawn on the
image while the card is open.

**What is not corrected:** perspective and lens distortion. A sketch
photographed at an angle stays keystoned. The upload hint suggests a scan or a
photo taken square-on.

## 19. Drawing it

- **The plane** lies on the ground at y = 1 mm and uses `MeshBasicMaterial`: it
  is unlit, so the sun and the theme never tint the sketch. It is transparent at
  the chosen opacity and writes no depth.
- **Render order −3.5:** above the ground outside the plot and the plot itself
  (−5, −4), and below the shade patches (−3), the grid (−2, −1.5), the fence
  (−1), the lines and everything that stands. It is the same in plan and in 3D.
- **The texture** is fetched from the `GET` route and decoded with
  `createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth /
  resizeHeight })`, in sRGB. The orientation option means a phone photo stands
  the way it was taken. The resize means no more than 4096 px on the long side
  (or the GPU's `maxTextureSize`, if that is smaller) ever sits in memory. The
  aspect ratio comes from the decoded image.
- **It is never mirrored.** At rotation 0 the image's left edge is the map's
  west. Nothing flips it for the page's direction, so Hebrew written on the
  sketch stays readable.
- **Clicks pass through it** (`userData.pick = false`), except in the
  calibration and alignment tools, where the engine tests the ground point
  against the image's four corners.
- **Upkeep.** The plane is rebuilt when the WebGL context comes back, and freed
  when the image is replaced or removed. While it loads, the card says "טוען…".
  If it fails to load, the card says so and offers a retry (§20).

---

## 20. Hebrew copy

Every name and number inside a Hebrew sentence is isolated (`<bdi>` or ⁦…⁩), as
the editor does today. No copy addresses the reader with a gendered verb, and no
adjective agrees with a noun that varies: the toasts put a fixed noun first
("הקו … נוסף", as "הפריט … הוסר" does today).

**Line tool**

- Tool: **קווים** `P`. Type choice (aria-label "סוג הקו"): **מים · חשמל · ניקוז**.
- Hint while waiting for a start: "קו מתחיל בלחיצה על פריט או על קו קיים · Esc —
  חזרה לבחירה"
- Hint while drawing: "לחיצה על הקרקע — כיפוף · על פריט או על קו — סיום · Enter
  — סיום כאן, עם קצה פתוח · Backspace — ביטול הכיפוף האחרון · Esc — ביטול הקו"
- Loop target: "קו לא יכול להסתעף מעצמו"
- Live pill: "קטע 3.5 מ׳ · סה״כ 12.4 מ׳"
- Toasts: "הקו צינור מים 3 נוסף למפה" · "הקו צינור מים 3 הוסר מהמפה" · "3 קווים
  הוסרו מהמפה". When lines are detached, a suffix: " · 2 קווים נשארו עם קצה
  פתוח" or " · לקו אחד נשאר קצה פתוח". The suffix is also added to an item
  removal's toast.

**Line inspector**

- Fields: "שם", "סוג", "הערות" (placeholder "למשל: צינור 3/4 אינץ׳").
- The type field when disabled: "קו שמחובר בהסתעפות לקו אחר שומר על הסוג שלו.
  אחרי ניתוק ההסתעפות אפשר לשנות אותו."
- Length: "אורך המסלול" 12.4 מ׳, with the meta line "4 קטעים: 3.5 · 4 · 2.9 · 2
  מ׳".
- Ends: "התחלה" / "סוף", followed by the item's name, or "הסתעפות מ־צינור מים 1",
  or the pill "קצה פתוח".
- Bends: "כיפופים: 2 של 90°, 1 של 45°, 1 אחר (23°)". Branches: "הסתעפויות
  מהקו: 2".

**Purchase section**

- Heading: "צנרת וכבלים".
- Figures: "לקנייה", "מסלול", "מחברי T" / "מפצלים", "זוויות 90°", "זוויות 45°",
  "זוויות אחרות", "חיבורים לפריטים". Meta line: "נבדקים: מים, חשמל".
- Note: "האורך לקנייה הוא אורך המסלולים שצוירו, מעוגל כלפי מעלה למטר שלם לכל
  סוג. לא נוספו עלייה אל הברז, רפיון או פחת."
- No source: "אין במפה מיכל מי שתייה — הקווים לא מגיעים למקור."
- Empty: "עוד לא צוירו קווים. בכלי הקווים (P) אפשר לחבר את מיכל המים למקלחות,
  את הגנרטור למקררים ואת המקלחות למיכל המים האפורים — וכאן יופיע כמה צינור וכבל
  לקנות." Button: "ציור קו".

**Line checks**

- Chips: "N חיבורים חסרים" / "חיבור חסר אחד" (title "פריטים שאין להם קו אל
  המקור: מקלחת בלי מים או ניקוז, מקרר בלי חשמל"); "N קצוות פתוחים" / "קצה פתוח
  אחד" (title "קווים שאחד הקצוות שלהם לא מחובר לשום דבר"); "N קווים מחוץ לגדר" /
  "קו אחד מחוץ לגדר".
- Rows: "בלי מים: ⟨פריט⟩", "בלי ניקוז: ⟨פריט⟩", "בלי חשמל: ⟨פריט⟩", "קצה פתוח:
  ⟨קו⟩", "מחוץ לגדר: ⟨קו⟩".
- Item pills: "בלי מים", "בלי ניקוז", "בלי חשמל". List of the item's lines:
  "קווים: …".
- List group: "צנרת וכבלים". Per-type hide: "הסתרת קווי מים", "הסתרת קווי
  חשמל", "הסתרת קווי ניקוז".

**Line refusals** (English prefix → Hebrew, in `failure-messages.ts`)

- `a line must have a label` → "לקו חייב להיות שם, אחרת אי אפשר לזהות אותו
  במפה"
- `unknown line type` → "סוג הקו הזה לא מוכר למפה"
- `a line end must be` → "קצה של קו לא נשמר כמו שצריך. טעינה מחדש של המפה תסדר
  את זה"
- `a line bend must be` → "כיפוף של קו נמדד במספר שלם של סנטימטרים, עד חצי
  קילומטר מהמגרש"
- `a line has too many bends` → "לקו יכולים להיות עד 200 כיפופים"
- `a line id must be a uuid` → "לקו החדש אין מזהה תקין. טעינה מחדש של המפה תסדר
  את זה"
- `a line id is already in use` → "הקו הזה כבר נמצא במפה. טעינה מחדש של המפה
  תסדר את זה"
- `unknown site line` → "לא מצאנו את הקו הזה במפה — אולי הוסר בינתיים"
- `a line cannot branch from itself` → "קו לא יכול להסתעף מעצמו"

**Ropes**

- Field: "זווית החבלים מהקרקע" (suffix °). Meta line: "ברירת המחדל של רשתות צל".
- Rows: "מצל בפועל", "הבד", "עם החבלים". Source line: "היתדות 3 מ׳ מהבד: גובה
  3 מ׳ ÷ tan 45°".
- Links: "שמירת הזווית כברירת המחדל של רשתות צל", "חזרה לזווית ברירת המחדל".
- Invitation on a net: "עוד לא נקבעה זווית לחבלים, ולכן הרשת נבדקת לפי הבד
  בלבד. זווית שתוקלד כאן תחול על הרשת הזו; שמירה שלה כברירת מחדל תחול על כל
  רשתות הצל."
- Refusals (`degrees.ts`, and the server's `a rope angle must be`): "צריך מספר
  שלם של מעלות — למשל 45" and "זווית החבלים היא מספר שלם של מעלות, מ־20 עד 80".
- Pills: "החבלים יוצאים מהגדר", "בשטח החבלים: …", "בשטח החבלים של ⟨רשת⟩".
- Chip: "N בשטח החבלים" (title "פריטים שעומדים בין שולי הבד של רשת צל לבין
  היתדות שלה"). Row: "בשטח החבלים: ⟨פריט⟩ · ⟨רשת⟩". Ghost pill: "בשטח החבלים של
  רשת צל".
- Plot: "שטח תפוס" with "412.5 מ״ר מתוך 624 · 66%" and the meta line "כולל
  החבלים של רשתות הצל"; "זווית החבלים: 45° לכל הרשתות"; with no angle, "זווית
  החבלים עוד לא נקבעה" with the button "קביעת זווית". Added to the "צל" hint:
  "החבלים לא מצלים — הם רק תופסים שטח."

**The image**

- Toggle and card title: "תמונת רקע".
- Empty: "אפשר להעלות צילום או סריקה של שרטוט המגרש ולהניח עליו את הפריטים
  ביד. אחרי ההעלאה, סימון של מרחק ידוע על התמונה — למשל אורך הגדר — קובע את
  קנה המידה. צילום ישר מלמעלה, או סריקה, ייתנו את התוצאה המדויקת ביותר."
  Button: "העלאת תמונה". Rules line: "PNG,‏ JPEG או WebP, עד 4 מגה־בייט".
- Status lines: "מעלה…" · "טוען…" · badge "לא כוילה" with "קנה המידה זמני עד
  הכיול." and the button "כיול".
- Calibration: "סימון הנקודה הראשונה על התמונה" → "סימון הנקודה השנייה" → "המרחק
  בין שתי הנקודות, במטרים", with the box "הקו הזה מקביל לגדר" and the buttons
  "כיול" / "ביטול". Note: "הכיול נעשה בתצוגת תוכנית." Refusals: "שתי הנקודות
  קרובות מדי זו לזו. מרחק ארוך, כמו צלע של הגדר, נותן כיול מדויק יותר." and
  "הנקודה מחוץ לתמונה."
- After calibration: "כויל לפי 26 מ׳ שסומנו על התמונה", with "כיול מחדש";
  "מכסה על המפה 31.2 × 27.6 מ׳"; "שקיפות 50%".
- Alignment: "הזזה"; hint "גרירה מזיזה את התמונה · החצים — 10 ס״מ, עם Shift —
  מטר · Esc — סיום"; "סיבוב רבע ימינה", "סיבוב רבע שמאלה", "סיום".
- Export note: "כשהתמונה מוצגת, היא נכללת גם בייצוא התמונה של המפה."
- Replace and remove: "החלפת תמונה" (with "הכיול יתחיל מחדש"), "הסרת התמונה".
  Toasts: "תמונת הרקע הוסרה מהמפה. הקובץ עצמו נשמר, כדי שאפשר יהיה לבטל." and
  "תמונת הרקע הוחלפה".
- Upload codes: `unauthorized` "אין הרשאה להעלות קבצים." · `unknown plan` "לא
  מצאנו את המפה הזו — אולי נמחקה בינתיים" · `missing file` "לא נבחר קובץ." ·
  `file too large` "התמונה גדולה מדי — עד 4 מגה־בייט." · `pdf` "קובץ PDF אי אפשר
  להעלות כרקע. צילום מסך של העמוד יעבוד." · `heic` "הדפדפן לא מציג תמונות HEIC
  (ברירת המחדל של מצלמת האייפון). שמירה כ־JPEG, או צילום מסך, יעבדו." ·
  `unsupported file type` "אפשר להעלות רק תמונה: PNG,‏ JPEG או WebP." · `image
  too large` "התמונה גדולה מדי — עד 8192 פיקסלים בכל צד." · `image too small`
  "התמונה קטנה מדי — לפחות 100 פיקסלים בכל צד." · `storage unavailable` "לא
  הצלחנו לשמור את התמונה. אפשר לנסות שוב." · anything else "ההעלאה נכשלה. אפשר
  לנסות שוב."
- Display: "לא הצלחנו להציג את התמונה. אפשר לנסות שוב, או להעלות אותה מחדש." with
  "ניסיון נוסף". File missing (404): "קובץ התמונה לא נמצא. אפשר להעלות אותו
  מחדש."
- Server prefixes: `an underlay file must be` → "קובץ תמונת הרקע לא שייך למפה
  הזו. טעינה מחדש של המפה תסדר את זה" · `an underlay placement must be` → "מיקום
  תמונת הרקע נמדד במספר שלם של סנטימטרים" · `an underlay calibration must be` →
  "הכיול של תמונת הרקע לא נשמר כמו שצריך. אפשר לכייל שוב".

## 21. The product's rules, applied

- **The system never guesses.**
  - No rope angle is assumed (D16).
  - No line type is checked before it has a line (D12).
  - A broken reference is flagged, never repaired (D13).
  - No purchase allowance is invented (D15). Bends at odd angles are shown as
    "אחרות", not ruled on.
  - A kitchen is never assumed to need water.
  - An uncalibrated image says its scale is temporary.
  - An end attached "nearest the route" and a T at "the nearest point" are
    visible placements the lead can drag, like snapping, not hidden choices.
- **Every figure links to what changes it.**
  - Purchase figures, check chips and problem rows select their lines or items.
  - Area taken selects the items it counts.
  - The rope rows sit next to the angle and height fields that change them.
  - The rope invitation opens a net's inspector.
  - A line label selects its line.
  - The image's scale opens the calibration.
- **Every number says where it came from.**
  - Purchase: "מחושב מהקווים שצוירו במפה", plus the rounding note.
  - Ropes: "גובה ÷ tan זווית", with the values.
  - Area taken: "כולל החבלים".
  - The image: "כויל לפי 26 מ׳ שסומנו על התמונה".
  - Everything else was drawn or typed by a lead and carries "נרשם ידנית".
- **An empty state is an invitation.** No lines: draw the first. No angle: set
  one. No image: upload one. An uncalibrated image: calibrate it.
- **No English on a Hebrew screen.** Every new refusal has a prefix in
  `failure-messages.ts`. The upload route answers with codes that the card
  translates, and any code it does not know falls back to Hebrew.
- **Gender-neutral Hebrew:** §20.
- **The map never mirrors:** lines and the image live in map coordinates, and
  the image is never flipped.

## 22. Testing

The suite runs with the capped command in `CLAUDE.md`, each lane on its own
paths only.

**Pure modules, written test-first**

- `lines.ts`:
  - an end on an item follows moves and resizes, and keeps its side on a turn;
  - a T slides with its host and stops at the host's end;
  - loops resolve as open ends;
  - nearest-edge attachment;
  - route length.
- `line-checks.ts`:
  - connectivity through items and T's;
  - nothing is flagged for a type with no lines;
  - a type with no source;
  - every kind of open end;
  - a line past the fence, including a corner exactly on the fence (inside).
- `line-summary.ts`:
  - rounding at 47.00 and 47.01 m;
  - T counts;
  - bends at exactly 4.9°, 5°, 85°, 95° and 40°;
  - power gets no elbows.
- `line-commands.ts`:
  - applying any command and then its inverse restores the doc;
  - removing an item detaches its ends, and undo re-attaches them;
  - removing a host detaches the lines branching from it.
- `ops.ts`: apply, invert and coalesce for the four new ops.
- `degrees.ts`: "45", " 45° ", "45.5", "", "abc", "19", "81", and a pasted bidi
  mark.
- `geometry.ts`: `ropeOffsetCm` at 20° and 80°, `groundRect`, `inRopeBand`, and
  `unionAreaM2` with overlaps and clipping.
- `derive.ts`:
  - **a net without an angle derives exactly what it did before** (D16's
    promise);
  - outside by footprint;
  - `ropePairs`.
- `underlay.ts`:
  - calibration keeps A fixed;
  - the parallel box straightens;
  - quarter turns pivot on the centre;
  - map → image → map round-trips.
- `image-facts.ts`: tiny PNG, JPEG (with SOF found after APP segments), WebP
  (VP8, VP8L and VP8X), PDF, HEIC, GIF and SVG headers.

**Database (`plan.test.ts`, pglite)**

- the three migrations;
- line ops in `applySiteOps`, including a stale version and an invalid line
  refused whole;
- a `setUnderlay` with another plan's key, refused;
- `copyPlan` copies lines with re-mapped ids and copies rope angles, but not the
  image;
- `loadDoc` returns lines and the image.

**Routes**

- `POST` against the local driver in a temporary directory: every refusal code,
  and 4 MB versus 4 MB + 1 byte.
- `GET`: admins only; a name outside the pattern gets 404; the response headers.

**Scene, without a GPU**

- line meshes built and diffed by id;
- the image plane's render order and `pick` flag;
- the rope meshes' key;
- `line-tool.ts` driven by synthetic pointer and key events.

**Panels (jsdom)**

- the line inspector;
- purchase figures and what each selects;
- the new chips;
- the rope section with its invitation;
- every state of the image card;
- the upload codes all reaching Hebrew.

**In a browser, before each part's PR** (Playwright MCP, as in Task 27; no
writes to the shared database without the camp lead's approval):

- **A:** tank → two showers with a T; generator → fridge; showers → grey-water
  tank. Check the purchase figures by hand against the segment pills.
- **B:** a net pushed past the fence by its ropes, and a tent in its rope band.
- **C:** upload the camp lead's own sketch (kept outside git), calibrate on its
  26 m arrow, and check that the fence corners line up within a grid step.
- Every part in plan and in 3D, light and dark.

**Review focus: inputs no feature test would naturally hit**

1. An item with lines attached is dragged. The ends must follow the preview
   live, and the drop must write no line op.
2. A conflict, then "save mine", with a pending `addLine` whose end names an item
   the other lead removed. The line must be kept with a flagged open end, and the
   batch must not be refused.
3. Undo of an item removal that detached a host line which had branches.
4. A net at 20° and at 80°, on its kind's height and on its own, with its
   footprint exactly flush with the fence (flush counts as inside).
5. A phone JPEG with an EXIF rotation, calibrated after decoding.

## 23. Shared surfaces touched, and the contract

For each PR body's `## Shared surfaces touched` (`protocol.md` §3):

- `drizzle/0013_*.sql`, `0014_*.sql` and `0015_*.sql`, with `drizzle/meta/*`:
  the shared migration sequence. Each is generated with `npx drizzle-kit
  generate`, never `push`, and is additive only (new columns or a new table).
  The camp lead applies each to Railway by hand with the `psql -f` procedure in
  `docs/deploy.md` §6, before the code that reads it deploys, as with `0012`.
  Each part's PR adds its record to §6.
- `docs/collab/claims.md`: a row per lane in flight.
- The interface contract in `2026-09-24-site-3d-00-overview.md` is amended
  **first**, by its own rule. The changes:
  - `model.ts`: `EditorItem.ropeAngleDeg` (B); `EditorDoc.lines` and the line
    types (A); `EditorDoc.underlay` and `EditorUnderlay` (C).
  - `defaults.ts`: `KindSize.ropeAngleDeg` (B).
  - `ops.ts`: `ItemPatch.ropeAngleDeg` and `LOCKED_FIELDS` (B); three line ops,
    `LinePatch` and `lineRefusal` (A); `setUnderlay` and `underlayRefusal` (C).
  - `geometry.ts` and `derive.ts`: §14's names, with `derive(plot, items,
    defaults)` (B).
  - `use-editor-store.ts`:
    - `EditorFlags` gains `onRopes` and `ropePairs` (B), and `lines` (A);
    - `select` keeps line ids (A).
  - `scene-view.tsx` `EditorUi`:
    - `tool` adds `'line'` (A), and `'calibrate'` and `'align'` (C);
    - new fields `lineType` and `hiddenLineTypes` (A), and `underlay` (C).
  - `gestures.ts`: the widened `tool()`, plus `lineAt` and `lineHandleAt` (A).
  - `keyboard.ts`: `'toolLine'` (A).
  - Panel props: `PlotInspector`, `ItemInspector`, `ChecksBar`, `ObjectsPanel`,
    `MultiInspector` and `Minimap`; new `LineInspector` and `UnderlayCard`.
- Not touched: `package.json` (no dependency), `next.config.ts` (the route
  avoids it), `src/lib/storage/**` (used, not changed).

Everything else is inside the camp-map area.

## 24. Dependencies between the parts, build order, and tasks

**What ties the parts together**

- **B and A.** Both extend `EditorFlags`, `derive`'s neighbours, the checks bar,
  the plot inspector's problem list and the item inspector's pills. There is no
  logical tie:
  - pipes never read the rope footprint (walking over a hose in a rope band is
    not a problem this spec checks);
  - ropes never read lines;
  - a line that ends on a net attaches to its cloth, not its footprint;
  - A's fence check for lines is its own test on route points.

  Whichever part lands second rebases those panel files.
- **A and C.** Both widen `EditorUi.tool`, `GestureWorld.tool()` and the tool
  row, and both add to `SiteOp`, `loadDoc` and `applySiteOps`. There is no data
  tie.
- **B and C.** No tie.
- All three depend on the editor being the page (on `main` since `020d5c0`).

**Suggested order: B → A → C.**

- B is about a quarter of A's size. It settles the footprint rules in
  `geometry`/`derive` that A's checks sit beside, and can be in the camp lead's
  hands soonest.
- A is the largest part.
- C touches none of the checks and could be built beside A in its own worktree.

If the order changes, **migration numbers follow the order the parts merge in**:
the later part regenerates its migration with the next free number before it
merges, so two branches never hold the same number (`ownership.md`, the
`drizzle/` row). Check `claims.md` for anyone else's migration before
generating.

**Rough task breakdown** (for the planner; the full plan comes later)

*B — ropes (~7 tasks)*

1. Schema and migration `0013`; the model and ops fields; refusal and Hebrew;
   readers, `copyPlan`.
2. `geometry.ts`: offset, footprint, band, union area.
3. `derive.ts` with defaults: outside, `ropePairs`, area taken; `deriveView`.
4. `degrees.ts`.
5. Placement, `landsClear`, the ghost verdict, gap obstacles.
6. Meshes: ropes, stakes, outline, key.
7. Panels: the net's "צל וחבלים", item pill, chip and rows, area taken, the plot
   invitation, minimap; browser check.

*A — lines (~12 tasks)*

1. Schema and migration `0014`; types; refusals and Hebrew.
2. Ops: apply, invert, coalesce.
3. `plan.ts`: `loadDoc`, `applySiteOps`, `copyPlan` re-mapping.
4. `lines.ts`: resolving and length.
5. `line-checks.ts`.
6. `line-summary.ts`.
7. `line-commands.ts`, plus `removeOps` detaching.
8. Store: selection of lines, flags, rebase.
9. `line-tool.ts` and the keyboard.
10. Scene: first a bare line on `/site` checked in a browser (the first `three/addons`
    import), then meshes, the x-ray pass, markers, handles and screen-space
    picking.
11. Labels and pills; panels: tool row, line inspector, purchase section, chips,
    list group, toasts, minimap.
12. Browser check.

*C — the image (~8 tasks)*

1. Schema and migration `0015`; the type, op and refusals.
2. `image-facts.ts` and `underlay-limits.ts`.
3. The `POST` and `GET` routes.
4. `plan.ts`: `loadDoc`, `setUnderlay`.
5. `underlay.ts` maths.
6. Scene: plane, texture, orientation, resize, order; the calibration and
   alignment tools.
7. Panels: the card and all its states, the plot row, the tool-row toggle.
8. Browser check with the camp lead's sketch.

## 25. Out of scope

- Walkways, zones and neighbouring camps (as in the editor spec's §16).
- For lines:
  - sizes and materials (¾″, 32 mm, 2.5 mm²);
  - allowances;
  - flow direction, pressure, pumps and voltage drop;
  - lines crossing items, ropes or each other;
  - locks on lines, duplicating lines;
  - lines in the no-WebGL item table;
  - editing bends with the keyboard (a line can still be selected and removed
    from the list).
- Sending the purchase list to logistics' רכש, which is @josefcohen96's area and
  a conversation for later.
- Ropes and stakes in the purchase list: eight of each per net, each rope
  √(h² + offset²) long. It is cheap to add later.
- Ropes on some sides only, poles in the middle of a side, nets tied to each
  other (§27 Q2), and the angle in the several-items inspector.
- For the image:
  - more than one image per plan;
  - PDF, HEIC, SVG and GIF;
  - perspective and lens correction;
  - erasing stored files, which needs a delete in `src/lib/storage`;
  - recognising anything in the image.

## 26. Risks

| Risk | Mitigation |
|---|---|
| `Line2` is the first `three/addons` import: bundling, types, and `LineMaterial.resolution` on resize and pixel-ratio changes | A's first scene task puts one line on `/site` and checks it in a browser before anything builds on it; `resolution` is set in `engine.resize` |
| Ropes change every map's checks on the day B ships | D16: nothing changes until an angle is set, and a `derive` test proves it |
| Plain references drift after two leads edit at once | every broken reference is a flagged open end; covered by the rebase test (review focus #2) |
| Resolving lines on every drag frame costs time | the work is linear in lines and ends; measured at 100 lines × 20 bends to stay under 2 ms |
| Vercel's 4.5 MB request and response limits | a 4 MB cap on upload, so the `GET` never serves more |
| Phone photos: EXIF rotation, HEIC, 48 MP | `imageOrientation: 'from-image'`; HEIC refused with a way forward; decoding resized to at most 4096 px |
| Unused files stay in Blob | the keys are content hashes, the files are small and private, and admins are the only ones who can reach them; a cleanup comes with a storage delete |
| A sensitive image uploaded by mistake | removing it takes it off the map at once; the toast says the file stays, and erasing needs the storage delete (§25) |
| Two leads calibrate at once | the version check turns it into the conflict banner |
| Heights now move nets' footprints (D18) | said here; the inspector's source line names the height used, and "גובה ברירת מחדל" shows when it is the kind's |

## 27. Questions for the camp lead

Recommended answer first.

1. **Rope angle when B ships: no default (recommended),** so nets are checked by
   their cloth until an angle is set. The alternative is 45°, which starts
   flagging existing nets straight away.
2. **Nets joined edge to edge: every side has ropes in v1 (recommended),** with a
   per-side "no ropes" option later. Until then, items under one net that fall in
   its neighbour's rope band are flagged.
3. **A kitchen is never required to connect (recommended).** Showers need water
   and a drain, and fridges need power. Should a kitchen be flagged without water
   too?
4. **Lights: a power line that ends on a net or the bar stands for its lights
   (recommended).** The alternative is a new `light` kind.
5. **Purchase: the bare route length, rounded up per type (recommended).** The
   alternative is a typed allowance per end, for the rise into a tap.
6. **Pipe and cable sizes: later (recommended),** as free text that the summary
   groups by.
7. **Rope angles limited to 20°–80° (recommended).**
8. **The image's opacity and visibility belong to each viewer and are not saved
   (recommended).**
9. **"Walkway check" means the gap readouts while dragging, and "area taken" is
   the union of footprints (recommended).** Neither existed, so both needed a
   definition.
10. **Build order B → A → C (recommended).**
