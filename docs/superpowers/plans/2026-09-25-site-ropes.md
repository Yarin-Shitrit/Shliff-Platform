# מפת הקאמפ — Part B, shade-net ropes: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shade net's ropes are drawn down to their stakes, and once the camp sets a rope angle, the rope edge — not the cloth — is the net's footprint for the fence check, a new rope-band check, the gap readouts while dragging and the plot's new "שטח תפוס"; shade is still cast by the cloth alone.

**Architecture:** One nullable angle column on `site_items` and one on `site_kind_defaults` (migration `0014`) travel through the existing `update` and `setKindDefault` ops — no new op. `derive.ts`'s `toPlaced(item, defaults)` turns height and angle into `PlacedItem.ropeCm`; every footprint rule in `geometry.ts` reads `groundRect(item)`, and every shade rule keeps reading the cloth. One landing rule in `placement.ts` serves the library's click, its drag preview and a duplicate. The scene draws ropes, stakes and a dashed footprint as click-through parts of the net; the panels read it all through one new file, `panels/ropes.tsx`.

**Tech Stack:** Next.js 16.3.4 (App Router), React 19.2.8, TypeScript (strict), drizzle-orm 0.45 + drizzle-kit 0.31, `three@0.186.1` (already a dependency), vitest 5 + Testing Library + pglite, CSS Modules on `src/app/tokens.css`.

**Spec:** `docs/superpowers/specs/2026-09-25-site-map-pipes-ropes-underlay-design.md` — Part B is §§12–15; the shared §§1–4 and §§20–26 bind wherever they concern B. Approved by the camp lead with every §27 recommendation. It builds on the editor spec `2026-09-24-site-map-3d-editor-design.md` and the plans `2026-09-24-site-3d-00…04`; the overview's **Interface contract** is amended by Task 1, before any code, by its own rule.

**Written against** `origin/main` at `6c92ce9`. That commit is PR #23 (@josefcohen96's `feat/site-utility-lines`), which **merged on 2026-09-25** and took migration `0013_site_lines`. Part A of the spec (pipes) is set aside: Josef built his own version of it in #23, and this plan does not touch it.

## Global Constraints

Every task's requirements include these. Copied from the spec, the approved §27 answers and `CLAUDE.md`.

- **The approved §27 answers are binding.** (Q1, D16) There is no rope angle until the camp sets one: a net with no angle of its own and no camp angle has no rope footprint and is checked by its cloth, exactly as before. (Q2) Every side of every net has ropes. (Q7, D17) Rope angles are whole degrees from 20 to 80. (Q9) "Area taken" (שטח תפוס) is the union of every item's footprint, nets with their ropes, clipped to the plot; "walkway" means the gap readouts while dragging.
- **D8:** the rope footprint is the net's footprint for the fence check, the rope-band check, the gap readouts and the area taken. **Shade is cast by the cloth only:** `shadedRect`, `shadeState`, `shadeCounts`, `shadeAtHour` and `shadeTimeline` do not change.
- **D9:** the offset is round(h ÷ tan θ), whole centimetres, outward from every edge of the cloth; h is the net's own height, else its kind's (`itemHeight`); θ is its own angle, else the camp's for nets. The footprint stays an axis-aligned rectangle.
- **D18:** a net's height now moves its footprint. Heights of other kinds are still never checked.
- **Nets are never part of an overlap pair** (`overlapPairs` is unchanged). The rope band is its own check: an item overlapping a net's footprint and not wholly under its cloth.
- **No new op.** The angle travels in `update` (`ItemPatch.ropeAngleDeg`) and in `setKindDefault` (`KindSize.ropeAngleDeg`). `LOCKED_FIELDS` gains `ropeAngleDeg`, because the angle moves the footprint. `storedPatch` clears the angle on anything that is not a net, as it does the inset.
- **Units:** every stored length is whole centimetres; angles are whole degrees; x grows east, y south, z up; the map **never mirrors for RTL**.
- **Dependencies:** none added. `package.json` is not touched. `three` is imported only under `src/app/(admin)/site/editor/scene/**` (`three-guard.test.ts`).
- **Hebrew only on screen.** The server refuses a bad angle in English with the stable prefix `a rope angle must be`; `failure-messages.ts` maps it to the same sentence `degrees.ts` shows a lead who types one. Gender-neutral Hebrew; no adjective agreeing with a variable noun. Every name and number inside a Hebrew sentence is isolated — `<bdi>` in JSX, U+2066…U+2069 inside a string that must stay a string (a `Pill`'s children are `string`).
- **The product's rules** (`CLAUDE.md`): nothing is guessed (no default angle, D16); every figure links to what changes it (the rope rows sit by the angle and height fields; "שטח תפוס" selects what it counts; the rope invitation opens a net); every number says where it came from ("היתדות 3 מ׳ מהבד: גובה 3 מ׳ ÷ tan 45°", "כולל החבלים של רשתות הצל"); an empty state is an invitation.
- **Migration `0014`**, generated with `npx drizzle-kit generate --name site_rope_angles` — **never** `drizzle-kit push`, **never** `drizzle-kit migrate` (`docs/deploy.md` §6). It is additive only. The camp lead applies it to Railway by hand with the `psql -f` procedure in `docs/deploy.md` §6, after `0013` and before the code that reads it deploys. Task 11 re-checks the number at merge time.
- **Files other PRs are changing** (the merge-risk table below): edits there are additive and small — add fields, lines and imports; do not reflow, rename, reorder or re-indent existing code. Anchor every edit on the text quoted in the step, not on a line number: #25 may land first and move lines.
- **Tests** run with the capped command, always with a unique output file, and only on the task's own paths:
  `npx vitest run <paths> --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`.
  Quote any path with `(admin)` in it (zsh). A non-zero exit with zero failures means workers died, not green; a "skipped" test with no `.skip` in its file was never run. `pgrep -fl vitest` before believing a mass red. The full suite runs once, in Task 11.
- **Typecheck** with `rtk proxy npx tsc --noEmit`; **lint** with `rtk proxy npx eslint <paths>` — through `rtk proxy`, because the RTK hook filters and mangles both (it printed `npm error could not determine executable to run` over a real lint error).
- **Read files with the Read tool, not `cat`** — the RTK hook elides lines. When a count decides something, take it with `node`, not `grep | wc -l`.
- **Git:** work only in the worktree below; stage by path, never `git add -A`; `/usr/bin/git log`, never bare `git log`.

## Review Focus

Inputs and conditions the spec implies that no feature test would naturally hit. Each has its test in the named task.

1. **A net whose rope footprint is exactly flush with the fence, at 20° and at 80°, on its kind's height and on its own** (spec §22, review focus #4). Flush counts as inside and one centimetre further is outside; the offsets are 824, 53, 1099 and 71 cm, each rounded once. → Task 6, `derive.test.ts` "counts a net flush with the fence by its ropes as inside, at 20° and 80°…".
2. **Saving sizes as the nets' default — from one net's inspector, or from a selection of nets — while the camp has a rope angle.** The sizes change and the camp's angle stays. A `KindSize` built without it would quietly put every net back to "no ropes". → Task 3, `ropes-panels.test.tsx` "the camp’s rope angle is not a size".
3. **A kind default sent by a page that predates rope angles.** #25 replays an earlier page's unsaved edits after a deploy (its review I2), so a `setKindDefault` whose size has no `ropeAngleDeg` key at all can reach the new server. It must be neither refused, which would refuse the whole batch, nor read as "no angle", which would wipe the camp's. → Task 4, `plan.test.ts` "leaves the camp’s angle as it was when a page from before rope angles saves a net’s size".
4. **The page's own views with the camp's angle: the no-WebGL item table and the plot drawer's "would be outside" count.** They must flag what the editor flags. A server read that forgets `kindDefaults` would call a net inside while the checks bar says it is not. → Task 6, `plan.test.ts` "flags a net by its ropes in the page’s own view…" and `plot-drawer.ropes.test.tsx`.
5. **Two nets edge to edge** (Q2: every side has ropes). A tent under one net that reaches into its neighbour's band is flagged in the neighbour's band, and never in its own net's. → Task 6, `derive.test.ts` "flags a tent under one net that reaches into its neighbour’s band".

---

## Where to work

- New worktree `/Users/yarin/GitProjects/Shliff_Platform-lanes/site-ropes` on a new branch `feat/site-ropes`, cut from `origin/main` at or after `6c92ce9`. **Never work in `/Users/yarin/GitProjects/Shliff_Platform`**: another session's branch lives there, and the git index is shared per tree.
- The spec is on `docs/site-map-extensions-spec` (PR #27). If `origin/main` does not have it yet, merge that branch in before Task 1 (the preflight does).

### Before Task 1

- [ ] **Preflight 1: Make the worktree**

```bash
/usr/bin/git -C /Users/yarin/GitProjects/Shliff_Platform fetch origin
/usr/bin/git -C /Users/yarin/GitProjects/Shliff_Platform worktree add -b feat/site-ropes /Users/yarin/GitProjects/Shliff_Platform-lanes/site-ropes origin/main
cd /Users/yarin/GitProjects/Shliff_Platform-lanes/site-ropes
/usr/bin/git merge-base --is-ancestor 6c92ce9 HEAD && echo "has #23"
test -f docs/superpowers/specs/2026-09-25-site-map-pipes-ropes-underlay-design.md || /usr/bin/git merge --no-edit origin/docs/site-map-extensions-spec
npm ci
```

Expected: `has #23`; the spec file exists afterwards; `npm ci` exits 0.

- [ ] **Preflight 2: Confirm migration `0014` is free**

```bash
node -e "const f=require('fs').readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort();console.log(f.length, f[f.length-1])"
```

Expected: `14 0013_site_lines.sql`. Read `docs/collab/claims.md` §3 with the Read tool: if any row names a migration `0014`, **stop and ask the camp lead** — two branches must never hold the same number (`ownership.md`, the `drizzle/` row).

- [ ] **Preflight 3: Claim the work**

Read `docs/collab/claims.md` (its §1 first). In §3 add this row under the camp-map rows, with today's date, and bump the `**updated: …**` stamp to today:

```
| @Yarin-Shitrit | Camp map — shade-net ropes (spec Part B) | `feat/site-ropes` | **active** — a net's ropes drawn to their stakes, and its rope footprint used by the fence check, a rope-band check, the gaps while dragging and "שטח תפוס" once the camp sets an angle (spec `docs/superpowers/specs/2026-09-25-site-map-pipes-ropes-underlay-design.md` §§12–15, plan `docs/superpowers/plans/2026-09-25-site-ropes.md`). Touches shared surfaces: migration **`0014_site_rope_angles`** (generated, **not applied to Railway**), `drizzle/meta/*`, this file | <today> |
```

```bash
git add docs/collab/claims.md
git commit -m "docs(collab): claim the shade-net ropes (spec Part B) and migration 0014

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Merge-risk notes

B modifies 59 existing paths (and creates 9). These are the ones other work has changed or is changing — each PR's file list (`git diff --name-only` for #23, `gh pr view --json files` for the open ones) intersected with B's, in node.

| PR | State | Paths B also edits |
|---|---|---|
| #23 `feat/site-utility-lines` | **merged as `6c92ce9`** — no merge risk left; B is written on top of it. Read #23's versions, not the spec's Part A: its lines are `{ fromId, toId, points }` between items, kinds `water` and `power` only, and it added the kinds `sink` and `light`. | `src/db/schema/site.ts`, `site.test.ts`, `drizzle/meta/_journal.json`, `scripts/land-camp-layout.ts`, `src/lib/site/{plan,plan.test,lines.test}.ts`, `editor/{model,ops,ops.test,commands,commands.test,placement.test,shade-timeline.test,sun.test}.ts`, `failure-messages.ts`, `page.tsx`, `page.test.tsx`, `use-editor-store.ts` and its two tests, the three `site-editor.*.test.tsx`, `scene/{engine,meshes,scene-sync}.ts`, `scene/{scene-sync,picking,lines.scene}.test.ts`, `scene-view.test.tsx`, `panels/{inspector-item,inspector-plot,minimap}.tsx`, `minimap.module.css`, and the tests of `inspector-item`, `inspector-multi`, `inspector-plot`, `inspector-line`, `checks-bar`, `minimap`, `objects-panel`, `library-panel`, `lines-panels`, plus `docs/deploy.md` and `docs/collab/claims.md` |
| #25 `fix/site-map-take-up` (hotfix) | **open**, based before #23 | `plan.ts` (`applySiteOps`: skips missing items, `skipped` in the result), `ops.ts` (`SaveResult.skipped`), `failure-messages.ts` (an import and the locked row), `use-editor-store.ts` (imports, `pending`, `run` returns boolean, `pendingOps`, `onSkipped`), `plot-drawer.tsx` (the north hint), `panels/inspector-item.tsx` (an import and the locked hint), `panels/inspector-plot.tsx` (an import and the empty-map hint), the overview plan (the contract, lines 217–403); tests `plan.test.ts`, `use-editor-store.test.ts`, `save-queue.test.ts`, `site-editor.test.tsx`, `site-editor.saving.test.tsx`, `scene-view.test.tsx`, `inspector-item.test.tsx`, `inspector-plot.test.tsx`, `objects-panel.test.tsx`, `library-panel.test.tsx`. B's hunks in these files are at least three unchanged lines away from #25's, except in test fixtures, where each is one added field. |
| #24 `feat/site-map-3d-sim` | open | `scene/engine.ts` (#24's hunks: the light and sync, around lines 160–280 and 750–800; B's: imports, the ghost, the gaps), `scene-view.test.tsx`, `site-editor.test.tsx`, `shade-timeline.test.ts`, `sun.test.ts` (fixtures only) |
| #26 `feat/site-map-3d-switch` | open | `scene/engine.ts` (#26's hunk: `setGhost`, which B does not change), `page.tsx` (#26 rewrites around lines 101–167; B adds one prop to `PlotDrawer` below that), `page.test.tsx`, `plan.test.ts`, `scene-view.test.tsx`, `site-editor.test.tsx`, `site-editor.saving.test.tsx`, `site-editor.no-webgl.test.tsx` |

Whichever of #24/#25/#26 lands first, rebase onto it before the task that edits the shared file, and re-read the file with the Read tool before editing.

## File map

| Path | Task | Responsibility |
|---|---|---|
| `src/lib/site/editor/degrees.ts` (new) | 1 | typed whole degrees in, a Hebrew refusal out; the 20–80 range |
| `docs/superpowers/plans/2026-09-24-site-3d-00-overview.md` | 1 | the interface contract, amended first |
| `src/db/schema/site.ts`, `drizzle/0014_site_rope_angles.sql` (generated), `drizzle/meta/*` | 2 | two nullable `rope_angle_deg` columns |
| `src/lib/site/defaults.ts`, `editor/model.ts`, `editor/ops.ts`, `editor/commands.ts` | 3 | the angle in `KindSize`, `EditorItem`, `ItemPatch`; its refusals, its lock, its kind rule |
| `src/lib/site/plan.ts` | 3, 4, 6 | reads (3), writes and copies (4), and the page's view with the camp's defaults (6) |
| `src/app/(admin)/site/editor/panels/inspector-item.tsx`, `inspector-multi.tsx` | 3, 5, 9 | saving sizes keeps the camp's angle (3); the net's "צל וחבלים" (9) |
| `src/app/(admin)/site/failure-messages.ts` | 4 | the Hebrew for `a rope angle must be` |
| `src/app/(admin)/site/editor/use-editor-store.ts` | 4, 6 | "mine" replays an angle (4); the flags `onRopes`, `ropePairs` (6) |
| `src/lib/site/geometry.ts` | 5 | `ropeCm`, the offset, the footprint, the band, the union area, the gap obstacles; `outsideIds` by footprint |
| `src/lib/site/derive.ts` | 5, 6 | `toPlaced(item, defaults)` (5); `derive(plot, items, defaults)`, `ropePairs`, "שטח תפוס" (6) |
| `src/app/(admin)/site/plot-drawer.tsx`, `page.tsx` | 5, 6 | the drawer's outside count with the camp's defaults |
| `src/lib/site/editor/placement.ts` | 7 | `landingRule`, and `nearestFreeSpot` through it |
| `src/app/(admin)/site/editor/scene/engine.ts` | 7 | the ghost's verdict and the gap readouts |
| `src/app/(admin)/site/editor/scene/meshes.ts`, `scene-sync.ts` | 8 | ropes, stakes and the dashed footprint; the key |
| `src/app/(admin)/site/editor/panels/ropes.tsx` (new) | 9, 10 | every rope piece of the panels |
| `src/app/(admin)/site/editor/panels/inspector.module.css` | 9 | `.suffixed` — the angle box's "°" |
| `src/app/(admin)/site/editor/panels/inspector-plot.tsx`, `checks-bar.tsx`, `minimap.tsx`, `minimap.module.css` | 10 | area taken, the plot's angle line, the rope rows, the chip, the minimap's footprint |
| `docs/deploy.md`, `docs/collab/claims.md` | 11 | the `0014` record; the claim |
| New tests: `editor/degrees.test.ts`, `derive.test.ts`, `use-editor-store.ropes.test.ts`, `plot-drawer.ropes.test.tsx`, `panels/ropes-panels.test.tsx` | 1–10 | — |
| Fixture sweeps: every test that builds an `EditorItem`, `SiteItem`, `KindSize`, `EditorFlags` or `SiteCounts`, and `scripts/land-camp-layout.ts` | 3, 5, 6 | the new fields, one per literal |

---

### Task 1: `degrees.ts` — typed whole degrees in, a Hebrew refusal out

**Files:**
- Modify: `docs/superpowers/plans/2026-09-24-site-3d-00-overview.md` (append a section at the end)
- Create: `src/lib/site/editor/degrees.ts`
- Create: `src/lib/site/editor/degrees.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MIN_ROPE_ANGLE_DEG = 20`, `MAX_ROPE_ANGLE_DEG = 80`; `isRopeAngle(value: unknown): value is number`; `NOT_WHOLE_DEGREES: string`; `ROPE_ANGLE_OUT_OF_RANGE: string`; `type DegreesReading = { ok: true; deg: number | null } | { ok: false; error: string }`; `readDegrees(text: string): DegreesReading`. Task 3's `ops.ts` uses `isRopeAngle`; Task 9's inspector reads every typed angle with `readDegrees`.

- [ ] **Step 1: Amend the interface contract first**

The overview's contract says a change to a signature is a change to it first. Append this section at the very end of `docs/superpowers/plans/2026-09-24-site-3d-00-overview.md` (after the last amendment block, leaving one blank line):

```markdown
### Amendments for Part B — shade-net ropes (plan `2026-09-25-site-ropes.md`; additive; binding)

Spec `2026-09-25-site-map-pipes-ropes-underlay-design.md` §§12–15 and §23, with the camp lead's §27 answers. Written on `origin/main` at `6c92ce9` (#23's utility lines).

- `editor/degrees.ts` (new): `MIN_ROPE_ANGLE_DEG = 20`, `MAX_ROPE_ANGLE_DEG = 80`, `isRopeAngle(value: unknown): value is number`, `NOT_WHOLE_DEGREES`, `ROPE_ANGLE_OUT_OF_RANGE`, `type DegreesReading = { ok: true; deg: number | null } | { ok: false; error: string }`, `readDegrees(text: string): DegreesReading`. Panels read every typed angle with `readDegrees`; no panel writes its own angle refusal.
- `model.ts`: `EditorItem.ropeAngleDeg: number | null` — nets only; null follows the camp's angle. `defaults.ts`: `KindSize.ropeAngleDeg: number | null` — read on the `shade` row only; `presetSize` gives null.
- `ops.ts`: `ItemPatch.ropeAngleDeg?: number | null`. `patchRefusal`, `newItemRefusal` and `kindSizeRefusal` refuse an angle that is not a whole 20–80 with the prefix `a rope angle must be`; a `KindSize` with no `ropeAngleDeg` key (a page older than rope angles) is not refused. `LOCKED_FIELDS` gains `ropeAngleDeg`. `storedPatch` stores `ropeAngleDeg: null` whenever the kind is not `shade` and the patch sets a kind or an angle. No op is added.
- `commands.ts`: `addOps` gives a new item `ropeAngleDeg: null`. `setKindDefaultOps` keeps a net's angle and stores null for any other kind. `duplicateOps` lands copies by `placement.ts`'s `landingRule`.
- `geometry.ts`: `PlacedItem.ropeCm: number`; `ropeOffsetCm(heightCm, angleDeg)`; `groundRect(item)`; `inRopeBand(rect, net)`; `ropeBandPairs(items)`; `unionAreaM2(rects, plot)`; `gapObstacles(others, moving)`. `outsideIds` measures `groundRect`. `overlapPairs`, `shadedRect`, `shadeState`, `shadeCounts`, `gapsAround`, `resize` and `turnAboutCentre` are unchanged.
- `derive.ts`: `ItemShape` gains `heightCm` and `ropeAngleDeg`; `ropeCmOf(item, defaults)`; `toPlaced(item, defaults = {})`; `derive(plot, items, defaults = {})` adds `ropePairs: Array<[netId, itemId]>` and `counts.takenAreaM2`; `interface TakenArea { areaM2; ids; withRopes }`, `takenArea(plot, placed)`.
- `plan.ts`: `SiteItem.ropeAngleDeg`; `deriveView(plan, items, lines = [], defaults = {})`; `siteView` passes `kindDefaults`. A `setKindDefault` whose size has no `ropeAngleDeg` key leaves the stored angle as it was.
- `placement.ts`: `type Landing = 'ok' | 'outside' | 'overlapping' | 'ropes'`; `type Lander = Pick<EditorItem, 'kind' | 'heightCm' | 'ropeAngleDeg'>`; `landingRule(doc): (entry: Lander, rect: Rect) => Landing`. `nearestFreeSpot`'s signature is unchanged.
- `use-editor-store.ts`: `EditorFlags` gains `onRopes: Set<string>` and `ropePairs: Array<[string, string]>`.
- `scene/meshes.ts`: `geometryKey(item, heightCm, ropeCm = 0)`, `buildItemObject(item, heightCm, look, ropeCm = 0)`; new parts `rope`, `stake`, `ropeEdge`, all `userData.pick === false`.
- `plot-drawer.tsx`: `PlotDrawer` gains `defaults?: KindDefaults`.
- Panels: new `panels/ropes.tsx` — `campRopeAngle(doc)`, `outsideText(doc, item)`, `RopePills({ doc, item, flags, onPickIds })`, `RopeSection({ doc, item, onRun })`, `PlotTaken({ doc, onPickIds })`, `PlotRopes({ doc, onPickIds })`, `ropeProblems(doc, flags)`. `ItemInspector`, `PlotInspector`, `MultiInspector`, `ChecksBar` and `Minimap` keep their props.
- The camp's angle, typed into a net's box, leaves the net on the camp's angle (null), as ruling P13 does for a height.
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/site/editor/degrees.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  MAX_ROPE_ANGLE_DEG, MIN_ROPE_ANGLE_DEG, NOT_WHOLE_DEGREES, ROPE_ANGLE_OUT_OF_RANGE, isRopeAngle, readDegrees,
} from './degrees';

/** Everything a lead might type into the box, including what spec §22 names. */
const TYPED = ['45', ' 45° ', '45.5', '', 'abc', '19', '81', '‏45', '20', '80', '-30', '45,5', '+45'];

describe('typed rope angles', () => {
  it('reads whole degrees, with spaces and a degree sign around them', () => {
    expect(readDegrees('45')).toEqual({ ok: true, deg: 45 });
    expect(readDegrees(' 45° ')).toEqual({ ok: true, deg: 45 });
    expect(readDegrees('45 °')).toEqual({ ok: true, deg: 45 });
    expect(readDegrees('045')).toEqual({ ok: true, deg: 45 });
  });

  it('ignores a direction mark pasted in from a Hebrew document', () => {
    expect(readDegrees('‏45')).toEqual({ ok: true, deg: 45 });
    expect(readDegrees('⁦45⁩°')).toEqual({ ok: true, deg: 45 });
  });

  it('reads an empty box as "leave it as it is"', () => {
    expect(readDegrees('')).toEqual({ ok: true, deg: null });
    expect(readDegrees('   ')).toEqual({ ok: true, deg: null });
  });

  it('takes both ends of the range, and refuses one past either, in Hebrew', () => {
    expect(readDegrees('20')).toEqual({ ok: true, deg: 20 });
    expect(readDegrees('80')).toEqual({ ok: true, deg: 80 });
    for (const text of ['19', '81', '0', '90', '-30']) {
      expect(readDegrees(text)).toEqual({ ok: false, error: ROPE_ANGLE_OUT_OF_RANGE });
    }
  });

  it('refuses what is not a whole number of degrees', () => {
    for (const text of ['45.5', '45,5', 'abc', '4 5', '45°°', '٤٥', '1e2', '+45']) {
      expect(readDegrees(text)).toEqual({ ok: false, error: NOT_WHOLE_DEGREES });
    }
  });

  it('answers in Hebrew or with a whole number, never NaN and never English', () => {
    for (const text of TYPED) {
      const reading = readDegrees(text);
      if (reading.ok) {
        expect(reading.deg === null || Number.isInteger(reading.deg)).toBe(true);
      } else {
        expect(reading.error).toMatch(/[֐-׿]/);
        expect(reading.error).not.toMatch(/[A-Za-z]/);
      }
    }
  });

  it('keeps the range the spec sets (D17), for the ops and the server too', () => {
    expect([MIN_ROPE_ANGLE_DEG, MAX_ROPE_ANGLE_DEG]).toEqual([20, 80]);
    expect(isRopeAngle(20)).toBe(true);
    expect(isRopeAngle(80)).toBe(true);
    for (const value of [19, 81, 45.5, Number.NaN, '45', null, undefined]) expect(isRopeAngle(value)).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/lib/site/editor/degrees.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `Cannot find module './degrees'`; `Test Files 1 failed`, no tests run.

- [ ] **Step 4: Implement**

Create `src/lib/site/editor/degrees.ts`:

```ts
/**
 * Angles a lead types, in whole degrees: a shade net's rope angle (spec
 * §12, D17). Read the way `metres.ts` reads lengths — spaces around the
 * number, and a direction mark carried in by a paste from a Hebrew document,
 * are nothing; a trailing "°" is the unit, not a typo — and checked against
 * the one range the map allows.
 *
 * Why 20° to 80°: at 90° a rope hangs straight down and holds nothing;
 * towards 0° the stake runs off towards infinity. At 20° the stake stands
 * 2.7 times the net's height out (8.2 m for a 3 m net), and anything
 * shallower is almost certainly a typo; at 80° it stands 0.18 times the
 * height out (53 cm).
 *
 * The refusals are Hebrew here because they never travel: the inspector
 * shows them under the box. The server's own refusal (`ops.ts`, prefix
 * `a rope angle must be`) maps to the same sentence in `failure-messages.ts`.
 */

/** Left-to-right and right-to-left marks and embeddings a Hebrew page can carry into a pasted number. */
const DIRECTION_MARKS = /[‎‏‪-‮⁦-⁩]/g;
const WHOLE = /^-?\d+$/;

export const MIN_ROPE_ANGLE_DEG = 20;
export const MAX_ROPE_ANGLE_DEG = 80;

/** A rope angle the map accepts: a whole number of degrees from 20 to 80. */
export function isRopeAngle(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_ROPE_ANGLE_DEG && value <= MAX_ROPE_ANGLE_DEG;
}

export const NOT_WHOLE_DEGREES = 'צריך מספר שלם של מעלות — למשל 45';

/** Each number isolated (U+2066…U+2069), so it keeps its place in a right-to-left sentence (spec §20). */
export const ROPE_ANGLE_OUT_OF_RANGE =
  `זווית החבלים היא מספר שלם של מעלות, מ־⁦${MIN_ROPE_ANGLE_DEG}⁩ עד ⁦${MAX_ROPE_ANGLE_DEG}⁩`;

export type DegreesReading = { ok: true; deg: number | null } | { ok: false; error: string };

/**
 * A typed rope angle: an empty box is null ("leave it as it is", as
 * `readMetres` reads one), a whole number from 20 to 80 is that number, and
 * anything else is a Hebrew refusal. Never `NaN`.
 */
export function readDegrees(text: string): DegreesReading {
  const cleaned = text.replace(DIRECTION_MARKS, '').trim().replace(/°$/, '').trim();
  if (cleaned === '') return { ok: true, deg: null };
  if (!WHOLE.test(cleaned)) return { ok: false, error: NOT_WHOLE_DEGREES };
  const deg = Number(cleaned);
  return isRopeAngle(deg) ? { ok: true, deg } : { ok: false, error: ROPE_ANGLE_OUT_OF_RANGE };
}
```

- [ ] **Step 5: Run the test**

Run the Step 3 command. Expected: 7 passed, exit 0.

- [ ] **Step 6: Typecheck and lint**

Run: `rtk proxy npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint src/lib/site/editor/degrees.ts src/lib/site/editor/degrees.test.ts` — expected no errors.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-09-24-site-3d-00-overview.md src/lib/site/editor/degrees.ts src/lib/site/editor/degrees.test.ts
git commit -m "feat(site): typed rope angles — whole degrees from 20 to 80, refused in Hebrew

The overview's interface contract gains Part B's names first, by its own rule.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Schema and migration `0014`

**Files:**
- Modify: `src/db/schema/site.ts` (`siteItems`, `siteKindDefaults`)
- Modify: `src/db/schema/site.test.ts` (append)
- Create (generated): `drizzle/0014_site_rope_angles.sql`, `drizzle/meta/0014_snapshot.json`; Modify (generated): `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: nothing new.
- Produces: `siteItems.ropeAngleDeg` and `siteKindDefaults.ropeAngleDeg`, both `integer`, nullable, column `rope_angle_deg`. Task 3 reads them; Task 4 writes them.

- [ ] **Step 1: Write the failing schema test**

Append to `src/db/schema/site.test.ts`:

```ts
describe('site schema, migration 0014 — rope angles', () => {
  let db: TestDb;
  let planId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [season] = await db.insert(seasons).values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    const [plan] = await db.insert(sitePlans).values({ seasonId: season.id, widthCm: 2600, depthCm: 2400 }).returning();
    planId = plan.id;
  });

  it('gives an item no rope angle of its own by default, and keeps one when given', async () => {
    const [tent] = await db.insert(siteItems).values({
      planId, kind: 'tent', label: 'אוהל 1', xCm: 0, yCm: 0, widthCm: 300, depthCm: 300,
    }).returning();
    expect(tent.ropeAngleDeg).toBeNull();
    const [net] = await db.insert(siteItems).values({
      planId, kind: 'shade', label: 'רשת צל 1', xCm: 0, yCm: 0, widthCm: 800, depthCm: 800, insetCm: 50, ropeAngleDeg: 45,
    }).returning();
    expect(net.ropeAngleDeg).toBe(45);
  });

  it('gives the nets’ default no rope angle until one is set', async () => {
    await db.insert(siteKindDefaults).values({ kind: 'shade', widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50 });
    const [unset] = await db.select().from(siteKindDefaults).where(eq(siteKindDefaults.kind, 'shade'));
    expect(unset.ropeAngleDeg).toBeNull();
    await db.update(siteKindDefaults).set({ ropeAngleDeg: 45 }).where(eq(siteKindDefaults.kind, 'shade'));
    const [set] = await db.select().from(siteKindDefaults).where(eq(siteKindDefaults.kind, 'shade'));
    expect(set.ropeAngleDeg).toBe(45);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/db/schema/site.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: the two new tests FAIL — `expected undefined to be null` (drizzle drops the unknown key and the row has no such column); the six existing tests pass.

- [ ] **Step 3: Extend the schema**

In `src/db/schema/site.ts`, in `siteItems`, right after the `heightCm: integer('height_cm'),` line (and its comment above it), add:

```ts
  /**
   * Shade nets only: the angle the net's ropes make with the ground, whole
   * degrees from 20 to 80 (migration `0014`). Null means the camp's angle for
   * nets (`site_kind_defaults`), and while the camp has none, the net has no
   * rope footprint and is checked by its cloth (spec D16). Null on anything
   * that is not a net, like `insetCm`.
   */
  ropeAngleDeg: integer('rope_angle_deg'),
```

In `siteKindDefaults`, right after `insetCm: integer('inset_cm'),` add:

```ts
  /** Read on the `shade` row only: the camp's rope angle for nets. Null means none has been set (spec D16). */
  ropeAngleDeg: integer('rope_angle_deg'),
```

- [ ] **Step 4: Generate the migration**

```bash
npx drizzle-kit generate --name site_rope_angles
```

Never `drizzle-kit push`, never `drizzle-kit migrate` (`docs/deploy.md` §6). Expected: a new `drizzle/0014_site_rope_angles.sql`. Read it with the Read tool; it must contain exactly these two statements (their order may differ):

```sql
ALTER TABLE "site_items" ADD COLUMN "rope_angle_deg" integer;--> statement-breakpoint
ALTER TABLE "site_kind_defaults" ADD COLUMN "rope_angle_deg" integer;
```

Anything else in the file — a `DROP`, a `SET NOT NULL`, a table it did not ask for — means the schema and the snapshots disagree: stop and ask. If the file is numbered anything but `0014`, `origin/main` has moved: `/usr/bin/git fetch origin && /usr/bin/git merge origin/main`, delete the three generated changes (`git checkout -- drizzle/meta/_journal.json`, remove the new `.sql` and snapshot), and generate again.

Count the migrations with a tool the RTK hook cannot touch:

```bash
node -e "const f=require('fs').readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort();console.log(f.length, f[f.length-1])"
node -e "const j=require('./drizzle/meta/_journal.json');console.log(j.entries.length, j.entries[j.entries.length-1].tag)"
```

Expected: `15 0014_site_rope_angles.sql` and `15 0014_site_rope_angles`.

- [ ] **Step 5: Run the schema test**

Run the Step 2 command. Expected: 8 passed, exit 0. (`createTestDb` applies every `drizzle/*.sql`, so the new columns exist.)

- [ ] **Step 6: Typecheck**

Run: `rtk proxy npx tsc --noEmit` — expected exit 0. (Nothing reads the columns yet.)

- [ ] **Step 7: Commit**

```bash
git add src/db/schema/site.ts src/db/schema/site.test.ts drizzle/0014_site_rope_angles.sql drizzle/meta/0014_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(site): migration 0014 — a shade net's rope angle, and the camp's

Two nullable columns; null is no angle, so no net's checks change until the
camp sets one (spec D16). Generated with drizzle-kit generate; applying it to
Railway is the camp lead's step (docs/deploy.md §6).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The angle in the editor's model, ops and commands — and the fixtures that build them

**Files:**
- Modify: `src/lib/site/defaults.ts` (`KindSize`, `presetSize`)
- Modify: `src/lib/site/editor/model.ts` (`EditorItem`)
- Modify: `src/lib/site/editor/ops.ts` (an import; `ItemPatch`; `patchRefusal`, `newItemRefusal`, `kindSizeRefusal`; `LOCKED_FIELDS`; `storedPatch`)
- Modify: `src/lib/site/editor/commands.ts` (`addOps`, `sameSize`, `setKindDefaultOps`)
- Modify: `src/lib/site/plan.ts` (the readers only: `SiteItem`, `ITEM_COLUMNS`, `kindDefaults`, `toEditorItem`)
- Modify: `src/app/(admin)/site/editor/panels/inspector-item.tsx` (`saveAsDefault`), `inspector-multi.tsx` (`agreedSize`)
- Modify (tests): `src/lib/site/defaults.test.ts`, `editor/ops.test.ts`, `editor/commands.test.ts`, `plan.test.ts` (append)
- Create: `src/app/(admin)/site/editor/panels/ropes-panels.test.tsx`
- Modify (fixture sweep, compiler-driven): every test that builds an `EditorItem`, `SiteItem` or `KindSize`, and `scripts/land-camp-layout.ts`

**Interfaces:**
- Consumes: `isRopeAngle` (Task 1); `siteItems.ropeAngleDeg`, `siteKindDefaults.ropeAngleDeg` (Task 2).
- Produces: `KindSize.ropeAngleDeg: number | null` (`presetSize` → null); `EditorItem.ropeAngleDeg: number | null`; `ItemPatch.ropeAngleDeg?: number | null`; `SiteItem.ropeAngleDeg: number | null`; refusals with the prefix `a rope angle must be`; `LOCKED_FIELDS` including `'ropeAngleDeg'`; `storedPatch` clearing the angle off anything that is not a net; `addOps` → `ropeAngleDeg: null`; `setKindDefaultOps` keeping a net's angle and nulling any other kind's; `kindDefaults(db)` reading the angle on the `shade` row only; `toEditorItem` carrying it. Nothing writes the column yet — Task 4 does.

- [ ] **Step 1: Write the failing tests**

In `src/lib/site/defaults.test.ts`, append inside `describe('kind defaults', …)`, after its last `it`:

```ts
  it('have no rope angle until the camp sets one, and then the nets’ angle is the camp’s (spec D16)', () => {
    expect(presetSize('shade').ropeAngleDeg).toBeNull();
    const defaults = { shade: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } };
    expect(effectiveSize('shade', defaults).ropeAngleDeg).toBe(45);
    expect(effectiveSize('tent', defaults).ropeAngleDeg).toBeNull();
  });
```

In `src/lib/site/editor/ops.test.ts`, add `LOCKED_FIELDS` to the import from `./ops` (so its list begins `applyOps, coalesceOps, invertOps, kindSizeRefusal, LOCKED_FIELDS, …`), add `import type { KindSize } from '../defaults';` under `import type { SiteLinePoint } from '@/db/schema/site';`, and append at the end of the file:

```ts
describe('a shade net’s rope angle', () => {
  it('is refused unless it is whole degrees from 20 to 80; null follows the camp’s', () => {
    for (const bad of [19, 81, 45.5, 0, -45]) expect(patchRefusal({ ropeAngleDeg: bad })).toMatch(/^a rope angle must be/);
    for (const good of [20, 45, 80, null]) expect(patchRefusal({ ropeAngleDeg: good })).toBeNull();
    expect(newItemRefusal(item({ kind: 'shade', insetCm: 50, ropeAngleDeg: 90 }))).toMatch(/^a rope angle must be/);
  });

  it('is refused in a kind default the same way; a default from a page older than angles, with no angle at all, is not', () => {
    const nets: KindSize = { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 };
    expect(kindSizeRefusal(nets)).toBeNull();
    expect(kindSizeRefusal({ ...nets, ropeAngleDeg: 81 })).toMatch(/^a rope angle must be/);
    const older = { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50 } as unknown as KindSize;
    expect(kindSizeRefusal(older)).toBeNull();
  });

  it('is held by a lock, like everything that moves a footprint', () => {
    expect(LOCKED_FIELDS).toContain('ropeAngleDeg');
    expect(lockRefusal(true, { ropeAngleDeg: 45 })).toBe('that item is locked');
    expect(lockRefusal(true, { ropeAngleDeg: 45, locked: false })).toBeNull();
  });

  it('belongs to nets only: a kind change, or a stray angle on anything else, is stored as none', () => {
    const roped = item({ kind: 'shade', insetCm: 50, ropeAngleDeg: 45 });
    expect(storedPatch(roped, { kind: 'tent' })).toMatchObject({ kind: 'tent', insetCm: null, ropeAngleDeg: null });
    expect(storedPatch(item(), { ropeAngleDeg: 45 }).ropeAngleDeg).toBeNull();
    expect(storedPatch(roped, { ropeAngleDeg: 30 }).ropeAngleDeg).toBe(30);
    expect(storedPatch(roped, { label: 'רשת הבר' })).not.toHaveProperty('ropeAngleDeg');
  });
});
```

In `src/lib/site/editor/commands.test.ts`, append at the end of the file:

```ts
describe('a shade net’s rope angle', () => {
  const ROPED = make({
    id: 'n1', kind: 'shade', label: 'רשת צל 2', xCm: 100, yCm: 1200, widthCm: 800, depthCm: 800,
    insetCm: 50, ropeAngleDeg: 45, sort: 6,
  });
  const WITH_ROPED: EditorDoc = { ...DOC, items: [...DOC.items, ROPED] };
  const NETS_45 = { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 };

  it('starts a new net on the camp’s angle, not on a copy of it', () => {
    const [op] = addOps(DOC, 'shade', { xCm: 0, yCm: 1500 }, 'n9');
    expect(op).toMatchObject({ type: 'add', item: { ropeAngleDeg: null } });
  });

  it('clears the angle when a roped net becomes a tent, and an undo brings it back', () => {
    const ops = patchOps(WITH_ROPED, 'n1', { kind: 'tent' });
    expect(ops).toEqual([{ type: 'update', id: 'n1', patch: { kind: 'tent', insetCm: null, ropeAngleDeg: null } }]);
    const turned = applyOps(WITH_ROPED, ops).doc;
    const undone = applyOps(turned, invertOps(WITH_ROPED, ops)).doc;
    expect(undone.items.find((entry) => entry.id === 'n1')).toEqual(ROPED);
  });

  it('keeps a locked net’s angle until the same patch unlocks it', () => {
    const locked: EditorDoc = {
      ...WITH_ROPED, items: WITH_ROPED.items.map((entry) => (entry.id === 'n1' ? { ...entry, locked: true } : entry)),
    };
    expect(patchOps(locked, 'n1', { ropeAngleDeg: 30 })).toEqual([]);
    expect(patchOps(locked, 'n1', { ropeAngleDeg: 30, locked: false })).toEqual([
      { type: 'update', id: 'n1', patch: { ropeAngleDeg: 30, locked: false } },
    ]);
  });

  it('stores the camp’s angle with the nets’ default, never with another kind’s, and an angle alone is a change', () => {
    expect(setKindDefaultOps(DOC, 'shade', NETS_45)).toEqual([{ type: 'setKindDefault', kind: 'shade', size: NETS_45 }]);
    expect(setKindDefaultOps(DOC, 'tent', { widthCm: 300, depthCm: 300, heightCm: 200, insetCm: null, ropeAngleDeg: 45 })).toEqual([
      { type: 'setKindDefault', kind: 'tent', size: { widthCm: 300, depthCm: 300, heightCm: 200, insetCm: null, ropeAngleDeg: null } },
    ]);
    const withNets = { ...DOC, defaults: { shade: NETS_45 } };
    expect(setKindDefaultOps(withNets, 'shade', { ...NETS_45, ropeAngleDeg: 30 })).toHaveLength(1);
    expect(setKindDefaultOps(withNets, 'shade', { ...NETS_45 })).toEqual([]);
  });

  it('copies a net’s own angle with the net', () => {
    const { ops } = duplicateOps(WITH_ROPED, ['n1'], ids('c1'));
    expect(ops[0]).toMatchObject({ type: 'add', item: { ropeAngleDeg: 45 } });
  });
});
```

Append at the end of `src/lib/site/plan.test.ts`:

```ts
/* ── shade-net ropes (migration 0014) ──────────────────────────────────── */

describe('the camp map’s rope angles', () => {
  let db: TestDb;
  let s26: string;
  let planId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [season] = await db.insert(seasons).values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    s26 = season.id;
    planId = await createPlan(db, s26, PLOT, LEAD);
  });

  /** One saved batch against the map's version now. `toMatchObject`, because the result may carry more than its status (#25 adds `skipped`). */
  async function save(ops: SiteOp[]): Promise<void> {
    const plan = await planById(db, planId);
    if (plan === null) throw new Error(`no map ${planId}`);
    expect(await applySiteOps(db, planId, plan.version, ops, LEAD)).toMatchObject({ status: 'saved' });
  }

  const netOf = (over: Partial<EditorItem> = {}): EditorItem => tentOf({
    kind: 'shade', label: 'רשת צל 1', widthCm: 800, depthCm: 800, insetCm: 50, ...over,
  });

  it('reads a net’s own angle into the list and into the editor’s document', async () => {
    const net = netOf();
    await save([{ type: 'add', item: net }]);
    await db.update(siteItems).set({ ropeAngleDeg: 45 }).where(eq(siteItems.id, net.id));
    expect((await listItems(db, planId))[0].ropeAngleDeg).toBe(45);
    expect((await loadDoc(db, planId))?.doc.items[0].ropeAngleDeg).toBe(45);
  });

  it('reads the camp’s angle from the nets’ row only', async () => {
    await db.insert(siteKindDefaults).values([
      { kind: 'shade', widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 },
      { kind: 'tent', widthCm: 300, depthCm: 300, heightCm: 200, ropeAngleDeg: 45 },
    ]);
    const defaults = await kindDefaults(db);
    expect(defaults.shade?.ropeAngleDeg).toBe(45);
    expect(defaults.tent?.ropeAngleDeg).toBeNull();
  });
});
```

Create `src/app/(admin)/site/editor/panels/ropes-panels.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KindDefaults, KindSize } from '@/lib/site/defaults';
import { derive } from '@/lib/site/derive';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { applyOps, type SiteOp } from '@/lib/site/editor/ops';
import type { EditorFlags } from '../use-editor-store';
import { ItemInspector } from './inspector-item';
import { MultiInspector } from './inspector-multi';

/*
 * The panels with a shade net's ropes in them (spec §15). This file's own
 * fixture: a net is the spec's example — 8 × 8 m on the kind's 3 m height,
 * a 50 cm strip — and the camp's default for nets is 6 × 6 m with ropes at
 * 45°, so a net's own size and the camp's differ, and a footprint exists.
 * A net at (500, 500) keeps its footprint (200…1600) inside the 26 × 24 m plot.
 */
function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'shade', label: 'רשת צל 1', xCm: 500, yCm: 500, widthCm: 800, depthCm: 800,
    heightCm: null, insetCm: 50, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

const CAMP_NETS: KindSize = { widthCm: 600, depthCm: 600, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 };

function doc(items: EditorItem[], defaults: KindDefaults = { shade: CAMP_NETS }): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, lines: [], defaults };
}

/** The flags, worked out with `derive.ts` — the server's rule — not with the store. */
function flagsOf(map: EditorDoc): EditorFlags {
  const { items, pairs } = derive(map.plot, map.items);
  return {
    outside: new Set(items.filter((entry) => entry.outside).map((entry) => entry.id)),
    overlapping: new Set(items.filter((entry) => entry.overlapping).map((entry) => entry.id)),
    partly: new Set(items.filter((entry) => entry.shade === 'partly').map((entry) => entry.id)),
    pairs,
  };
}

type OnRun = Mock<(label: string, ops: SiteOp[]) => void>;

/** The ops of the last edit a panel ran. */
function lastOps(onRun: OnRun): SiteOp[] {
  const call = onRun.mock.lastCall;
  if (call === undefined) throw new Error('nothing was run');
  return call[1];
}

function renderItem(shown: EditorItem, defaults: KindDefaults = { shade: CAMP_NETS }, others: EditorItem[] = []) {
  const map = doc([shown, ...others], defaults);
  const onRun = vi.fn<(label: string, ops: SiteOp[]) => void>();
  const onPickIds = vi.fn();
  render(<ItemInspector doc={map} item={shown} flags={flagsOf(map)} buildTasks={[]} onRun={onRun} onPickIds={onPickIds} />);
  /** What the store would hold after the last edit — `applyOps`, the rule the store uses. */
  const after = () => applyOps(map, lastOps(onRun)).doc;
  return { onRun, onPickIds, after };
}

describe('the camp’s rope angle is not a size (Review Focus #2)', () => {
  it('stays when one net’s sizes are saved as the nets’ default', () => {
    const { after } = renderItem(item({ id: 'n1' }));
    fireEvent.click(screen.getByRole('button', { name: 'שמירת המידות כברירת המחדל של רשת צל' }));
    expect(after().defaults.shade).toEqual({ widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 });
  });

  it('stays when the nets of a selection store the sizes they agree on', () => {
    const map = doc([item({ id: 'n1' }), item({ id: 'n2', label: 'רשת צל 2', xCm: 1500 })]);
    const onRun = vi.fn<(label: string, ops: SiteOp[]) => void>();
    render(<MultiInspector doc={map} ids={['n1', 'n2']} onRun={onRun} onPickIds={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'לשמור גם כברירת המחדל של רשת צל' }));
    expect(applyOps(map, lastOps(onRun)).doc.defaults.shade)
      .toEqual({ widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/site/defaults.test.ts src/lib/site/editor/ops.test.ts src/lib/site/editor/commands.test.ts src/lib/site/plan.test.ts "src/app/(admin)/site/editor/panels/ropes-panels.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — the 14 new tests (1 + 4 + 5 + 2 + 2): `ropeAngleDeg` comes back `undefined` where null or a number is expected, `patchRefusal({ ropeAngleDeg: 19 })` is null, `LOCKED_FIELDS` lacks it. Every older test passes.

- [ ] **Step 3: The model and the defaults**

In `src/lib/site/defaults.ts`, replace the `KindSize` interface with:

```ts
export interface KindSize {
  widthCm: number;
  depthCm: number;
  heightCm: number;
  /** Shade nets only; null for every other kind. */
  insetCm: number | null;
  /**
   * Shade nets only: the camp's rope angle for nets, whole degrees 20–80
   * (spec D9, D17). Null for every other kind, and for nets until the camp
   * sets one — no angle is ever assumed (D16).
   */
  ropeAngleDeg: number | null;
}
```

and in `presetSize`, after `insetCm: kind === 'shade' ? DEFAULT_SHADE_INSET_CM : null,` add:

```ts
    ropeAngleDeg: null,
```

In `src/lib/site/editor/model.ts`, in `EditorItem`, right after `insetCm: number | null;` add:

```ts
  /**
   * Shade nets only: the angle of the net's ropes from the ground, whole
   * degrees 20–80. Null means the camp's angle for nets (`defaults.shade`);
   * a net with neither has no rope footprint (spec D16).
   */
  ropeAngleDeg: number | null;
```

- [ ] **Step 4: The ops**

In `src/lib/site/editor/ops.ts`:

1. Above `import { findItem, findLine, type EditorDoc, type EditorItem, type EditorLine } from './model';` add:

```ts
import { isRopeAngle } from './degrees';
```

2. In `ItemPatch`, after `insetCm?: number | null;` add:

```ts
  /** Shade nets only (spec §13); null follows the camp's angle. */
  ropeAngleDeg?: number | null;
```

3. After the `isHeight` function add:

```ts
/** Shade nets only (spec §13). `failure-messages.ts` maps it to the sentence `degrees.ts` shows a lead who types one. */
const ROPE_ANGLE_REFUSAL = 'a rope angle must be a whole number of degrees from 20 to 80';
```

4. In `patchRefusal`, after the block that ends `return 'an item height must be a whole number of centimetres between 10 and 2000';\n  }`, add:

```ts
  if (patch.ropeAngleDeg !== undefined && patch.ropeAngleDeg !== null && !isRopeAngle(patch.ropeAngleDeg)) {
    return ROPE_ANGLE_REFUSAL;
  }
```

5. In `newItemRefusal`, change `insetCm: entry.insetCm, locked: entry.locked,` to:

```ts
    insetCm: entry.insetCm, ropeAngleDeg: entry.ropeAngleDeg, locked: entry.locked,
```

6. Replace the whole `kindSizeRefusal` function with:

```ts
export function kindSizeRefusal(size: KindSize): string | null {
  /* A size sent by a page older than rope angles has no `ropeAngleDeg` key
     at all — #25 replays such a page's unsaved edits after a deploy. That is
     no angle given, not a bad one (Review Focus #3). */
  const angle: number | null | undefined = size.ropeAngleDeg;
  if (angle !== undefined && angle !== null && !isRopeAngle(angle)) return ROPE_ANGLE_REFUSAL;
  const insetOk = size.insetCm === null || (Number.isInteger(size.insetCm) && size.insetCm >= 0);
  return isSide(size.widthCm) && isSide(size.depthCm) && isHeight(size.heightCm) && insetOk
    ? null
    : 'a kind default must be whole centimetres: sides 10 to 50000, height 10 to 2000';
}
```

7. Replace the `LOCKED_FIELDS` declaration and its comment with:

```ts
/**
 * Moving, resizing (height included), turning, re-kinding or changing a
 * net's rope angle — what a lock forbids. The angle moves the net's footprint
 * (spec §13), so it is held like a side. Renaming, notes and task links are not.
 */
export const LOCKED_FIELDS: ReadonlyArray<keyof ItemPatch> = [
  'xCm', 'yCm', 'widthCm', 'depthCm', 'heightCm', 'kind', 'insetCm', 'ropeAngleDeg',
];
```

8. In `storedPatch`, replace

```ts
  if (kind === 'shade') {
    if (patch.insetCm !== undefined) out.insetCm = patch.insetCm ?? DEFAULT_SHADE_INSET_CM;
    else if (existing.insetCm === null) out.insetCm = DEFAULT_SHADE_INSET_CM;
  } else if (patch.kind !== undefined || patch.insetCm !== undefined) {
    out.insetCm = null;
  }
  return out;
```

with

```ts
  if (kind === 'shade') {
    if (patch.insetCm !== undefined) out.insetCm = patch.insetCm ?? DEFAULT_SHADE_INSET_CM;
    else if (existing.insetCm === null) out.insetCm = DEFAULT_SHADE_INSET_CM;
  } else {
    if (patch.kind !== undefined || patch.insetCm !== undefined) out.insetCm = null;
    // A rope angle is a net's alone (spec §13): explicit in the op, so undoing a kind change brings the net's own angle back.
    if (patch.kind !== undefined || patch.ropeAngleDeg !== undefined) out.ropeAngleDeg = null;
  }
  return out;
```

and add this sentence at the end of `storedPatch`'s doc comment, before `Every other field passes through unchanged.`: `Nothing but a net carries a rope angle either: a kind change away from a net, or an angle on anything else, stores none.`

- [ ] **Step 5: The commands**

In `src/lib/site/editor/commands.ts`:

1. In `addOps`, change the line `heightCm: null, insetCm: kind === 'shade' ? (size.insetCm ?? DEFAULT_SHADE_INSET_CM) : null,` to:

```ts
      heightCm: null, insetCm: kind === 'shade' ? (size.insetCm ?? DEFAULT_SHADE_INSET_CM) : null, ropeAngleDeg: null,
```

and add to its doc comment, after `…exactly as the server would give it (\`applySiteOps\`).`: ` A net follows the camp's rope angle (null), as it follows its kind's height.`

2. In `sameSize`, change the return line to:

```ts
  return a.widthCm === b.widthCm && a.depthCm === b.depthCm && a.heightCm === b.heightCm && a.insetCm === b.insetCm
    && a.ropeAngleDeg === b.ropeAngleDeg;
```

3. In `setKindDefaultOps`, after `insetCm: kind === 'shade' && size.insetCm !== null ? wholeCm(size.insetCm) : null,` add:

```ts
    ropeAngleDeg: kind === 'shade' ? size.ropeAngleDeg : null,
```

and in its doc comment change `a non-net kind never carries an inset —` to `a non-net kind never carries an inset or a rope angle —`.

- [ ] **Step 6: The server's readers**

In `src/lib/site/plan.ts`:

1. In `interface SiteItem`, after `heightCm: number | null;` add:

```ts
  /** Shade nets only; null follows the camp's angle (spec §13). */
  ropeAngleDeg: number | null;
```

2. In `ITEM_COLUMNS`, after `heightCm: siteItems.heightCm,` add `ropeAngleDeg: siteItems.ropeAngleDeg,`.

3. In `kindDefaults`, replace `out[row.kind] = { widthCm: row.widthCm, depthCm: row.depthCm, heightCm: row.heightCm, insetCm: row.insetCm };` with:

```ts
    // The rope angle is read on the nets' row only (spec §13).
    out[row.kind] = {
      widthCm: row.widthCm, depthCm: row.depthCm, heightCm: row.heightCm, insetCm: row.insetCm,
      ropeAngleDeg: row.kind === 'shade' ? row.ropeAngleDeg : null,
    };
```

4. In `toEditorItem`, change `heightCm: row.heightCm, insetCm: row.insetCm, sort: row.sort,` to:

```ts
    heightCm: row.heightCm, insetCm: row.insetCm, ropeAngleDeg: row.ropeAngleDeg, sort: row.sort,
```

- [ ] **Step 7: The two panels that store a kind's sizes**

In `src/app/(admin)/site/editor/panels/inspector-item.tsx`, in `saveAsDefault`, after `insetCm: isNet ? (item.insetCm ?? DEFAULT_SHADE_INSET_CM) : null,` add:

```ts
      // The camp's rope angle is not a size: saving sizes keeps it (Review Focus #2).
      ropeAngleDeg: standard.ropeAngleDeg,
```

In `src/app/(admin)/site/editor/panels/inspector-multi.tsx`, replace the body of `agreedSize` with:

```ts
  const shared = uniformSize(doc, ids, kind);
  if (shared.widthCm === null || shared.depthCm === null || shared.heightCm === null) return null;
  // The camp's rope angle is not a size: storing sizes keeps it (Review Focus #2).
  const ropeAngleDeg = effectiveSize(kind, doc.defaults).ropeAngleDeg;
  if (kind !== 'shade') {
    return { widthCm: shared.widthCm, depthCm: shared.depthCm, heightCm: shared.heightCm, insetCm: null, ropeAngleDeg };
  }
  const insets = new Set(ids.map((id) => findItem(doc, id)?.insetCm ?? DEFAULT_SHADE_INSET_CM));
  if (insets.size !== 1) return null;
  return { widthCm: shared.widthCm, depthCm: shared.depthCm, heightCm: shared.heightCm, insetCm: [...insets][0], ropeAngleDeg };
```

- [ ] **Step 8: Bring every fixture up to the new shape**

`EditorItem`, `SiteItem` and `KindSize` each gained a required field, so every literal that builds one no longer compiles. The compiler lists them; that list, not a grep, is the checklist.

```bash
mkdir -p .vitest && rtk proxy npx tsc --noEmit > .vitest/tsc-ropes.txt 2>&1; echo "exit=$?"
node -e "const t=require('fs').readFileSync('.vitest/tsc-ropes.txt','utf8');const f=[...new Set([...t.matchAll(/^(.+?)\(\d+,\d+\): error TS/gm)].map(m=>m[1]))];console.log(f.length);console.log(f.join('\n'))"
```

Read `.vitest/tsc-ropes.txt` with the Read tool. Every error must be a missing `ropeAngleDeg` ("Property 'ropeAngleDeg' is missing in type …"); any other error is a real mistake in Steps 3–7 — fix it there. For each flagged literal, add `ropeAngleDeg: null,` right after that literal's `insetCm: …,` (in an `EditorItem`, a `SiteItem` or a `KindSize` alike). Repeat both commands until `exit=0`.

On `6c92ce9` the list is these files (take it again with node rather than trusting this table; #24/#25/#26 may have added or moved fixtures): `scripts/land-camp-layout.ts`; `src/lib/site/{defaults,lines,plan}.test.ts`; `src/lib/site/editor/{commands,ops,placement,shade-timeline,sun}.test.ts`; `src/app/(admin)/site/page.test.tsx`; `src/app/(admin)/site/editor/{save-queue,use-editor-store,use-editor-store.lines}.test.ts`; `src/app/(admin)/site/editor/site-editor{,.saving,.no-webgl}.test.tsx`; `src/app/(admin)/site/editor/scene/{picking,meshes,lines.scene,scene-sync}.test.ts`; `src/app/(admin)/site/editor/scene/scene-view.test.tsx`; `src/app/(admin)/site/editor/panels/{checks-bar,inspector-item,inspector-line,inspector-multi,inspector-plot,library-panel,lines-panels,minimap,objects-panel}.test.tsx`.

Four assertions compare a whole `KindSize` or a whole new item with `toEqual`, and now meet a `ropeAngleDeg: null` they did not list. Update each expectation by adding `ropeAngleDeg: null` after its `insetCm`:

1. `src/lib/site/defaults.test.ts`: `expect(presetSize('tent')).toEqual({ widthCm: 300, depthCm: 300, heightCm: 200, insetCm: null, ropeAngleDeg: null });` and `expect(presetSize('shade')).toEqual({ widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: null });`.
2. `src/lib/site/plan.test.ts`: both `expect(await kindDefaults(db)).toEqual({ tent: { widthCm: 350, depthCm: 300, heightCm: 210, insetCm: null, ropeAngleDeg: null } });`.
3. `src/lib/site/editor/commands.test.ts`: the item in "adds at the kind’s size with the next label, drawn on top" (`heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 6, …`), and the expected size in "never lets a non-net kind’s default carry an inset, even a whole one" (`{ widthCm: 300, depthCm: 300, heightCm: 200, insetCm: null, ropeAngleDeg: null }`).
4. `src/app/(admin)/site/editor/panels/inspector-item.test.tsx` and `inspector-multi.test.tsx`: `expect(after().defaults.tent).toEqual({ widthCm: 300, depthCm: 200, heightCm: 200, insetCm: null, ropeAngleDeg: null });`.

Any other failure in Step 9 whose diff is not exactly a missing `ropeAngleDeg: null` is a regression, not a fixture: investigate it test-first in the file that owns the code.

- [ ] **Step 9: Run the camp map's tests**

This task changed fixtures across the whole area, so its scope is the area (still not the full suite):

Run: `npx vitest run src/lib/site "src/app/(admin)/site" src/db/schema/site.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: every test passes, exit 0 — the 14 from Step 1 included. Cross-check with node that `numFailedTests` is 0 and `numPendingTests` is 0: `node -e "const r=require(require('path').resolve(process.argv[1]));console.log(r.numTotalTests,r.numFailedTests,r.numPendingTests)" <the report path>`.

- [ ] **Step 10: Typecheck and lint**

Run: `rtk proxy npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint src/lib/site "src/app/(admin)/site" scripts/land-camp-layout.ts` — expected no errors.

- [ ] **Step 11: Commit**

Stage exactly the files this task touched by path — Steps 3–7, and every fixture Step 8's compiler list named. On `6c92ce9` that is:

```bash
git add src/lib/site/defaults.ts src/lib/site/editor/model.ts src/lib/site/editor/ops.ts src/lib/site/editor/commands.ts src/lib/site/plan.ts \
  "src/app/(admin)/site/editor/panels/inspector-item.tsx" "src/app/(admin)/site/editor/panels/inspector-multi.tsx" \
  "src/app/(admin)/site/editor/panels/ropes-panels.test.tsx" \
  scripts/land-camp-layout.ts src/lib/site/defaults.test.ts src/lib/site/lines.test.ts src/lib/site/plan.test.ts \
  src/lib/site/editor/commands.test.ts src/lib/site/editor/ops.test.ts src/lib/site/editor/placement.test.ts \
  src/lib/site/editor/shade-timeline.test.ts src/lib/site/editor/sun.test.ts \
  "src/app/(admin)/site/page.test.tsx" "src/app/(admin)/site/editor/save-queue.test.ts" \
  "src/app/(admin)/site/editor/use-editor-store.test.ts" "src/app/(admin)/site/editor/use-editor-store.lines.test.ts" \
  "src/app/(admin)/site/editor/site-editor.test.tsx" "src/app/(admin)/site/editor/site-editor.saving.test.tsx" \
  "src/app/(admin)/site/editor/site-editor.no-webgl.test.tsx" \
  "src/app/(admin)/site/editor/scene/picking.test.ts" "src/app/(admin)/site/editor/scene/meshes.test.ts" \
  "src/app/(admin)/site/editor/scene/lines.scene.test.ts" "src/app/(admin)/site/editor/scene/scene-sync.test.ts" \
  "src/app/(admin)/site/editor/scene/scene-view.test.tsx" \
  "src/app/(admin)/site/editor/panels/checks-bar.test.tsx" "src/app/(admin)/site/editor/panels/inspector-item.test.tsx" \
  "src/app/(admin)/site/editor/panels/inspector-line.test.tsx" "src/app/(admin)/site/editor/panels/inspector-multi.test.tsx" \
  "src/app/(admin)/site/editor/panels/inspector-plot.test.tsx" "src/app/(admin)/site/editor/panels/library-panel.test.tsx" \
  "src/app/(admin)/site/editor/panels/lines-panels.test.tsx" "src/app/(admin)/site/editor/panels/minimap.test.tsx" \
  "src/app/(admin)/site/editor/panels/objects-panel.test.tsx"
git status --short   # anything else the compiler named: stage it by path too. Nothing of this task left unstaged; nothing of anyone else's staged.
git commit -m "feat(site): a net carries its rope angle through the editor's model and ops

EditorItem, ItemPatch and KindSize gain ropeAngleDeg; whole degrees 20–80 or
null, refused otherwise with 'a rope angle must be'. A lock holds it; a kind
change away from a net clears it; saving sizes as a default keeps the camp's.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The server stores, copies and refuses the angle

**Files:**
- Modify: `src/lib/site/plan.ts` (`patchSet`, the `add` insert and the `setKindDefault` upsert in `applySiteOps`, `copyPlan`)
- Modify: `src/app/(admin)/site/failure-messages.ts` (one row, appended)
- Modify: `src/app/(admin)/site/editor/use-editor-store.ts` (`itemPatch`)
- Modify (tests): `src/lib/site/plan.test.ts` (inside Task 3's describe; one import), `src/app/(admin)/site/editor/panels/ropes-panels.test.tsx` (append; imports)
- Create: `src/app/(admin)/site/editor/use-editor-store.ropes.test.ts`

**Interfaces:**
- Consumes: Task 3's fields and refusals; `ROPE_ANGLE_OUT_OF_RANGE` (Task 1).
- Produces: `applySiteOps` writes `ropeAngleDeg` on add (nets only; a missing key is null) and on update (via `storedPatch`), and on `setKindDefault` for `shade` (a size with no `ropeAngleDeg` key leaves the stored angle as it was; any other kind stores null); `copyPlan` copies it; `siteFailureMessage` maps `a rope angle must be` to `ROPE_ANGLE_OUT_OF_RANGE`'s sentence; the store's "mine" replay carries the angle when a pending add becomes an update.

- [ ] **Step 1: Write the failing tests**

In `src/lib/site/plan.test.ts`, add `import type { KindSize } from './defaults';` under `import type { EditorItem, EditorLine } from './editor/model';`. Then, inside `describe('the camp map’s rope angles', …)` (Task 3), after its last test, add:

```ts
  it('stores a net’s angle on add and on update, and none on anything else', async () => {
    const net = netOf({ ropeAngleDeg: 45 });
    const tent = tentOf({ xCm: 1500, ropeAngleDeg: 45 });
    await save([{ type: 'add', item: net }, { type: 'add', item: tent }]);
    const angleOf = async (id: string) => (await listItems(db, planId)).find((row) => row.id === id)?.ropeAngleDeg;
    expect(await angleOf(net.id)).toBe(45);
    expect(await angleOf(tent.id)).toBeNull();
    await save([{ type: 'update', id: net.id, patch: { ropeAngleDeg: 30 } }]);
    expect(await angleOf(net.id)).toBe(30);
    await save([{ type: 'update', id: net.id, patch: { ropeAngleDeg: null } }]);
    expect(await angleOf(net.id)).toBeNull();
  });

  it('clears a net’s angle, with its strip, when it becomes another kind', async () => {
    const net = netOf({ ropeAngleDeg: 45 });
    await save([{ type: 'add', item: net }]);
    await save([{ type: 'update', id: net.id, patch: { kind: 'tent' } }]);
    expect((await listItems(db, planId))[0]).toMatchObject({ kind: 'tent', insetCm: null, ropeAngleDeg: null });
  });

  it('refuses an angle outside whole degrees from 20 to 80, and writes nothing', async () => {
    for (const bad of [19, 81, 45.5]) {
      await expect(applySiteOps(db, planId, 0, [{ type: 'add', item: netOf({ ropeAngleDeg: bad }) }], LEAD))
        .rejects.toThrow('a rope angle must be');
    }
    expect(await listItems(db, planId)).toEqual([]);
    expect((await planById(db, planId))?.version).toBe(0);
  });

  it('keeps a locked net’s angle until the same patch unlocks it', async () => {
    const net = netOf({ ropeAngleDeg: 45, locked: true });
    await save([{ type: 'add', item: net }]);
    await expect(applySiteOps(db, planId, 1, [{ type: 'update', id: net.id, patch: { ropeAngleDeg: 30 } }], LEAD))
      .rejects.toThrow('that item is locked');
    await save([{ type: 'update', id: net.id, patch: { locked: false, ropeAngleDeg: 30 } }]);
    expect((await listItems(db, planId))[0]).toMatchObject({ locked: false, ropeAngleDeg: 30 });
  });

  it('stores the camp’s angle with the nets’ default and none with another kind’s, and refuses a bad one', async () => {
    await save([
      { type: 'setKindDefault', kind: 'shade', size: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } },
      { type: 'setKindDefault', kind: 'tent', size: { widthCm: 300, depthCm: 300, heightCm: 200, insetCm: null, ropeAngleDeg: 45 } },
    ]);
    const defaults = await kindDefaults(db);
    expect(defaults.shade?.ropeAngleDeg).toBe(45);
    expect(defaults.tent?.ropeAngleDeg).toBeNull();
    const [row] = await db.select().from(siteKindDefaults).where(eq(siteKindDefaults.kind, 'tent'));
    expect(row.ropeAngleDeg).toBeNull();
    await expect(applySiteOps(db, planId, 1, [
      { type: 'setKindDefault', kind: 'shade', size: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 81 } },
    ], LEAD)).rejects.toThrow('a rope angle must be');
  });

  it('leaves the camp’s angle as it was when a page from before rope angles saves a net’s size (Review Focus #3)', async () => {
    await save([{ type: 'setKindDefault', kind: 'shade', size: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } }]);
    // What such a page sends: a size with no `ropeAngleDeg` key at all.
    const older = { widthCm: 700, depthCm: 700, heightCm: 300, insetCm: 50 } as unknown as KindSize;
    await save([{ type: 'setKindDefault', kind: 'shade', size: older }]);
    expect((await kindDefaults(db)).shade).toEqual({ widthCm: 700, depthCm: 700, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 });
  });

  it('copies a net’s own angle to next year’s map', async () => {
    await save([{ type: 'add', item: netOf({ ropeAngleDeg: 45 }) }]);
    const [next] = await db.insert(seasons).values({ name: 'ברן 27', year: 2027, flatRate: '1200.00' }).returning();
    const copied = await copyPlan(db, s26, next.id, LEAD);
    expect((await listItems(db, copied))[0].ropeAngleDeg).toBe(45);
  });
```

In `src/app/(admin)/site/editor/panels/ropes-panels.test.tsx`, add to the imports `import { ROPE_ANGLE_OUT_OF_RANGE } from '@/lib/site/editor/degrees';` and `import { siteFailureMessage } from '../../failure-messages';`, and append at the end:

```tsx
describe('a refused rope angle', () => {
  it('reads the same in Hebrew whether the box or the server refused it', () => {
    expect(siteFailureMessage(new Error('a rope angle must be a whole number of degrees from 20 to 80')))
      .toBe(ROPE_ANGLE_OUT_OF_RANGE);
  });
});
```

Create `src/app/(admin)/site/editor/use-editor-store.ropes.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import type { SaveResult } from '@/lib/site/editor/ops';
import { useEditorStore, type EditorStoreInit } from './use-editor-store';

/**
 * The store with shade-net ropes in it (spec Part B): the flags it derives,
 * and a conflict resolved with 'mine' that must not lose a net's angle.
 */

const A = '0b9f6a8e-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const NET = 'cccccccc-0000-4000-8000-000000000001';

function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 100, widthCm: 300, depthCm: 300,
    heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

const net = item({ id: NET, kind: 'shade', label: 'רשת צל 1', xCm: 1000, yCm: 1000, widthCm: 800, depthCm: 800, insetCm: 50 });

function doc(items: EditorItem[], defaults: EditorDoc['defaults'] = {}): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, lines: [], defaults };
}

async function waitForSave() {
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
}

function setup(over: Partial<EditorStoreInit> = {}) {
  const save = vi.fn<EditorStoreInit['save']>(async (base) => ({ ok: true, version: base + 1 }));
  const load = vi.fn<EditorStoreInit['load']>();
  const init: EditorStoreInit = { doc: doc([item({ id: A })]), version: 0, save, load, ...over };
  const hook = renderHook(() => useEditorStore(init));
  return { ...hook, save: (over.save ?? save) as typeof save };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('ropes in the store', () => {
  it('keeps a net’s rope angle when "mine" turns a pending add into an update', async () => {
    const conflicting = vi.fn<EditorStoreInit['save']>(async (base): Promise<SaveResult> => (
      base === 0 ? { ok: false, reason: 'conflict', version: 5 } : { ok: true, version: base + 1 }
    ));
    // The other lead's map already has the net, following the camp's angle.
    const theirs = doc([item({ id: A }), net]);
    const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
    const { result } = setup({ save: conflicting, load });
    act(() => { result.current.run('הוספה', [{ type: 'add', item: { ...net, ropeAngleDeg: 45 } }]); });
    await waitForSave();
    expect(result.current.conflict).toEqual({ version: 5 });

    await act(async () => { await result.current.resolveConflict('mine'); });

    expect(result.current.doc.items.find((entry) => entry.id === NET)?.ropeAngleDeg).toBe(45);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(conflicting).toHaveBeenCalledTimes(2);
    expect(conflicting.mock.calls[1][1]).toEqual([{ type: 'update', id: NET, patch: { ropeAngleDeg: 45 } }]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/site/plan.test.ts "src/app/(admin)/site/editor/panels/ropes-panels.test.tsx" "src/app/(admin)/site/editor/use-editor-store.ropes.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — the store test (the replayed update carries no angle, so the merged net has null); the Hebrew test (the fallback sentence comes back); and in `plan.test.ts` "stores a net’s angle…", "copies a net’s own angle…" and "leaves the camp’s angle as it was…" (nothing writes the column). "clears a net’s angle…", "refuses an angle…", "keeps a locked net’s angle…" and "stores the camp’s angle…" may already pass: Task 3's refusals and `storedPatch` do their part, and they pin that the writes below do not undo it.

- [ ] **Step 3: The server's writes**

In `src/lib/site/plan.ts`:

1. In `patchSet`, after `if (stored.insetCm !== undefined) set.insetCm = stored.insetCm;` add:

```ts
  if (stored.ropeAngleDeg !== undefined) set.ropeAngleDeg = stored.ropeAngleDeg;
```

2. In `applySiteOps`'s `add` branch, in the `values({ … })` of `tx.insert(siteItems)`, after `insetCm: entry.kind === 'shade' ? (entry.insetCm ?? DEFAULT_SHADE_INSET_CM) : null,` add:

```ts
          // A net's own angle; none on anything else, and none from a page older than rope angles.
          ropeAngleDeg: entry.kind === 'shade' ? (entry.ropeAngleDeg ?? null) : null,
```

3. In the `setKindDefault` branch, replace

```ts
        // Inset is a fact about nets only, same as an item's (`patchSet` above).
        const size = {
          widthCm: op.size.widthCm, depthCm: op.size.depthCm, heightCm: op.size.heightCm,
          insetCm: op.kind === 'shade' ? op.size.insetCm : null,
        };
```

with

```ts
        /* Inset and rope angle are facts about nets only, same as an item's
           (`patchSet` above). A size from a page older than rope angles has
           no `ropeAngleDeg` key at all: it leaves the camp's angle as it was
           rather than wiping it (Review Focus #3). */
        const angle: number | null | undefined = op.kind === 'shade' ? op.size.ropeAngleDeg : null;
        const size = {
          widthCm: op.size.widthCm, depthCm: op.size.depthCm, heightCm: op.size.heightCm,
          insetCm: op.kind === 'shade' ? op.size.insetCm : null,
          ...(angle === undefined ? {} : { ropeAngleDeg: angle }),
        };
```

(The insert and its `onConflictDoUpdate` below already spread `size`, so both take the angle, or leave it.)

4. In `copyPlan`, in the object each `rows.map` builds, after `heightCm: row.heightCm,` add `ropeAngleDeg: row.ropeAngleDeg,`.

- [ ] **Step 4: The Hebrew**

In `src/app/(admin)/site/failure-messages.ts`, append as the last row of `SITE_ERRORS` (after the row that begins `['an item with a line attached keeps',`):

```ts
  // A shade net's rope angle (`editor/degrees.ts` shows the same sentence to a lead who types one).
  ['a rope angle must be', 'זווית החבלים היא מספר שלם של מעלות, מ־⁦20⁩ עד ⁦80⁩'],
```

- [ ] **Step 5: The store's replay**

In `src/app/(admin)/site/editor/use-editor-store.ts`, in `itemPatch`, change `insetCm: item.insetCm, taskId: item.taskId, notes: item.notes,` to:

```ts
    insetCm: item.insetCm, ropeAngleDeg: item.ropeAngleDeg, taskId: item.taskId, notes: item.notes,
```

- [ ] **Step 6: Run the tests**

Run the Step 2 command. Expected: all pass, exit 0 — the 7 new tests in `plan.test.ts`, 1 more in `ropes-panels.test.tsx`, the 1 in `use-editor-store.ropes.test.ts`, and every older one. Cross-check `numFailedTests: 0` and `numPendingTests: 0` with node, as in Task 3.

- [ ] **Step 7: Typecheck and lint**

Run: `rtk proxy npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint src/lib/site/plan.ts src/lib/site/plan.test.ts "src/app/(admin)/site/failure-messages.ts" "src/app/(admin)/site/editor/use-editor-store.ts" "src/app/(admin)/site/editor/use-editor-store.ropes.test.ts" "src/app/(admin)/site/editor/panels/ropes-panels.test.tsx"` — expected no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/site/plan.ts src/lib/site/plan.test.ts "src/app/(admin)/site/failure-messages.ts" \
  "src/app/(admin)/site/editor/use-editor-store.ts" "src/app/(admin)/site/editor/use-editor-store.ropes.test.ts" \
  "src/app/(admin)/site/editor/panels/ropes-panels.test.tsx"
git commit -m "feat(site): the server stores, copies and refuses rope angles

applySiteOps writes a net's angle on add, update and the nets' default, and a
size from a page older than angles leaves the camp's angle alone. copyPlan
carries it; 'a rope angle must be' reads in Hebrew; 'mine' keeps it.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The rope footprint in the geometry — offset, footprint, band, union area, gap obstacles

**Files:**
- Modify: `src/lib/site/geometry.ts` (`PlacedItem`, `outsideIds`; a new section at the end)
- Modify: `src/lib/site/derive.ts` (`ItemShape`, `ropeCmOf`, `toPlaced`, one line of `derive`)
- Modify (callers of `.map(toPlaced)`, which no longer compiles once `toPlaced` takes a second argument): `src/app/(admin)/site/editor/panels/inspector-item.tsx`, `inspector-plot.tsx`, `src/app/(admin)/site/plot-drawer.tsx`, and the `flagsOf` helpers of `checks-bar.test.tsx`, `inspector-item.test.tsx`, `inspector-plot.test.tsx`, `minimap.test.tsx`, `objects-panel.test.tsx`
- Modify (tests): `src/lib/site/geometry.test.ts` (the fixture; append)
- Create: `src/lib/site/derive.test.ts`

**Interfaces:**
- Consumes: `itemHeight`, `KindDefaults` (`defaults.ts`); the fields of Task 3.
- Produces (geometry): `PlacedItem.ropeCm: number`; `ropeOffsetCm(heightCm: number, angleDeg: number): number`; `groundRect(item: PlacedItem): Rect`; `inRopeBand(rect: Rect, net: PlacedItem): boolean`; `ropeBandPairs(items: readonly PlacedItem[]): Array<[string, string]>` — `[netId, itemId]`; `unionAreaM2(rects: readonly Rect[], plot: Plot): number`; `gapObstacles(others: readonly PlacedItem[], moving: Rect): Rect[]`; `outsideIds` measuring `groundRect`.
- Produces (derive): `ItemShape.heightCm: number | null`, `ItemShape.ropeAngleDeg: number | null`; `ropeCmOf(item: Pick<ItemShape, 'kind' | 'heightCm' | 'ropeAngleDeg'>, defaults: KindDefaults): number`; `toPlaced(item: ItemShape, defaults: KindDefaults = {}): PlacedItem`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/site/geometry.test.ts`:

1. Add `gapObstacles, groundRect, inRopeBand, ropeBandPairs, ropeOffsetCm, unionAreaM2,` to the import from `./geometry`.
2. In the fixture `item`, change `return { kind: 'tent', insetCm: null, x: 0, y: 0, width: 300, depth: 300, ...over };` to:

```ts
  return { kind: 'tent', insetCm: null, ropeCm: 0, x: 0, y: 0, width: 300, depth: 300, ...over };
```

3. Append at the end of the file:

```ts
describe('a shade net’s ropes', () => {
  // Spec §12's example: an 8 × 8 m net, 3 m high, ropes at 45°: stakes 3 m out, a 14 × 14 m footprint.
  const NET = item({ id: 'net', kind: 'shade', insetCm: 50, x: 500, y: 500, width: 800, depth: 800, ropeCm: 300 });
  const at = (x: number, y: number): Rect => ({ x, y, width: 300, depth: 300 });

  it('reach out height ÷ tan angle, in whole centimetres', () => {
    expect(ropeOffsetCm(300, 45)).toBe(300);
    expect(ropeOffsetCm(300, 20)).toBe(824); // 2.7 times the height: 8.2 m
    expect(ropeOffsetCm(300, 80)).toBe(53); // 0.18 times the height
    expect(ropeOffsetCm(400, 20)).toBe(1099);
    expect(ropeOffsetCm(400, 80)).toBe(71);
  });

  it('grow a net’s footprint by the offset on every side, and leave a tent’s as it stands', () => {
    expect(groundRect(NET)).toEqual({ x: 200, y: 200, width: 1400, depth: 1400 });
    expect(groundRect(item({ id: 't', x: 100, y: 100 }))).toEqual({ x: 100, y: 100, width: 300, depth: 300 });
  });

  it('put in the band what overlaps the footprint and is not wholly under the cloth', () => {
    expect(inRopeBand(at(600, 600), NET)).toBe(false); // under the cloth
    expect(inRopeBand(at(250, 600), NET)).toBe(true); // between the cloth and the stakes
    expect(inRopeBand(at(400, 600), NET)).toBe(true); // half under the cloth, half in the band
    expect(inRopeBand(at(1600, 600), NET)).toBe(false); // against the stake line: an edge is not an overlap
    expect(inRopeBand(at(250, 600), { ...NET, ropeCm: 0 })).toBe(false); // no ropes, no band (D16)
  });

  it('pair each net with what stands in its band, and never a net with a net', () => {
    const items = [
      NET,
      item({ id: 'under', x: 600, y: 600 }),
      item({ id: 'band', x: 250, y: 600 }),
      item({ id: 'far', x: 2000, y: 2000 }),
      item({ id: 'net2', kind: 'shade', insetCm: 50, x: 1300, y: 500, width: 800, depth: 800, ropeCm: 300 }),
    ];
    expect(ropeBandPairs(items)).toEqual([['net', 'band']]);
    expect(ropeBandPairs(items.map((entry) => ({ ...entry, ropeCm: 0 })))).toEqual([]);
  });

  it('put a net outside the fence by its ropes, a footprint flush with the fence counting as inside', () => {
    const flush = item({ id: 'n', kind: 'shade', insetCm: 50, x: 300, y: 300, width: 800, depth: 800, ropeCm: 300 });
    const plot = { widthCm: 1400, depthCm: 1400 };
    expect(outsideIds([flush], plot)).toEqual([]);
    expect(outsideIds([{ ...flush, x: 299 }], plot)).toEqual(['n']);
    expect(outsideIds([{ ...flush, x: 0, ropeCm: 0 }], plot)).toEqual([]);
  });

  it('cast no shade: a net shades by its cloth, whatever its ropes (D8)', () => {
    const sofa = item({ id: 's', kind: 'sofa', x: 250, y: 600, width: 200, depth: 90 });
    expect(shadedRect(NET)).toEqual({ x: 550, y: 550, width: 700, depth: 700 });
    expect(shadeState(sofa, [NET])).toBe('unshaded');
    expect(shadeCounts([NET, sofa])).toEqual(shadeCounts([{ ...NET, ropeCm: 0 }, sofa]));
  });
});

describe('the ground the items take', () => {
  it('counts overlapping ground once', () => {
    expect(unionAreaM2([{ x: 0, y: 0, width: 1000, depth: 1000 }, { x: 500, y: 500, width: 1000, depth: 1000 }], PLOT)).toBe(175);
    expect(unionAreaM2([{ x: 0, y: 0, width: 1000, depth: 1000 }, { x: 200, y: 200, width: 300, depth: 300 }], PLOT)).toBe(100);
  });

  it('counts only what lies inside the fence', () => {
    expect(unionAreaM2([{ x: -500, y: -500, width: 1000, depth: 1000 }], PLOT)).toBe(25);
    expect(unionAreaM2([{ x: 2500, y: 0, width: 300, depth: 300 }], PLOT)).toBe(3);
    expect(unionAreaM2([{ x: 3000, y: 0, width: 300, depth: 300 }], PLOT)).toBe(0);
  });

  it('is nothing on an empty map, and adds rectangles apart whole', () => {
    expect(unionAreaM2([], PLOT)).toBe(0);
    expect(unionAreaM2([{ x: 0, y: 0, width: 300, depth: 300 }, { x: 1000, y: 1000, width: 200, depth: 90 }], PLOT)).toBe(10.8);
  });
});

describe('the gaps while dragging, with ropes — the "walkway"', () => {
  // Cloth 10–18 m east, 5–13 m south; stakes 3 m out: footprint 7–21 m east, 2–16 m south.
  const NET = item({ id: 'net', kind: 'shade', insetCm: 50, x: 1000, y: 500, width: 800, depth: 800, ropeCm: 300 });
  const moving: Rect = { x: 200, y: 700, width: 300, depth: 300 };

  it('measure to a net’s stake line from beside it', () => {
    expect(gapObstacles([NET], moving)).toEqual([{ x: 700, y: 200, width: 1400, depth: 1400 }]);
    expect(gapsAround(moving, gapObstacles([NET], moving), PLOT)).toContainEqual({ from: [500, 850], to: [700, 850], lengthCm: 200 });
  });

  it('take a net over the moving item for its roof, not a wall', () => {
    expect(gapObstacles([NET], { x: 1100, y: 600, width: 300, depth: 300 })).toEqual([]);
  });

  it('leave a net without ropes out, as before (D16), and a solid item in, as it stands', () => {
    expect(gapObstacles([{ ...NET, ropeCm: 0 }], moving)).toEqual([]);
    const sofa = item({ id: 's', kind: 'sofa', x: 700, y: 1800, width: 200, depth: 90 });
    expect(gapObstacles([sofa], moving)).toEqual([{ x: 700, y: 1800, width: 200, depth: 90 }]);
  });
});
```

Create `src/lib/site/derive.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { KindDefaults } from './defaults';
import { ropeCmOf, toPlaced, type ItemShape } from './derive';

/* This file's own fixture: an 8 × 8 m net with a 50 cm strip, on its kind's height unless told otherwise. */
function shape(over: Partial<ItemShape> & { id: string }): ItemShape {
  return {
    kind: 'shade', xCm: 500, yCm: 500, widthCm: 800, depthCm: 800, insetCm: 50,
    heightCm: null, ropeAngleDeg: null, ...over,
  };
}

/** The camp's default for nets: the preset's size and 3 m height, with this rope angle. */
function campAt(angle: number | null, heightCm = 300): KindDefaults {
  return { shade: { widthCm: 800, depthCm: 800, heightCm, insetCm: 50, ropeAngleDeg: angle } };
}

describe('a net’s ropes, placed', () => {
  it('reach out height ÷ tan angle: 3 m at 45° is 3 m', () => {
    expect(toPlaced(shape({ id: 'n', ropeAngleDeg: 45 })).ropeCm).toBe(300);
  });

  it('take the net’s own height and angle before the camp’s', () => {
    expect(ropeCmOf(shape({ id: 'n', heightCm: 400, ropeAngleDeg: 45 }), campAt(20))).toBe(400);
    expect(ropeCmOf(shape({ id: 'n', heightCm: 400 }), campAt(20))).toBe(1099);
    expect(ropeCmOf(shape({ id: 'n', ropeAngleDeg: 80 }), campAt(20))).toBe(53);
  });

  it('take the kind’s height from the camp’s own default when it has one (D18)', () => {
    expect(ropeCmOf(shape({ id: 'n' }), campAt(45, 400))).toBe(400);
  });

  it('are nothing until an angle is set somewhere (D16)', () => {
    expect(ropeCmOf(shape({ id: 'n' }), {})).toBe(0);
    expect(ropeCmOf(shape({ id: 'n' }), campAt(null))).toBe(0);
    expect(toPlaced(shape({ id: 'n' })).ropeCm).toBe(0);
  });

  it('are never anything else’s, whatever it carries', () => {
    expect(ropeCmOf(shape({ id: 't', kind: 'tent', insetCm: null, ropeAngleDeg: 45 }), campAt(45))).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/site/geometry.test.ts src/lib/site/derive.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `ropeOffsetCm is not a function` (and the rest of the new geometry names); `ropeCmOf is not a function`; the older geometry tests pass.

- [ ] **Step 3: The geometry**

In `src/lib/site/geometry.ts`:

1. In `PlacedItem`, after `insetCm: number | null;` add:

```ts
  /**
   * How far the net's stakes stand out from its cloth, whole centimetres
   * (spec §12). 0 for anything but a net, and for a net with no angle
   * anywhere (D16). `derive.ts`'s `toPlaced` fills it.
   */
  ropeCm: number;
```

2. Replace `outsideIds` and its comment with:

```ts
/**
 * Items not fully inside the plot — after the plot shrank, or after a drag
 * past the fence — by their footprint: a net whose ropes cross the fence is
 * outside, though its cloth is not (spec D8). Flush counts as inside.
 */
export function outsideIds(items: readonly PlacedItem[], plot: Plot): string[] {
  return items.filter((item) => !contains(plot, groundRect(item))).map((item) => item.id);
}
```

3. Append at the end of the file:

```ts
/* ── a shade net's ropes (spec Part B, §§12–15) ─────────────────────────── */

/**
 * Where a rope at `angleDeg` from the ground, tied `heightCm` up, meets the
 * ground: h ÷ tan θ (spec D9), in whole centimetres. 45° puts the stake as
 * far out as the cloth is high, 20° 2.7 times as far, 80° 0.18 times. The
 * angle is one `degrees.ts` accepts — whole, 20 to 80 — which every write
 * path checks, so the tangent here is never near zero or infinity.
 */
export function ropeOffsetCm(heightCm: number, angleDeg: number): number {
  return Math.round(heightCm / Math.tan((angleDeg * Math.PI) / 180));
}

/** The ground an item takes (spec D8): its rectangle, grown on every side by its ropes. A tent's is itself. */
export function groundRect(item: PlacedItem): Rect {
  const rope = item.ropeCm;
  return { x: item.x - rope, y: item.y - rope, width: item.width + rope * 2, depth: item.depth + rope * 2 };
}

/** `inner` wholly inside `outer`, edges included. */
function within(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.depth <= outer.y + outer.depth;
}

/**
 * Whether a rectangle stands in a net's rope band (spec §3, §15): it
 * overlaps the net's footprint and is not wholly under its cloth. Under the
 * cloth is what a net is for; between the cloth's edge and the stakes is
 * where somebody trips over a rope. A net without ropes has no band (D16).
 */
export function inRopeBand(rect: Rect, net: PlacedItem): boolean {
  return net.ropeCm > 0 && overlap(rect, groundRect(net)) && !within(net, rect);
}

/**
 * Every item standing in a net's rope band, as `[net id, item id]`, net by
 * net and then item by item in input order. Only something that is not a
 * net is ever in a band: two nets whose bands cross are two roofs' ropes,
 * which `overlapPairs` does not pair either. Every side of every net has
 * ropes (spec §27 Q2), so a tent under one net that reaches into its
 * neighbour's band is flagged — in the neighbour's band only.
 */
export function ropeBandPairs(items: readonly PlacedItem[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const net of items) {
    if (!isShade(net) || net.ropeCm === 0) continue;
    for (const other of items) {
      if (!isShade(other) && inRopeBand(other, net)) pairs.push([net.id, other.id]);
    }
  }
  return pairs;
}

/**
 * The area the rectangles cover together inside the plot, in square metres
 * to one decimal, like `areaM2` (spec §3, "שטח תפוס"): ground two of them
 * share is counted once, and whatever lies past the fence not at all. A
 * sweep across the rectangles' west and east edges: in each strip between two
 * neighbouring edges, the rectangles spanning it cover north–south runs,
 * merged and added. Integer centimetres until the one rounding at the end.
 */
export function unionAreaM2(rects: readonly Rect[], plot: Plot): number {
  const clipped: Rect[] = [];
  for (const rect of rects) {
    const west = Math.max(0, rect.x);
    const north = Math.max(0, rect.y);
    const east = Math.min(plot.widthCm, rect.x + rect.width);
    const south = Math.min(plot.depthCm, rect.y + rect.depth);
    if (east > west && south > north) clipped.push({ x: west, y: north, width: east - west, depth: south - north });
  }
  const edges = [...new Set(clipped.flatMap((rect) => [rect.x, rect.x + rect.width]))].sort((a, b) => a - b);
  let squareCm = 0;
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const west = edges[i];
    const east = edges[i + 1];
    const runs = clipped
      .filter((rect) => rect.x <= west && rect.x + rect.width >= east)
      .map((rect): [number, number] => [rect.y, rect.y + rect.depth])
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let run: [number, number] | null = null;
    for (const [north, south] of runs) {
      if (run === null || north > run[1]) {
        if (run !== null) covered += run[1] - run[0];
        run = [north, south];
      } else if (south > run[1]) {
        run[1] = south;
      }
    }
    if (run !== null) covered += run[1] - run[0];
    squareCm += covered * (east - west);
  }
  return Math.round(squareCm / 1000) / 10;
}

/**
 * What the gap readouts measure to while `moving` is dragged — the
 * "walkway" (spec §3, §14): every solid item as it stands, and every net
 * with ropes whose cloth `moving` does not touch, by its rope footprint. A
 * net over the moving item is the roof it stands under, not a wall. A net
 * without ropes is left out, as nets always were (D16).
 */
export function gapObstacles(others: readonly PlacedItem[], moving: Rect): Rect[] {
  const obstacles: Rect[] = [];
  for (const other of others) {
    if (!isShade(other)) obstacles.push({ x: other.x, y: other.y, width: other.width, depth: other.depth });
    else if (other.ropeCm > 0 && !overlap(other, moving)) obstacles.push(groundRect(other));
  }
  return obstacles;
}
```

- [ ] **Step 4: `toPlaced` places the ropes**

In `src/lib/site/derive.ts`:

1. Replace the two import statements at the top with:

```ts
import type { SiteItemKind } from '@/db/schema/site';
import { itemHeight, type KindDefaults } from './defaults';
import {
  areaM2, outsideIds, overlapPairs, ropeOffsetCm, shadeCounts, shadeState,
  type PlacedItem, type Plot, type ShadeCounts, type ShadeState,
} from './geometry';
```

2. In `ItemShape`, after `insetCm: number | null;` add:

```ts
  /** Null means the kind's height. A net's height sets how far out its stakes stand (spec D18). */
  heightCm: number | null;
  /** Shade nets only; null means the camp's angle for nets (spec D16). */
  ropeAngleDeg: number | null;
```

3. Replace `toPlaced` with:

```ts
/**
 * How far a net's stakes stand from its cloth (spec §12): its height — its
 * own, else its kind's — over the tangent of its angle — its own, else the
 * camp's for nets. 0 for anything that is not a net, and for a net while
 * neither angle is set: until the camp sets one, a net is checked by its
 * cloth, exactly as it always was (D16).
 */
export function ropeCmOf(
  item: Pick<ItemShape, 'kind' | 'heightCm' | 'ropeAngleDeg'>, defaults: KindDefaults,
): number {
  if (item.kind !== 'shade') return 0;
  const angle = item.ropeAngleDeg ?? defaults.shade?.ropeAngleDeg ?? null;
  return angle === null ? 0 : ropeOffsetCm(itemHeight(item, defaults), angle);
}

/**
 * An item as the geometry sees it. `defaults` — the camp's kind defaults —
 * give a net the camp's rope angle and its kind's height; without them only
 * a net's own angle places its ropes, which is all a shade question needs.
 */
export function toPlaced(item: ItemShape, defaults: KindDefaults = {}): PlacedItem {
  return {
    id: item.id, kind: item.kind, insetCm: item.insetCm, ropeCm: ropeCmOf(item, defaults),
    x: item.xCm, y: item.yCm, width: item.widthCm, depth: item.depthCm,
  };
}
```

4. In `derive`, change `const placed = items.map(toPlaced);` to `const placed = items.map((item) => toPlaced(item));` (Task 6 gives it the defaults).

- [ ] **Step 5: The callers of `.map(toPlaced)`**

`Array.prototype.map` passes an index as the second argument, which is not a `KindDefaults`, so each `.map(toPlaced)` becomes a lambda. Take the list again with node rather than trusting this one:

```bash
node -e "const fs=require('fs'),p=require('path');const hits=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())w(f);else if(/\.tsx?$/.test(e.name)&&fs.readFileSync(f,'utf8').includes('map(toPlaced)'))hits.push(f);}})('src');console.log(hits.length);console.log(hits.join('\n'))"
```

Expected on `6c92ce9`: 8 files besides `derive.ts` (done in Step 4).

- `src/app/(admin)/site/editor/panels/inspector-item.tsx`: `const nets = doc.items.filter((other) => other.kind === 'shade').map(toPlaced);` → `.map((other) => toPlaced(other, doc.defaults));`
- `src/app/(admin)/site/editor/panels/inspector-plot.tsx`: `const shade = shadeCounts(items.map(toPlaced));` → `const shade = shadeCounts(items.map((entry) => toPlaced(entry, doc.defaults)));`
- `src/app/(admin)/site/plot-drawer.tsx`: `outsideIds(items.map(toPlaced), { widthCm, depthCm })` → `outsideIds(items.map((item) => toPlaced(item)), { widthCm, depthCm })` (Task 6 gives it the camp's defaults).
- The `flagsOf` helper of `checks-bar.test.tsx`, `inspector-item.test.tsx`, `inspector-plot.test.tsx`, `minimap.test.tsx` and `objects-panel.test.tsx`, all under `src/app/(admin)/site/editor/panels/`: `pairs: overlapPairs(map.items.map(toPlaced)),` → `pairs: overlapPairs(map.items.map((entry) => toPlaced(entry))),`

Run the node command again: expected `0`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lib/site/geometry.test.ts src/lib/site/derive.test.ts src/lib/site/plan.test.ts src/lib/site/editor "src/app/(admin)/site/editor/panels" "src/app/(admin)/site/plot-drawer.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: all pass, exit 0 — 12 new in `geometry.test.ts`, 5 in `derive.test.ts`. Nothing else changes behaviour: no fixture outside these tests has a rope angle yet.

- [ ] **Step 7: Typecheck and lint**

Run: `rtk proxy npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint src/lib/site/geometry.ts src/lib/site/geometry.test.ts src/lib/site/derive.ts src/lib/site/derive.test.ts "src/app/(admin)/site"` — expected no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/site/geometry.ts src/lib/site/geometry.test.ts src/lib/site/derive.ts src/lib/site/derive.test.ts \
  "src/app/(admin)/site/plot-drawer.tsx" \
  "src/app/(admin)/site/editor/panels/inspector-item.tsx" "src/app/(admin)/site/editor/panels/inspector-plot.tsx" \
  "src/app/(admin)/site/editor/panels/checks-bar.test.tsx" "src/app/(admin)/site/editor/panels/inspector-item.test.tsx" \
  "src/app/(admin)/site/editor/panels/inspector-plot.test.tsx" "src/app/(admin)/site/editor/panels/minimap.test.tsx" \
  "src/app/(admin)/site/editor/panels/objects-panel.test.tsx"
git commit -m "feat(site): a net's rope footprint — offset, band, union area, gap obstacles

PlacedItem gains ropeCm (h ÷ tan θ); outsideIds reads the footprint. Shade
still reads the cloth. Nothing has ropes until an angle is set (D16).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The checks read nets by their ropes — `derive`, the page's views, the store's flags

**Files:**
- Modify: `src/lib/site/derive.ts` (`SiteCounts`, `Derived`, `TakenArea`, `takenArea`, `derive`)
- Modify: `src/lib/site/plan.ts` (`siteView`, `deriveView`)
- Modify: `src/app/(admin)/site/editor/use-editor-store.ts` (`EditorFlags`, `computeFlags`)
- Modify: `src/app/(admin)/site/plot-drawer.tsx` (a `defaults` prop), `src/app/(admin)/site/page.tsx` (passes it)
- Modify (tests): `src/lib/site/derive.test.ts` (append), `src/lib/site/plan.test.ts` (one expectation; inside Task 3's describe), `src/app/(admin)/site/editor/use-editor-store.ropes.test.ts` (append)
- Create: `src/app/(admin)/site/plot-drawer.ropes.test.tsx`
- Modify (sweep, compiler-driven): every literal `EditorFlags` — the `flagsOf` helpers of `checks-bar`, `inspector-item`, `inspector-plot`, `minimap`, `objects-panel` and `ropes-panels` tests, `NO_FLAGS` in `lines-panels.test.tsx`, the flags in `site-editor.test.tsx`, both in `scene-view.test.tsx`

**Interfaces:**
- Consumes: Task 5's geometry and `toPlaced`.
- Produces: `SiteCounts.takenAreaM2: number`; `Derived.ropePairs: Array<[string, string]>` (`[netId, itemId]`); `interface TakenArea { areaM2: number; ids: string[]; withRopes: boolean }`; `takenArea(plot: Plot, placed: readonly PlacedItem[]): TakenArea`; `derive(plot, items, defaults: KindDefaults = {})`; `deriveView(plan, items, lines = [], defaults: KindDefaults = {})`, called by `siteView` with `await kindDefaults(db)`; `EditorFlags.onRopes: Set<string>`, `EditorFlags.ropePairs: Array<[string, string]>`; `PlotDrawer`'s `defaults?: KindDefaults`.
- Where `onRopes` lives: spec §14 names it among `derive`'s outputs. Here `derive` returns `ropePairs`, and the store's flags derive `onRopes` from it (the second id of each pair), as they already derive `overlapping`-style sets. It is deliberately not a per-item `ItemFlags` field: the no-WebGL item table does not show it, and a new `ItemFlags` field would touch every `SiteItemView` fixture, `page.test.tsx`'s among them (#26's file), for nothing on screen.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/site/derive.test.ts` (add `derive` to its import from `./derive`):

```ts
describe('the flags, with ropes', () => {
  const PLOT = { widthCm: 2600, depthCm: 2400, gridCm: 50 };
  // Flush with the east fence by its cloth (1800 + 800 = 2600).
  const net = shape({ id: 'net', xCm: 1800, yCm: 800 });
  // Half a metre west of the cloth, inside where 45° ropes would reach.
  const tent = shape({ id: 'tent', kind: 'tent', xCm: 1450, yCm: 1000, widthCm: 300, depthCm: 300, insetCm: null });

  it('derive exactly what they did before while no angle is set anywhere (D16)', () => {
    const before = derive(PLOT, [net, tent]);
    expect(before.items.map((entry) => entry.outside)).toEqual([false, false]);
    expect(before.ropePairs).toEqual([]);
    expect(before.counts.outside).toBe(0);
    expect(before.counts.takenAreaM2).toBe(73); // 64 + 9, apart: the cloth, not ropes
    expect(derive(PLOT, [net, tent], {})).toEqual(before);
    expect(derive(PLOT, [net, tent], campAt(null))).toEqual(before);
  });

  it('put a net whose ropes cross the fence outside, and pair it with what stands in its band', () => {
    const roped = derive(PLOT, [net, tent], campAt(45));
    expect(roped.items.find((entry) => entry.id === 'net')?.outside).toBe(true);
    expect(roped.counts.outside).toBe(1);
    expect(roped.ropePairs).toEqual([['net', 'tent']]);
    // Nets are never part of an overlap pair: the band is its own check.
    expect(roped.pairs).toEqual([]);
  });

  it('counts a net flush with the fence by its ropes as inside, at 20° and 80°, on its kind’s height and on its own (Review Focus #1)', () => {
    const cases: Array<{ defaults: KindDefaults; own: Partial<ItemShape>; rope: number }> = [
      { defaults: campAt(20), own: {}, rope: 824 },
      { defaults: campAt(80), own: {}, rope: 53 },
      { defaults: {}, own: { heightCm: 400, ropeAngleDeg: 20 }, rope: 1099 },
      { defaults: {}, own: { heightCm: 400, ropeAngleDeg: 80 }, rope: 71 },
    ];
    for (const { defaults, own, rope } of cases) {
      const plot = { widthCm: 800 + rope * 2, depthCm: 800 + rope * 2, gridCm: 50 };
      const flush = shape({ id: 'n', xCm: rope, yCm: rope, ...own });
      expect(derive(plot, [flush], defaults).items[0].outside).toBe(false);
      expect(derive(plot, [{ ...flush, xCm: rope - 1 }], defaults).items[0].outside).toBe(true);
      expect(derive(plot, [{ ...flush, yCm: rope + 1 }], defaults).items[0].outside).toBe(true);
    }
  });

  it('flags a tent under one net that reaches into its neighbour’s band, and only there (Review Focus #5)', () => {
    // Two nets edge to edge, 2 m high with ropes at 45°: each band runs 2 m out from its cloth.
    const west = shape({ id: 'west', xCm: 400, yCm: 400, heightCm: 200, ropeAngleDeg: 45 });
    const east = shape({ id: 'east', xCm: 1200, yCm: 400, heightCm: 200, ropeAngleDeg: 45 });
    // Wholly under the west cloth (4–12 m), inside the east band (10–22 m).
    const under = shape({ id: 'tent', kind: 'tent', xCm: 1000, yCm: 600, widthCm: 150, depthCm: 150, insetCm: null });
    expect(derive(PLOT, [west, east, under]).ropePairs).toEqual([['east', 'tent']]);
  });

  it('take the area as the union of footprints inside the fence, ropes included, counting shared ground once', () => {
    // An 8 × 8 m net with 3 m ropes is 14 × 14 m; a tent under its cloth adds nothing.
    const alone = shape({ id: 'n' });
    const under = shape({ id: 't', kind: 'tent', xCm: 600, yCm: 600, widthCm: 300, depthCm: 300, insetCm: null });
    expect(derive(PLOT, [alone, under], campAt(45)).counts.takenAreaM2).toBe(196);
  });
});
```

and add `derive` to the import at the top: `import { derive, ropeCmOf, toPlaced, type ItemShape } from './derive';`.

In `src/lib/site/plan.test.ts`:

1. In the existing test "derives shade, overlap and outside flags from the rows", change `plotAreaM2: 624,` inside its `expect(view.counts).toEqual({ … })` to:

```ts
        plotAreaM2: 624,
        takenAreaM2: 64,
```

(The net's 8 × 8 m, no angle; the sofa and the chair under it; the tent at (2500, 2500) wholly south of the fence.)

2. Inside `describe('the camp map’s rope angles', …)`, after its last test, add:

```ts
  it('flags a net by its ropes in the page’s own view, with the camp’s angle (Review Focus #4)', async () => {
    // Flush with the east fence by its cloth; at 45° its stakes stand 3 m further out.
    await save([{ type: 'add', item: netOf({ xCm: 1800, yCm: 800 }) }]);
    const before = await siteView(db, s26);
    expect(before?.items[0].outside).toBe(false);
    expect(before?.counts.takenAreaM2).toBe(64);
    await save([{ type: 'setKindDefault', kind: 'shade', size: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } }]);
    const after = await siteView(db, s26);
    expect(after?.items[0].outside).toBe(true);
    expect(after?.counts.outside).toBe(1);
    // 14 × 14 m of footprint, of which 11 × 14 m lie inside the fence.
    expect(after?.counts.takenAreaM2).toBe(154);
  });
```

Append inside `describe('ropes in the store', …)` in `src/app/(admin)/site/editor/use-editor-store.ropes.test.ts`:

```ts
  it('flags what stands in a net’s rope band once the camp has an angle, and nothing before', () => {
    // 300 × 300 at (750, 1100): half in the band west of the cloth (which starts at 1000).
    const inBand = item({ id: A, xCm: 750, yCm: 1100 });
    const before = setup({ doc: doc([net, inBand]) }).result.current.flags;
    expect(before.ropePairs).toEqual([]);
    expect(before.onRopes.size).toBe(0);
    const roped = setup({
      doc: doc([net, inBand], { shade: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } }),
    }).result.current.flags;
    expect(roped.ropePairs).toEqual([[NET, A]]);
    expect([...roped.onRopes]).toEqual([A]);
    expect(roped.outside.size).toBe(0); // the footprint (7–21 m) stays inside the fence
  });
```

Create `src/app/(admin)/site/plot-drawer.ropes.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { KindDefaults } from '@/lib/site/defaults';
import type { ItemShape } from '@/lib/site/derive';

const { createPlanAction, setPlotAction } = vi.hoisted(() => ({ createPlanAction: vi.fn(), setPlotAction: vi.fn() }));
vi.mock('./actions', () => ({ createPlanAction, setPlotAction }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

import { PlotDrawer } from './plot-drawer';

/*
 * The plot drawer's "would be outside" count, with ropes (Review Focus #4):
 * the same footprint the editor flags. An 8 × 8 m net at (4, 4) m on its
 * kind's 3 m height: its cloth ends at 12 m, its 45° ropes at 15 m. A 14 m
 * wide plot keeps the cloth and cuts the ropes.
 */
const PLAN = { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0, notes: null };
const NET: ItemShape = {
  id: 'n1', kind: 'shade', xCm: 400, yCm: 400, widthCm: 800, depthCm: 800, insetCm: 50, heightCm: null, ropeAngleDeg: null,
};
const CAMP_45: KindDefaults = { shade: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } };

function renderDrawer(defaults?: KindDefaults) {
  render(
    <ToastProvider>
      <PlotDrawer seasonId="s26" seasonName="ברן 26" plan={PLAN} items={[NET]} defaults={defaults} closeHref="/site?season=s26" />
    </ToastProvider>,
  );
  // The label carries a decorative " *" (the field is required), so match its start.
  fireEvent.change(screen.getByLabelText(/^רוחב במטרים/), { target: { value: '14' } });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('the plot drawer, with a net’s ropes', () => {
  it('counts a net whose ropes the new fence would cut, with the camp’s angle', () => {
    renderDrawer(CAMP_45);
    expect(screen.getByText('1 פריטים יהיו מחוץ למגרש החדש. הם לא יזוזו לבד.')).toBeTruthy();
  });

  it('counts it by its cloth while the camp has no angle', () => {
    renderDrawer();
    expect(screen.getByText('כל הפריטים יישארו בתוך המגרש')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/site/derive.test.ts src/lib/site/plan.test.ts "src/app/(admin)/site/editor/use-editor-store.ropes.test.ts" "src/app/(admin)/site/plot-drawer.ropes.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `ropePairs` and `takenAreaM2` are undefined; `derive` ignores a camp angle; the view never reads the camp's defaults; the store's flags have no `onRopes`; the drawer counts 0 with the camp's angle. The two "no angle" tests (D16 in `derive.test.ts`, the drawer's second) pass already, except where they read `takenAreaM2` or `ropePairs`.

- [ ] **Step 3: `derive` with the camp's defaults**

In `src/lib/site/derive.ts`:

1. Replace the geometry import with:

```ts
import {
  areaM2, groundRect, outsideIds, overlap, overlapPairs, ropeBandPairs, ropeOffsetCm, shadeCounts, shadeState,
  unionAreaM2, type PlacedItem, type Plot, type Rect, type ShadeCounts, type ShadeState,
} from './geometry';
```

2. Add to the module comment, after its last sentence: `The camp's kind defaults give a net its rope footprint: the camp's angle and its kind's height (spec §12). With no angle anywhere a net derives exactly what it did before ropes existed (D16).`

3. In `SiteCounts`, after `plotAreaM2: number;` add:

```ts
  /** שטח תפוס (spec §3): the union of every item's footprint — a net's with its ropes — inside the fence, m² to one decimal. */
  takenAreaM2: number;
```

4. In `Derived`, after `pairs: Array<[string, string]>;` add:

```ts
  /** `[net id, item id]`: an item standing in a net's rope band (spec §15) — the checks bar's "בשטח החבלים". */
  ropePairs: Array<[string, string]>;
```

5. After `toPlaced`, add:

```ts
export interface TakenArea {
  /** m², one decimal. */
  areaM2: number;
  /** The items whose footprint reaches inside the fence: what the figure counts, and what pressing it selects. */
  ids: string[];
  /** Whether any net's ropes are in it — "כולל החבלים של רשתות הצל". */
  withRopes: boolean;
}

/**
 * שטח תפוס (spec §3, §15): the ground the items take, as the union of their
 * footprints — a net's with its ropes — inside the fence. The plot
 * inspector shows it against the plot's area; `derive` counts it.
 */
export function takenArea(plot: Plot, placed: readonly PlacedItem[]): TakenArea {
  const field: Rect = { x: 0, y: 0, width: plot.widthCm, depth: plot.depthCm };
  const footprints = placed.map(groundRect);
  return {
    areaM2: unionAreaM2(footprints, plot),
    ids: placed.flatMap((entry, index) => (overlap(footprints[index], field) ? [entry.id] : [])),
    withRopes: placed.some((entry) => entry.ropeCm > 0),
  };
}
```

6. Replace the whole `derive` function with:

```ts
export function derive<Item extends ItemShape>(
  plot: PlotShape, items: readonly Item[], defaults: KindDefaults = {},
): Derived<Item> {
  const placed = items.map((item) => toPlaced(item, defaults));
  const bounds: Plot = { widthCm: plot.widthCm, depthCm: plot.depthCm };
  // By footprint: a net whose ropes cross the fence is outside (D8).
  const outside = new Set(outsideIds(placed, bounds));
  const pairs = overlapPairs(placed);
  const overlapping = new Set(pairs.flat());
  const shades = placed.filter((item) => item.kind === 'shade');

  return {
    items: items.map((item, index) => ({
      ...item,
      outside: outside.has(item.id),
      overlapping: overlapping.has(item.id),
      shade: item.kind === 'shade' ? null : shadeState(placed[index], shades),
    })),
    counts: {
      items: items.length,
      outside: outside.size,
      overlapping: overlapping.size,
      overlapPairs: pairs.length,
      plotAreaM2: areaM2(bounds),
      takenAreaM2: takenArea(bounds, placed).areaM2,
      shade: shadeCounts(placed),
    },
    pairs,
    ropePairs: ropeBandPairs(placed),
  };
}
```

- [ ] **Step 4: The page's own views**

In `src/lib/site/plan.ts`:

1. In `siteView`, replace `return deriveView(plan, items, lines);` with:

```ts
  // The camp's rope angle moves nets' footprints: the table the page prints without WebGL flags what the editor flags (spec §14).
  return deriveView(plan, items, lines, await kindDefaults(db));
```

2. Replace `deriveView`'s signature line and its `defaults: {},` and `...derive(plan, items),` so the function reads:

```ts
/** The same derivation the editor's store runs in the browser (`derive.ts`, `lines.ts`), over the server's rows and the camp's kind defaults. */
export function deriveView(
  plan: SitePlan, items: readonly SiteItem[], lines: readonly SiteLine[] = [], defaults: KindDefaults = {},
): SiteView {
  const doc: EditorDoc = {
    plot: { id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm, northDeg: plan.northDeg },
    items: items.map(toEditorItem),
    lines: lines.map(toEditorLine),
    defaults,
  };
  const labelOf = (id: string) => items.find((item) => item.id === id)?.label ?? '';
  return {
    plan,
    ...derive(plan, items, defaults),
    lines: lines.map((line) => ({
      ...line,
      fromLabel: labelOf(line.fromItemId),
      toLabel: labelOf(line.toItemId),
      lengthCm: lineLengthCm(doc, toEditorLine(line)),
    })),
  };
}
```

In `src/app/(admin)/site/plot-drawer.tsx`:

1. Under `import { toPlaced, type ItemShape } from '@/lib/site/derive';` add `import type { KindDefaults } from '@/lib/site/defaults';`.
2. Change the destructuring `export function PlotDrawer({ seasonId, seasonName, plan, items, closeHref }: {` to `export function PlotDrawer({ seasonId, seasonName, plan, items, defaults = {}, closeHref }: {`, and after `items: readonly ItemShape[];` in its props type add:

```ts
  /** The camp's kind defaults: a net's rope footprint takes the camp's angle, so this count agrees with the editor's (spec §14). */
  defaults?: KindDefaults;
```

3. Change `outsideIds(items.map((item) => toPlaced(item)), { widthCm, depthCm })` to `outsideIds(items.map((item) => toPlaced(item, defaults)), { widthCm, depthCm })`.

In `src/app/(admin)/site/page.tsx`, in the `<PlotDrawer … />` rendered once the editor's document has loaded (the one with `items={items}`), add the prop right after `items={items}`:

```tsx
          defaults={loaded.doc.defaults}
```

(The drawer shown before any map exists passes `items={[]}` and needs none.)

- [ ] **Step 5: The store's flags**

In `src/app/(admin)/site/editor/use-editor-store.ts`:

1. In `EditorFlags`, after `pairs: Array<[string, string]>;` add:

```ts
  /** Standing in a net's rope band (spec §15): every item named second in `ropePairs`. */
  onRopes: Set<string>;
  /** `[net id, item id]` — what the checks bar's "בשטח החבלים" chip goes through. */
  ropePairs: Array<[string, string]>;
```

2. In `computeFlags`, replace its first two lines with:

```ts
  const derived = derive(doc.plot, doc.items, doc.defaults);
  const flags: EditorFlags = {
    outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: derived.pairs,
    onRopes: new Set(derived.ropePairs.map(([, id]) => id)), ropePairs: derived.ropePairs,
  };
```

- [ ] **Step 6: Bring every `EditorFlags` literal up to the new shape**

```bash
mkdir -p .vitest && rtk proxy npx tsc --noEmit > .vitest/tsc-ropes.txt 2>&1; echo "exit=$?"
node -e "const t=require('fs').readFileSync('.vitest/tsc-ropes.txt','utf8');const f=[...new Set([...t.matchAll(/^(.+?)\(\d+,\d+\): error TS/gm)].map(m=>m[1]))];console.log(f.length);console.log(f.join('\n'))"
```

Read the output with the Read tool. Every error must be a missing `onRopes`/`ropePairs`. On `6c92ce9` there are ten literals in nine files, all under `src/app/(admin)/site/editor/`:

- The `flagsOf` helper of `panels/checks-bar.test.tsx`, `panels/inspector-item.test.tsx`, `panels/inspector-plot.test.tsx`, `panels/minimap.test.tsx` and `panels/objects-panel.test.tsx`: change `const { items } = derive(map.plot, map.items);` to `const { items, ropePairs } = derive(map.plot, map.items, map.defaults);`, and after the `pairs: …,` line add:

```ts
    onRopes: new Set(ropePairs.map(([, id]) => id)),
    ropePairs,
```

- `panels/ropes-panels.test.tsx`'s `flagsOf`: change `const { items, pairs } = derive(map.plot, map.items);` to `const { items, pairs, ropePairs } = derive(map.plot, map.items, map.defaults);`, and after `pairs,` add the same two lines.
- `panels/lines-panels.test.tsx`: `const NO_FLAGS: EditorFlags = { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: [] };` → add `, onRopes: new Set(), ropePairs: []` before the closing brace.
- `site-editor.test.tsx`: the literal `{ outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: derived.pairs }` → add `, onRopes: new Set(), ropePairs: derived.ropePairs`.
- `scene/scene-view.test.tsx`: in `fakeStore`'s `flags: { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: [] },` and in the literal with `outside: new Set(['w4'])` → add `onRopes: new Set(), ropePairs: []` to each.

Repeat the two commands until `exit=0`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lib/site "src/app/(admin)/site" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: all pass, exit 0 — 5 new in `derive.test.ts`, 1 in `plan.test.ts`, 1 in the store file, 2 in the drawer file. `numFailedTests: 0` and `numPendingTests: 0` by node.

- [ ] **Step 8: Typecheck and lint**

Run: `rtk proxy npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint src/lib/site "src/app/(admin)/site"` — expected no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/site/derive.ts src/lib/site/derive.test.ts src/lib/site/plan.ts src/lib/site/plan.test.ts \
  "src/app/(admin)/site/editor/use-editor-store.ts" "src/app/(admin)/site/editor/use-editor-store.ropes.test.ts" \
  "src/app/(admin)/site/plot-drawer.tsx" "src/app/(admin)/site/plot-drawer.ropes.test.tsx" "src/app/(admin)/site/page.tsx" \
  "src/app/(admin)/site/editor/panels/checks-bar.test.tsx" "src/app/(admin)/site/editor/panels/inspector-item.test.tsx" \
  "src/app/(admin)/site/editor/panels/inspector-plot.test.tsx" "src/app/(admin)/site/editor/panels/minimap.test.tsx" \
  "src/app/(admin)/site/editor/panels/objects-panel.test.tsx" "src/app/(admin)/site/editor/panels/ropes-panels.test.tsx" \
  "src/app/(admin)/site/editor/panels/lines-panels.test.tsx" "src/app/(admin)/site/editor/site-editor.test.tsx" \
  "src/app/(admin)/site/editor/scene/scene-view.test.tsx"
git status --short   # anything else Step 6's compiler list named: stage it by path too
git commit -m "feat(site): the checks read nets by their ropes once an angle is set

derive takes the camp's kind defaults: outside by footprint, ropePairs, and
takenAreaM2. The store's flags, the page's own table and the plot drawer's
count all read the same footprint.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: New and copied items land clear of a net's ropes — and the gaps measure to the stakes

**Files:**
- Modify: `src/lib/site/editor/placement.ts` (whole file)
- Modify: `src/lib/site/editor/commands.ts` (the geometry import; `landsClear` retires; `duplicateOps`)
- Modify: `src/app/(admin)/site/editor/scene/engine.ts` (imports; `ghostVerdict`; the ghost's pill; `previewMove`; a new `gapsOf`)
- Modify (tests): `src/lib/site/editor/placement.test.ts` (import; append), `src/lib/site/editor/commands.test.ts` (append), `src/app/(admin)/site/editor/scene/scene-view.test.tsx` (append)

**Interfaces:**
- Consumes: `toPlaced` (Task 5), `groundRect`, `inRopeBand`, `gapObstacles`, `gapsAround` (Task 5).
- Produces: `type Landing = 'ok' | 'outside' | 'overlapping' | 'ropes'`; `type Lander = Pick<EditorItem, 'kind' | 'heightCm' | 'ropeAngleDeg'>`; `landingRule(doc: EditorDoc): (entry: Lander, rect: Rect) => Landing`. `nearestFreeSpot(doc, kind, size, near)` keeps its signature and lands through the rule; so does `duplicateOps`. The engine's ghost pill reads "בשטח החבלים של רשת צל" for `'ropes'`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/site/editor/placement.test.ts`, change `import { nearestFreeSpot } from './placement';` to `import { landingRule, nearestFreeSpot } from './placement';` and append at the end:

```ts
describe('landing clear of a net’s ropes', () => {
  const CAMP_45 = { shade: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } };
  const roped = (doc: EditorDoc): EditorDoc => ({ ...doc, defaults: CAMP_45 });
  // Cloth 9–17 m east, 8–16 m south; with 3 m ropes, footprint 6–20 m east, 5–19 m south.
  const NET = make({ id: 's1', kind: 'shade', xCm: 900, yCm: 800, widthCm: 800, depthCm: 800, insetCm: 50 });
  const TENT_KIND = { kind: 'tent' as const, heightCm: null, ropeAngleDeg: null };

  it('puts a new net where its ropes stay inside the fence', () => {
    const corner = { xCm: 0, yCm: 0 };
    expect(nearestFreeSpot(docOf([]), 'shade', { widthCm: 800, depthCm: 800 }, corner)).toEqual({ xCm: 0, yCm: 0 });
    expect(nearestFreeSpot(roped(docOf([])), 'shade', { widthCm: 800, depthCm: 800 }, corner)).toEqual({ xCm: 300, yCm: 300 });
  });

  it('keeps a new tent out of a net’s rope band, stepping out rather than under when out is nearer', () => {
    const near = { xCm: 650, yCm: 1200 };
    expect(nearestFreeSpot(docOf([NET]), 'tent', TENT, near)).toEqual({ xCm: 500, yCm: 1050 });
    expect(nearestFreeSpot(roped(docOf([NET])), 'tent', TENT, near)).toEqual({ xCm: 300, yCm: 1050 });
  });

  it('says why a spot is refused', () => {
    const lands = landingRule(roped(docOf([NET, make({ id: 't1', xCm: 2000, yCm: 100 })])));
    const at = (x: number, y: number) => ({ x, y, width: 300, depth: 300 });
    expect(lands(TENT_KIND, at(1100, 1000))).toBe('ok'); // under the cloth
    expect(lands(TENT_KIND, at(500, 1000))).toBe('ropes'); // in the west band
    expect(lands(TENT_KIND, at(2100, 100))).toBe('overlapping'); // on the other tent
    expect(lands(TENT_KIND, at(2400, 100))).toBe('outside');
    const net = { x: 100, y: 100, width: 800, depth: 800 };
    expect(lands({ kind: 'shade', heightCm: null, ropeAngleDeg: null }, net)).toBe('outside'); // its own 3 m ropes cross
    expect(lands({ kind: 'shade', heightCm: 100, ropeAngleDeg: null }, net)).toBe('ok'); // 1 m high: ropes 1 m, flush
  });
});
```

In `src/lib/site/editor/commands.test.ts`, append at the end:

```ts
describe('copies clear of a net’s ropes', () => {
  it('lands a copy outside a net’s rope band, trying the next side when the first is in it', () => {
    // Cloth 10–18 m, own angle 45° on the kind's 3 m: stakes 3 m out, footprint 7–21 m both ways.
    const net = make({
      id: 'n', kind: 'shade', label: 'רשת צל 1', xCm: 1000, yCm: 1000, widthCm: 800, depthCm: 800, insetCm: 50, ropeAngleDeg: 45,
    });
    const tent = make({ id: 'a', label: 'אוהל 1', xCm: 300, yCm: 800 });
    const roped: EditorDoc = { ...DOC, items: [tent, net] };
    // East of the tent is (700, 800): in the band. South, (300, 1200), is clear.
    expect(duplicateOps(roped, ['a'], ids('c1')).ops[0]).toMatchObject({ item: { xCm: 300, yCm: 1200 } });
    // With no angle anywhere the net has no band, and east is clear.
    const bare: EditorDoc = { ...DOC, items: [tent, { ...net, ropeAngleDeg: null }] };
    expect(duplicateOps(bare, ['a'], ids('c1')).ops[0]).toMatchObject({ item: { xCm: 700, yCm: 800 } });
  });
});
```

Append at the end of `src/app/(admin)/site/editor/scene/scene-view.test.tsx` (a top-level `describe`, after the file's last `});`):

```tsx
describe('a shade net’s ropes in the scene', () => {
  const PLAN_VIEW: EditorUi = { ...UI, mode: 'plan' };
  /* A 4 × 4 m net 1 m high, 21–25 m east and 11–15 m south, with the camp's
     ropes at 45°: its stakes stand 1 m out, so its footprint runs 20–26 m
     east (flush with the east fence) and 10–16 m south. The plan view frames
     the plot, so the tent stays where "moving an item" found it. */
  const NET = item({
    id: 'net', kind: 'shade', label: 'רשת צל 1', xCm: 2100, yCm: 1100, widthCm: 400, depthCm: 400, heightCm: 100, insetCm: 50,
  });
  const ROPED: EditorDoc = {
    ...docOf([item({ id: 'tent' }), NET]),
    defaults: { shade: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } },
  };

  it('warns a new tent dragged over the band between the cloth and the stakes', async () => {
    const { onView, handle } = renderScene(fakeStore({ doc: ROPED }), PLAN_VIEW);
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    // 17.5–20.5 m east: clear of the cloth (from 21 m), inside the band (from 20 m).
    handle.current?.setGhost({ kind: 'tent', xCm: 1750, yCm: 1150 });
    await frames();
    expect(screen.getByText('בשטח החבלים של רשת צל')).toBeTruthy();
    handle.current?.setGhost({ kind: 'tent', xCm: 1500, yCm: 1150 });
    await frames();
    expect(screen.queryByText('בשטח החבלים של רשת צל')).toBeNull();
  });

  it('measures the gap to the net’s stakes while a tent is dragged beside it', async () => {
    const { container, onView } = renderScene(fakeStore({ doc: ROPED }), PLAN_VIEW);
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    const canvas = canvasOf(container);
    // The drag of "moving an item": the tent to 15–18 m east, 2 m short of the stake line at 20 m.
    // Without the ropes, nothing stands east of it nearer than the fence, 8 m away, and no gap is shown.
    press(canvas, [500, 320]);
    slide(canvas, [600, 350]);
    await frames();
    expect(screen.getByText('2 מ׳')).toBeTruthy();
    lift(canvas, [600, 350]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/site/editor/placement.test.ts src/lib/site/editor/commands.test.ts "src/app/(admin)/site/editor/scene/scene-view.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `landingRule is not a function`; the two placement spots and the copy land where they did without ropes; the scene shows neither the band pill nor a "2 מ׳" gap. Every older test passes.

- [ ] **Step 3: The landing rule**

Replace the whole of `src/lib/site/editor/placement.ts` with:

```ts
import type { SiteItemKind } from '@/db/schema/site';
import { toPlaced } from '../derive';
import { contains, groundRect, inRopeBand, overlap, type Rect } from '../geometry';
import { rectOf, type EditorDoc, type EditorItem } from './model';

/** Where a new or copied item may land, or why not (spec §14). */
export type Landing = 'ok' | 'outside' | 'overlapping' | 'ropes';

/** What the rule needs of the item that lands: enough to place a net's ropes. */
export type Lander = Pick<EditorItem, 'kind' | 'heightCm' | 'ropeAngleDeg'>;

/**
 * The one landing rule (spec §14) for the library's click (`nearestFreeSpot`
 * below), its drag preview (the engine's ghost) and a copy (`duplicateOps`).
 * First the item's footprint inside the fence — a net's reaches its stakes,
 * at its own angle or the camp's. Then a net lands over anything, because
 * things stand under a net (the rule `overlapPairs` keeps); anything else
 * lands on nothing solid and outside every net's rope band. Built once per
 * doc, so a caller asking about a whole grid of spots places the nets once.
 */
export function landingRule(doc: EditorDoc): (entry: Lander, rect: Rect) => Landing {
  const solids = doc.items.filter((other) => other.kind !== 'shade').map(rectOf);
  const nets = doc.items.filter((other) => other.kind === 'shade').map((net) => toPlaced(net, doc.defaults));
  return (entry, rect) => {
    const landing = toPlaced({
      id: '', kind: entry.kind, xCm: rect.x, yCm: rect.y, widthCm: rect.width, depthCm: rect.depth,
      insetCm: null, heightCm: entry.heightCm, ropeAngleDeg: entry.ropeAngleDeg,
    }, doc.defaults);
    if (!contains(doc.plot, groundRect(landing))) return 'outside';
    if (entry.kind === 'shade') return 'ok';
    if (solids.some((solid) => overlap(solid, rect))) return 'overlapping';
    return nets.some((net) => inRopeBand(rect, net)) ? 'ropes' : 'ok';
  };
}

/**
 * Where a click in the library puts a new item (spec §8): the grid spot
 * whose middle is nearest `near` — the middle of the view — that the landing
 * rule calls 'ok'. Ties go to the spot found first, reading north to south
 * and then west to east, so the answer never depends on anything but the doc.
 *
 * Null when there is no such spot. The caller then says so; it never puts
 * the item somewhere it does not fit.
 */
export function nearestFreeSpot(
  doc: EditorDoc, kind: SiteItemKind, size: { widthCm: number; depthCm: number },
  near: { xCm: number; yCm: number },
): { xCm: number; yCm: number } | null {
  const stride = doc.plot.gridCm > 0 ? doc.plot.gridCm : 10;
  const lands = landingRule(doc);
  // A new item follows its kind's height and the camp's rope angle, as `addOps` makes it.
  const entry: Lander = { kind, heightCm: null, ropeAngleDeg: null };
  let best: { xCm: number; yCm: number; distance: number } | null = null;
  for (let y = 0; y + size.depthCm <= doc.plot.depthCm; y += stride) {
    for (let x = 0; x + size.widthCm <= doc.plot.widthCm; x += stride) {
      const distance = Math.hypot(x + size.widthCm / 2 - near.xCm, y + size.depthCm / 2 - near.yCm);
      if (best !== null && distance >= best.distance) continue;
      if (lands(entry, { x, y, width: size.widthCm, depth: size.depthCm }) !== 'ok') continue;
      best = { xCm: x, yCm: y, distance };
    }
  }
  return best === null ? null : { xCm: best.xCm, yCm: best.yCm };
}
```

- [ ] **Step 4: Copies land by the same rule**

In `src/lib/site/editor/commands.ts`:

1. Change `import { contains, overlap, turnAboutCentre, unionRect, wholeCm, type Rect } from '../geometry';` to:

```ts
import { turnAboutCentre, unionRect, wholeCm, type Rect } from '../geometry';
```

2. After the multi-line import that ends `} from './ops';` add:

```ts
import { landingRule } from './placement';
```

3. Delete the function `landsClear` and the one-line comment above it (`/** Whether a copy could land here: inside the fence, and on nothing solid unless it is a net. */`).

4. In `duplicateOps`, replace

```ts
  const clear = ([dx, dy]: [number, number]) => sources.every((source) => landsClear(
    doc, source.kind, { ...rectOf(source), x: source.xCm + dx, y: source.yCm + dy },
  ));
```

with

```ts
  const lands = landingRule(doc);
  const clear = ([dx, dy]: [number, number]) => sources.every((source) => lands(
    source, { ...rectOf(source), x: source.xCm + dx, y: source.yCm + dy },
  ) === 'ok');
```

and in `duplicateOps`'s doc comment, after `…on top of something, which the overlap flag then says, rather than nowhere.` add: ` Clear is \`landingRule\`'s 'ok' (\`placement.ts\`): the copy's footprint inside the fence — a copied net keeps its own angle — on nothing solid, and out of every net's rope band.`

- [ ] **Step 5: The engine's ghost and gaps**

In `src/app/(admin)/site/editor/scene/engine.ts`:

1. After `import { effectiveSize, itemHeight } from '@/lib/site/defaults';` add `import { toPlaced } from '@/lib/site/derive';`.
2. After `import { findItem, findLine, rectOf, type EditorItem } from '@/lib/site/editor/model';` add `import { landingRule, type Landing } from '@/lib/site/editor/placement';`.
3. In the import from `'@/lib/site/geometry'`, replace `contains, formatMetres, formatSize, gapsAround, overlap, unionRect, type Gap, type Handle, type Rect,` with:

```ts
  formatMetres, formatSize, gapObstacles, gapsAround, groundRect, unionRect, type Gap, type Handle, type Rect,
```

4. Replace the whole `ghostVerdict` method and its comment with:

```ts
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
```

5. In `overlayModel`, replace

```ts
      const text = verdict === 'outside' ? 'מחוץ לגדר'
        : verdict === 'overlapping' ? 'חפיפה עם פריט אחר'
          : `${SITE_KINDS[this.ghost.kind].label} · ${formatSize(size.widthCm, size.depthCm)}`;
```

with

```ts
      const text = verdict === 'outside' ? 'מחוץ לגדר'
        : verdict === 'overlapping' ? 'חפיפה עם פריט אחר'
          : verdict === 'ropes' ? 'בשטח החבלים של רשת צל'
            : `${SITE_KINDS[this.ghost.kind].label} · ${formatSize(size.widthCm, size.depthCm)}`;
```

6. In `previewMove`, replace `this.gaps = only === undefined ? [] : gapsAround(toRect(only), snapped.others, this.plot());` with:

```ts
    this.gaps = only === undefined ? [] : this.gapsOf(ids, snapped.moving[0], only);
```

and add this method right after `previewMove`:

```ts
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
```

- [ ] **Step 6: Run the tests**

Run the Step 2 command. Expected: all pass, exit 0 — 3 new in `placement.test.ts`, 1 in `commands.test.ts`, 2 in `scene-view.test.tsx`, and every older one (the old placement and duplicate tests have no angle, so they land where they did).

- [ ] **Step 7: Typecheck and lint**

Run: `rtk proxy npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint src/lib/site/editor/placement.ts src/lib/site/editor/placement.test.ts src/lib/site/editor/commands.ts src/lib/site/editor/commands.test.ts "src/app/(admin)/site/editor/scene/engine.ts" "src/app/(admin)/site/editor/scene/scene-view.test.tsx"` — expected no errors (in particular, no unused `contains` or `overlap` left in `commands.ts` or `engine.ts`).

- [ ] **Step 8: Commit**

```bash
git add src/lib/site/editor/placement.ts src/lib/site/editor/placement.test.ts src/lib/site/editor/commands.ts src/lib/site/editor/commands.test.ts \
  "src/app/(admin)/site/editor/scene/engine.ts" "src/app/(admin)/site/editor/scene/scene-view.test.tsx"
git commit -m "feat(site): new and copied items land clear of a net's ropes

One landing rule for the library's click, its ghost and a duplicate: a net's
ropes inside the fence, nothing in a rope band. The gaps while dragging
measure to a net's stake line (the walkway).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Ropes and stakes in the scene

**Files:**
- Modify: `src/app/(admin)/site/editor/scene/meshes.ts` (`Part`, `geometryKey`, a new `ropes` builder, `buildItemObject`, `restyleItemObject`)
- Modify: `src/app/(admin)/site/editor/scene/scene-sync.ts` (an import; the net's `ropeCm`)
- Modify (tests): `src/app/(admin)/site/editor/scene/meshes.test.ts`, `scene-sync.test.ts` (append)

**Interfaces:**
- Consumes: `toPlaced` (Task 5), `SCENE_PALETTE` (`palette.ts`: `fence`, `clothEdge`, `bad`).
- Produces: `geometryKey(item: EditorItem, heightCm: number, ropeCm = 0): string` — the ropes are in it; `buildItemObject(item: EditorItem, heightCm: number, look: ItemLook, ropeCm = 0): THREE.Group` — for a net with `ropeCm > 0`, parts `rope` (one `LineSegments`, 8 ropes), `stake` (8 meshes) and `ropeEdge` (the dashed footprint), every one `userData.pick === false` and casting no shadow. `ropeEdge` is drawn in `bad` when the look's issue is `'outside'`, else `clothEdge`.

- [ ] **Step 1: Write the failing tests**

Append at the end of `src/app/(admin)/site/editor/scene/meshes.test.ts`:

```ts
describe('a net’s ropes', () => {
  // Spec §12's example: 8 × 8 m, 3 m high, ropes at 45°: stakes 3 m out.
  const roped = () => buildItemObject(item({ kind: 'shade', widthCm: 800, depthCm: 800, insetCm: 50 }), 300, NORMAL, 300);

  it('run two ropes from each corner to stakes one offset out, at right angles to its sides', () => {
    const net = roped();
    const [ropes] = parts(net, 'rope');
    expect(ropes.geometry.getAttribute('position').count).toBe(16);
    const stakes = parts(net, 'stake');
    expect(stakes.map((stake) => `${stake.position.x},${stake.position.z}`).sort()).toEqual([
      '-3,0', '-3,8', '0,-3', '0,11', '11,0', '11,8', '8,-3', '8,11',
    ]);
  });

  it('dash the footprint on the ground: 14 × 14 m', () => {
    const [edge] = parts(roped(), 'ropeEdge');
    const bounds = new THREE.Box3().setFromObject(edge);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(14);
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(14);
    expect(bounds.max.y).toBeLessThan(0.01);
  });

  it('are click-through and cast no shadow: ropes take ground, they do not shade it', () => {
    const net = roped();
    for (const part of ['rope', 'stake', 'ropeEdge']) {
      for (const mesh of parts(net, part)) {
        expect(mesh.userData.pick).toBe(false);
        expect(mesh.castShadow).toBe(false);
      }
    }
  });

  it('draw the footprint in the "bad" colour when the ropes cross the fence', () => {
    const net = roped();
    const [edge] = parts(net, 'ropeEdge');
    const colour = () => (edge.material as THREE.LineBasicMaterial).color.getHex();
    expect(colour()).toBe(new THREE.Color(SCENE_PALETTE.light.clothEdge).getHex());
    restyleItemObject(net, { ...NORMAL, issue: 'outside' });
    expect(colour()).toBe(new THREE.Color(SCENE_PALETTE.light.bad).getHex());
  });

  it('are not there without an angle, and a rope change is a new geometry', () => {
    const bare = buildItemObject(item({ kind: 'shade', widthCm: 800, depthCm: 800, insetCm: 50 }), 300, NORMAL);
    expect(parts(bare, 'rope')).toHaveLength(0);
    expect(parts(bare, 'stake')).toHaveLength(0);
    const net = item({ kind: 'shade', insetCm: 50 });
    expect(geometryKey(net, 300, 300)).not.toBe(geometryKey(net, 300, 0));
    expect(geometryKey(net, 300)).toBe(geometryKey(net, 300, 0));
  });
});
```

Append inside `describe('keeping the scene in step with the store', …)` in `src/app/(admin)/site/editor/scene/scene-sync.test.ts`, after its last test:

```ts
  it('rebuilds a net when the camp sets its rope angle, and draws its ropes then', () => {
    const count = (object: THREE.Object3D | undefined, part: string) => {
      let found = 0;
      object?.traverse((child) => { if (child.userData.part === part) found += 1; });
      return found;
    };
    const sync = new SceneSync();
    sync.sync(input([NET]));
    const before = sync.objectOf('net');
    expect(count(before, 'stake')).toBe(0);
    const roped = input([NET]);
    roped.doc.defaults = { shade: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } };
    sync.sync(roped);
    const after = sync.objectOf('net');
    expect(after).not.toBe(before);
    expect(count(after, 'rope')).toBe(1);
    expect(count(after, 'stake')).toBe(8);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run "src/app/(admin)/site/editor/scene/meshes.test.ts" "src/app/(admin)/site/editor/scene/scene-sync.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — no `rope`, `stake` or `ropeEdge` parts; the key ignores a third argument; the synced net is not rebuilt. The older tests pass.

- [ ] **Step 3: The meshes**

In `src/app/(admin)/site/editor/scene/meshes.ts`:

1. In `type Part`, after `| 'lineBody' | 'lineJoint'` add ` | 'rope' | 'stake' | 'ropeEdge'` (before the `;`).

2. Replace `geometryKey` and its comment with:

```ts
/**
 * What decides the geometry. Position is not in it: a move never rebuilds.
 * A net's ropes are (spec §14): a new angle, or a new height under an angle,
 * rebuilds the net.
 */
export function geometryKey(item: EditorItem, heightCm: number, ropeCm = 0): string {
  const inset = SITE_KINDS[item.kind].shape === 'net' ? item.insetCm ?? 0 : 0;
  return `${item.kind}:${item.widthCm}x${item.depthCm}x${heightCm}:${inset}:${ropeCm}`;
}
```

3. Right after the `net` builder function, add:

```ts
/**
 * A net's ropes (spec §15): from the top of each corner pole, two ropes to
 * stakes `r` metres out, each at right angles to one of the corner's sides —
 * the layout that keeps the footprint a rectangle — a 3 cm peg standing
 * 15 cm out of the ground at each stake, and the footprint dashed on the
 * ground. Seen from above in plan, the eight ropes are short strokes out
 * from the corners. All of it is click-through and casts no shadow: ropes
 * take ground, they do not shade it (D8).
 */
function ropes(group: THREE.Group, w: number, h: number, d: number, r: number): void {
  // Each corner, and the outward direction of its west/east side (x) and of its north/south side (z).
  const corners: Array<[number, number, number, number]> = [[0, 0, -1, -1], [w, 0, 1, -1], [w, d, 1, 1], [0, d, -1, 1]];
  const points: number[] = [];
  const stakes: Array<[number, number]> = [];
  for (const [x, z, outX, outZ] of corners) {
    stakes.push([x + outX * r, z], [x, z + outZ * r]);
    points.push(x, h, z, x + outX * r, 0, z, x, h, z, x, 0, z + outZ * r);
  }
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  group.add(tag(new THREE.LineSegments(lines, new THREE.LineBasicMaterial()), 'rope', false));

  const peg = new THREE.CylinderGeometry(0.015, 0.015, 0.15, 6);
  const pegMaterial = new THREE.MeshLambertMaterial();
  for (const [x, z] of stakes) {
    const stake = tag(new THREE.Mesh(peg, pegMaterial), 'stake', false);
    stake.position.set(x, 0.075, z);
    group.add(stake);
  }

  const edge = tag(new THREE.LineSegments(
    outline(-r, -r, w + r, d + r, 0.004),
    new THREE.LineDashedMaterial({ dashSize: 0.3, gapSize: 0.2 }),
  ), 'ropeEdge', false);
  edge.computeLineDistances();
  group.add(edge);
}
```

4. Change `export function buildItemObject(item: EditorItem, heightCm: number, look: ItemLook): THREE.Group {` to:

```ts
export function buildItemObject(item: EditorItem, heightCm: number, look: ItemLook, ropeCm = 0): THREE.Group {
```

in its `userData`, change `key: geometryKey(item, heightCm),` to `key: geometryKey(item, heightCm, ropeCm),`, and in its `switch`, replace

```ts
    case 'net':
      net(group, w, h, d, (item.insetCm ?? 0) * CM);
      break;
```

with

```ts
    case 'net':
      net(group, w, h, d, (item.insetCm ?? 0) * CM);
      if (ropeCm > 0) ropes(group, w, h, d, ropeCm * CM);
      break;
```

5. In `restyleItemObject`'s `switch`, after `case 'inset': material.color.set(palette.clothEdge); break;` add:

```ts
      case 'rope':
      case 'stake':
        material.color.set(palette.fence);
        break;
      case 'ropeEdge':
        // Red when the footprint crosses the fence: a net is outside by its ropes (D8).
        material.color.set(look.issue === 'outside' ? palette.bad : palette.clothEdge);
        break;
```

- [ ] **Step 4: The sync hands a net its ropes**

In `src/app/(admin)/site/editor/scene/scene-sync.ts`:

1. After `import { itemHeight } from '@/lib/site/defaults';` add `import { toPlaced } from '@/lib/site/derive';`.
2. Replace

```ts
      const height = itemHeight(item, input.doc.defaults);
      const key = geometryKey(drawn, height);
```

with

```ts
      const height = itemHeight(item, input.doc.defaults);
      // A net's ropes: its own angle, else the camp's (spec §12); its height moves them too (D18).
      const ropeCm = toPlaced(drawn, input.doc.defaults).ropeCm;
      const key = geometryKey(drawn, height, ropeCm);
```

3. Change `object = buildItemObject(drawn, height, look);` to `object = buildItemObject(drawn, height, look, ropeCm);`.

- [ ] **Step 5: Run the tests**

Run the Step 2 command. Expected: all pass, exit 0 — 5 new in `meshes.test.ts`, 1 in `scene-sync.test.ts`.

- [ ] **Step 6: Typecheck, lint and the three guard**

Run: `rtk proxy npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor/scene"` — expected no errors.
Run: `npx vitest run "src/app/(admin)/site/editor/three-guard.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"` — expected pass: `three` is still imported only under `scene/`.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(admin)/site/editor/scene/meshes.ts" "src/app/(admin)/site/editor/scene/meshes.test.ts" \
  "src/app/(admin)/site/editor/scene/scene-sync.ts" "src/app/(admin)/site/editor/scene/scene-sync.test.ts"
git commit -m "feat(site): ropes and stakes in the scene

Two ropes from each corner pole to stakes one offset out, a peg at each, and
the footprint dashed on the ground — red when the ropes cross the fence. All
click-through, none shading.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The net's inspector — "צל וחבלים"

**Files:**
- Create: `src/app/(admin)/site/editor/panels/ropes.tsx`
- Modify: `src/app/(admin)/site/editor/panels/inspector-item.tsx` (imports; the `shaded` line retires; the outside pill; the rope pills; the net's section)
- Modify: `src/app/(admin)/site/editor/panels/inspector.module.css` (append `.suffixed`)
- Modify (tests): `src/app/(admin)/site/editor/panels/ropes-panels.test.tsx` (an import; append)

**Interfaces:**
- Consumes: `readDegrees`, `NOT_WHOLE_DEGREES`, `ROPE_ANGLE_OUT_OF_RANGE` (Task 1); `patchOps`, `setKindDefaultOps`, `LOCKED_FIELDS` (Task 3); `toPlaced`, `groundRect`, `shadedRect` (Task 5); `EditorFlags.ropePairs` (Task 6).
- Produces (`ropes.tsx`): `campRopeAngle(doc: EditorDoc): number | null`; `outsideText(doc: EditorDoc, item: EditorItem): string`; `RopePills({ doc, item, flags, onPickIds }: { doc: EditorDoc; item: EditorItem; flags: EditorFlags; onPickIds: (ids: string[]) => void }): ReactElement | null`; `RopeSection({ doc, item, onRun }: { doc: EditorDoc; item: EditorItem; onRun: (label: string, ops: SiteOp[]) => void }): ReactElement`. `ItemInspector`'s props do not change. Task 10 appends the plot's pieces to the same file.

- [ ] **Step 1: Write the failing tests**

In `src/app/(admin)/site/editor/panels/ropes-panels.test.tsx`, change the degrees import (Task 4) to `import { NOT_WHOLE_DEGREES, ROPE_ANGLE_OUT_OF_RANGE } from '@/lib/site/editor/degrees';`, and append:

```tsx
/** A 3 × 3 m tent, in this file's fixture. */
function tent(over: Partial<EditorItem> & { id: string }): EditorItem {
  return item({ kind: 'tent', label: 'אוהל 1', widthCm: 300, depthCm: 300, insetCm: null, ...over });
}

/** The U+2066…U+2069 a pill puts around a name (spec §20). */
const iso = (name: string) => `⁦${name}⁩`;

/* The box's label carries a decorative "°" after it, so match its start. */
const angleBox = () => screen.getByLabelText(/^זווית החבלים מהקרקע/) as HTMLInputElement;

function typeAngle(text: string): void {
  fireEvent.change(angleBox(), { target: { value: text } });
  fireEvent.keyDown(angleBox(), { key: 'Enter' });
}

describe('a net’s ropes, in its inspector', () => {
  it('shows the shaded ground, the cloth and the rope footprint, and where the footprint came from (spec §15)', () => {
    renderItem(item({ id: 'n1' }));
    expect(screen.getByRole('heading', { name: 'צל וחבלים' })).toBeTruthy();
    expect(screen.getByText('7 × 7 מ׳ · 49 מ״ר')).toBeTruthy();
    expect(screen.getByText('8 × 8 מ׳ · 64 מ״ר')).toBeTruthy();
    expect(screen.getByText('14 × 14 מ׳ · 196 מ״ר')).toBeTruthy();
    expect(screen.getByText('היתדות 3 מ׳ מהבד: גובה 3 מ׳ ÷ tan 45°')).toBeTruthy();
    expect(angleBox().value).toBe('');
    expect(angleBox().placeholder).toBe('45');
    expect(screen.getByText('ברירת המחדל של רשתות צל')).toBeTruthy();
  });

  it('invites an angle while none is set anywhere, and the net is checked by its cloth (D16)', () => {
    renderItem(item({ id: 'n1' }), {});
    expect(screen.getByText(/^עוד לא נקבעה זווית לחבלים, ולכן הרשת נבדקת לפי הבד בלבד/)).toBeTruthy();
    expect(screen.queryByText('עם החבלים')).toBeNull();
    expect(angleBox().placeholder).toBe('');
  });

  it('applies a typed angle, and typing the camp’s leaves the net on the camp’s (as ruling P13 does for a height)', () => {
    const { onRun, after } = renderItem(item({ id: 'n1' }));
    typeAngle('30');
    expect(after().items[0].ropeAngleDeg).toBe(30);
    onRun.mockClear();
    typeAngle(' 45° ');
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses an angle outside 20–80, or not whole, in Hebrew, and sends nothing', () => {
    const { onRun } = renderItem(item({ id: 'n1' }));
    typeAngle('81');
    expect(screen.getByRole('alert').textContent).toBe(ROPE_ANGLE_OUT_OF_RANGE);
    expect(angleBox().getAttribute('aria-invalid')).toBe('true');
    typeAngle('45.5');
    expect(screen.getByRole('alert').textContent).toBe(NOT_WHOLE_DEGREES);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('stores its own angle as every net’s, and then follows it', () => {
    const { after } = renderItem(item({ id: 'n1', ropeAngleDeg: 30 }));
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הזווית כברירת המחדל של רשתות צל' }));
    expect(after().defaults.shade).toEqual({ ...CAMP_NETS, ropeAngleDeg: 30 });
    expect(after().items[0].ropeAngleDeg).toBeNull();
  });

  it('writes the nets’ default at the preset size when the camp has none yet (spec §13)', () => {
    const { after } = renderItem(item({ id: 'n1', ropeAngleDeg: 30 }), {});
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הזווית כברירת המחדל של רשתות צל' }));
    expect(after().defaults.shade).toEqual({ widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 30 });
  });

  it('goes back to the camp’s angle', () => {
    const { after } = renderItem(item({ id: 'n1', ropeAngleDeg: 30 }));
    fireEvent.click(screen.getByRole('button', { name: 'חזרה לזווית ברירת המחדל' }));
    expect(after().items[0].ropeAngleDeg).toBeNull();
  });

  it('offers neither link to a net already on the camp’s angle', () => {
    renderItem(item({ id: 'n1' }));
    for (const name of ['שמירת הזווית כברירת המחדל של רשתות צל', 'חזרה לזווית ברירת המחדל']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('holds a locked net’s angle: the box and the way back', () => {
    renderItem(item({ id: 'n1', ropeAngleDeg: 30, locked: true }));
    expect(angleBox().disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'חזרה לזווית ברירת המחדל' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says when only the ropes cross the fence, and names what stands in the band', () => {
    // Flush with the east fence by its cloth (1800 + 800 = 2600); its 3 m ropes reach past it.
    const net = item({ id: 'n1', xCm: 1800, yCm: 800 });
    const t3 = tent({ id: 't3', label: 'אוהל 3', xCm: 1450, yCm: 1000 });
    const t4 = tent({ id: 't4', label: 'אוהל 4', xCm: 1450, yCm: 1400 });
    const { onPickIds } = renderItem(net, { shade: CAMP_NETS }, [t3, t4]);
    expect(screen.getByText('החבלים יוצאים מהגדר')).toBeTruthy();
    expect(screen.queryByText('מחוץ לגדר')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `בשטח החבלים: ${iso('אוהל 3')}, ${iso('אוהל 4')}` }));
    expect(onPickIds).toHaveBeenLastCalledWith(['t3', 't4']);
  });

  it('tells a tent in a band whose band it is, and the pill selects both', () => {
    const net = item({ id: 'n1', xCm: 1800, yCm: 800 });
    const t3 = tent({ id: 't3', label: 'אוהל 3', xCm: 1450, yCm: 1000 });
    const { onPickIds } = renderItem(t3, { shade: CAMP_NETS }, [net]);
    fireEvent.click(screen.getByRole('button', { name: `בשטח החבלים של ${iso('רשת צל 1')}` }));
    expect(onPickIds).toHaveBeenLastCalledWith(['t3', 'n1']);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run "src/app/(admin)/site/editor/panels/ropes-panels.test.tsx" "src/app/(admin)/site/editor/panels/inspector-item.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — the 11 new tests (no heading "צל וחבלים", no angle box); every older test passes.

- [ ] **Step 3: `ropes.tsx`, the net's pieces**

Create `src/app/(admin)/site/editor/panels/ropes.tsx`:

```tsx
'use client';

/**
 * A shade net's ropes in the panels (spec §§12–15, §20). A net's ropes run
 * from the top of each corner pole to a stake one offset out, at right
 * angles to each side; the rectangle they reach is the net's footprint, and
 * that is what the fence check, the rope-band check, the gaps while dragging
 * and "שטח תפוס" measure (D8). Shade is still the cloth's.
 *
 * The offset is the net's height over the tangent of its angle — its own
 * angle, else the camp's for nets. Until the camp sets one there is no
 * angle and no footprint (D16), and every piece here says so with an
 * invitation rather than a number nobody measured.
 */

import { useId, useState, type KeyboardEvent, type ReactElement } from 'react';
import { cx } from '@/components/ui/cx';
import { Pill } from '@/components/ui/pill';
import { effectiveSize, itemHeight } from '@/lib/site/defaults';
import { toPlaced } from '@/lib/site/derive';
import { areaM2, contains, formatArea, formatMetres, formatSize, groundRect, shadedRect } from '@/lib/site/geometry';
import { patchOps, setKindDefaultOps } from '@/lib/site/editor/commands';
import { readDegrees } from '@/lib/site/editor/degrees';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { LOCKED_FIELDS, type SiteOp } from '@/lib/site/editor/ops';
import type { EditorFlags } from '../use-editor-store';
import chrome from './panel.module.css';
import styles from './inspector.module.css';

/** A name dropped into a Hebrew sentence that must stay a string (a `Pill`'s), isolated as spec §20 asks. */
const isolate = (name: string): string => `⁦${name}⁩`;

/** The camp's rope angle for nets, or null while none is set (D16). */
export function campRopeAngle(doc: EditorDoc): number | null {
  return effectiveSize('shade', doc.defaults).ropeAngleDeg;
}

/**
 * The words for an item flagged outside the fence: "החבלים יוצאים מהגדר" for
 * a net whose cloth is inside and only its ropes are not — the fix is its
 * angle or its height, not a drag across the plot — else "מחוץ לגדר".
 */
export function outsideText(doc: EditorDoc, item: EditorItem): string {
  return item.kind === 'shade' && contains(doc.plot, toPlaced(item, doc.defaults))
    ? 'החבלים יוצאים מהגדר'
    : 'מחוץ לגדר';
}

/**
 * The rope-band pills of the one-item inspector (spec §15): on a net, what
 * stands in its band, as one button that selects those items; on anything
 * else, each net whose band it stands in, as a button that selects both.
 */
export function RopePills({ doc, item, flags, onPickIds }: {
  doc: EditorDoc;
  item: EditorItem;
  flags: EditorFlags;
  onPickIds: (ids: string[]) => void;
}): ReactElement | null {
  const labelOf = (id: string) => doc.items.find((entry) => entry.id === id)?.label ?? '';
  if (item.kind === 'shade') {
    const inBand = flags.ropePairs.filter(([net]) => net === item.id).map(([, id]) => id);
    if (inBand.length === 0) return null;
    return (
      <button type="button" className={styles.chipButton} onClick={() => { onPickIds(inBand); }}>
        <Pill tone="warn" dot>{`בשטח החבלים: ${inBand.map((id) => isolate(labelOf(id))).join(', ')}`}</Pill>
      </button>
    );
  }
  const nets = flags.ropePairs.filter(([, id]) => id === item.id).map(([net]) => net);
  if (nets.length === 0) return null;
  return (
    <>
      {nets.map((net) => (
        <button key={net} type="button" className={styles.chipButton} onClick={() => { onPickIds([item.id, net]); }}>
          <Pill tone="warn" dot>{`בשטח החבלים של ${isolate(labelOf(net))}`}</Pill>
        </button>
      ))}
    </>
  );
}

/**
 * One net's ropes, in its inspector's "צל וחבלים" section (spec §15): the
 * angle, typed in whole degrees and read by `readDegrees`; then the three
 * nested rectangles — shaded ground ⊂ cloth ⊂ rope footprint — each with its
 * size and area, beside the height and angle that make them, and where the
 * footprint came from. With no angle anywhere, the section is an invitation.
 *
 * The camp's angle, typed, leaves the net following the camp's angle, as the
 * kind's height does (ruling P13): "ברירת המחדל של רשתות צל" means the net
 * moves with the camp's choice. A lock holds the angle, because the angle
 * moves the footprint (`LOCKED_FIELDS`).
 */
export function RopeSection({ doc, item, onRun }: {
  doc: EditorDoc;
  item: EditorItem;
  onRun: (label: string, ops: SiteOp[]) => void;
}): ReactElement {
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const camp = campRopeAngle(doc);
  const angle = item.ropeAngleDeg ?? camp;
  const placed = toPlaced(item, doc.defaults);
  const shaded = shadedRect(placed);
  const footprint = groundRect(placed);
  const held = item.locked && LOCKED_FIELDS.includes('ropeAngleDeg');

  function commit(): void {
    if (draft === null) return;
    const reading = readDegrees(draft);
    if (!reading.ok) {
      setRefusal(reading.error);
      return;
    }
    setDraft(null);
    setRefusal(null);
    if (reading.deg === null) return;
    const ops = patchOps(doc, item.id, { ropeAngleDeg: reading.deg === camp ? null : reading.deg });
    if (ops.length > 0) onRun(`זווית החבלים של ${item.label}`, ops);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      setDraft(null);
      setRefusal(null);
    }
  }

  function saveAsDefault(): void {
    if (item.ropeAngleDeg === null) return;
    const ops = [
      ...setKindDefaultOps(doc, 'shade', { ...effectiveSize('shade', doc.defaults), ropeAngleDeg: item.ropeAngleDeg }),
      // The net now follows the camp's angle rather than holding a copy of it.
      ...patchOps(doc, item.id, { ropeAngleDeg: null }),
    ];
    if (ops.length > 0) onRun('זווית החבלים של רשתות צל', ops);
  }

  function backToDefault(): void {
    const ops = patchOps(doc, item.id, { ropeAngleDeg: null });
    if (ops.length > 0) onRun('חזרה לזווית ברירת המחדל', ops);
  }

  return (
    <>
      <label className={styles.field}>
        זווית החבלים מהקרקע
        <span className={styles.suffixed}>
          <input
            className={cx(styles.input, styles.number)}
            inputMode="numeric"
            value={draft ?? (item.ropeAngleDeg === null ? '' : String(item.ropeAngleDeg))}
            placeholder={camp === null ? undefined : String(camp)}
            disabled={held}
            aria-invalid={refusal !== null || undefined}
            aria-describedby={refusal !== null ? errorId : undefined}
            onChange={(event) => { setDraft(event.target.value); }}
            onBlur={commit}
            onKeyDown={onKey}
          />
          <span aria-hidden="true">°</span>
        </span>
      </label>
      {item.ropeAngleDeg === null && camp !== null ? <p className={chrome.meta}>ברירת המחדל של רשתות צל</p> : null}
      {refusal === null ? null : <p className={styles.error} id={errorId} role="alert">{refusal}</p>}
      {angle === null ? (
        <p className={chrome.invite}>
          עוד לא נקבעה זווית לחבלים, ולכן הרשת נבדקת לפי הבד בלבד. זווית שתוקלד כאן תחול על הרשת הזו; שמירה שלה כברירת מחדל תחול על כל רשתות הצל.
        </p>
      ) : null}
      <dl className={styles.kv}>
        <dt>מצל בפועל</dt>
        <dd>
          <bdi>{shaded === null ? 'הרשת קטנה מכדי להצל' : `${formatSize(shaded.width, shaded.depth)} · ${formatArea(areaM2(shaded))}`}</bdi>
        </dd>
        <dt>הבד</dt>
        <dd>
          <bdi>{`${formatSize(item.widthCm, item.depthCm)} · ${formatArea(areaM2({ width: item.widthCm, depth: item.depthCm }))}`}</bdi>
        </dd>
        {placed.ropeCm > 0 ? (
          <>
            <dt>עם החבלים</dt>
            <dd><bdi>{`${formatSize(footprint.width, footprint.depth)} · ${formatArea(areaM2(footprint))}`}</bdi></dd>
          </>
        ) : null}
      </dl>
      {placed.ropeCm > 0 && angle !== null ? (
        <p className={chrome.meta}>
          <bdi>{`היתדות ${formatMetres(placed.ropeCm)} מהבד: גובה ${formatMetres(itemHeight(item, doc.defaults))} ÷ tan ${angle}°`}</bdi>
        </p>
      ) : null}
      <div className={styles.links}>
        <button type="button" className={chrome.link} onClick={saveAsDefault} disabled={item.ropeAngleDeg === null}>
          שמירת הזווית כברירת המחדל של רשתות צל
        </button>
        <button type="button" className={chrome.link} onClick={backToDefault} disabled={item.ropeAngleDeg === null || held}>
          חזרה לזווית ברירת המחדל
        </button>
      </div>
    </>
  );
}
```

Append to `src/app/(admin)/site/editor/panels/inspector.module.css`:

```css
/* A number box with its unit after it — the rope angle's "°" (spec §15). */
.suffixed {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.suffixed > input { flex: 1; min-inline-size: 0; }
```

- [ ] **Step 4: The one-item inspector uses them**

In `src/app/(admin)/site/editor/panels/inspector-item.tsx`:

1. After `import styles from './inspector.module.css';` add:

```ts
import { outsideText, RopePills, RopeSection } from './ropes';
```

2. Change `import { areaM2, formatArea, formatMetres, formatSize, metres, shadedRect, shadeState } from '@/lib/site/geometry';` to:

```ts
import { formatMetres, metres, shadeState } from '@/lib/site/geometry';
```

3. Delete the line `const shaded = isNet ? shadedRect(toPlaced(item)) : null;` (the shaded row moves into `RopeSection`).

4. Replace `{flags.outside.has(item.id) ? <Pill tone="bad" dot>מחוץ לגדר</Pill> : null}` with:

```tsx
          {flags.outside.has(item.id) ? <Pill tone="bad" dot>{outsideText(doc, item)}</Pill> : null}
```

and right after the line `{missing.map((kind) => <Pill key={kind} tone="warn" dot>{`בלי חיבור ל${LINE_KINDS[kind].noun}`}</Pill>)}` add:

```tsx
          <RopePills doc={doc} item={item} flags={flags} onPickIds={onPickIds} />
```

5. Replace the net's section — the block that begins `{isNet ? (` and whose heading is `<h3 className={styles.sectionTitle}>צל</h3>` — with:

```tsx
        {isNet ? (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>צל וחבלים</h3>
            <div className={cx(styles.fields, styles.fieldsTwo)}>
              {lengthBox('inset', 'שוליים בלי צל', metres(item.insetCm ?? DEFAULT_SHADE_INSET_CM))}
            </div>
            {/* The angle, then shaded ground ⊂ cloth ⊂ rope footprint, and where the footprint came from (spec §15). */}
            <RopeSection doc={doc} item={item} onRun={onRun} />
          </div>
        ) : null}
```

- [ ] **Step 5: Run the tests**

Run the Step 2 command. Expected: all pass, exit 0 — the 11 new tests, and every test of `inspector-item.test.tsx` (the strip box of a locked net is still disabled; nothing there reads the old "צל" heading).

- [ ] **Step 6: Typecheck and lint**

Run: `rtk proxy npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor/panels"` — expected no errors (no geometry name left unused in `inspector-item.tsx`).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(admin)/site/editor/panels/ropes.tsx" "src/app/(admin)/site/editor/panels/inspector-item.tsx" \
  "src/app/(admin)/site/editor/panels/inspector.module.css" "src/app/(admin)/site/editor/panels/ropes-panels.test.tsx"
git commit -m "feat(site): the net inspector's 'צל וחבלים' — the angle, three rectangles, and where they came from

An angle box read by readDegrees; shaded ground, cloth and rope footprint
with the source 'גובה ÷ tan זווית'; save the angle for every net, or go back
to it; an invitation while none is set; pills for ropes past the fence and
for what stands in a band.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: The ropes on the plot — area taken, the camp's angle, the chip, the rows, the minimap

**Files:**
- Modify: `src/app/(admin)/site/editor/panels/ropes.tsx` (an import; append `PlotTaken`, `PlotRopes`, `ropeProblems`)
- Modify: `src/app/(admin)/site/editor/panels/inspector-plot.tsx` (an import; `problemsOf`; the figures list; the shade section)
- Modify: `src/app/(admin)/site/editor/panels/checks-bar.tsx` (`Check`, the cases, a chip)
- Modify: `src/app/(admin)/site/editor/panels/minimap.tsx` (imports; `minimapBounds`; a dashed rectangle per roped net), `minimap.module.css` (append)
- Modify (tests): `src/app/(admin)/site/editor/panels/ropes-panels.test.tsx` (imports; append)

**Interfaces:**
- Consumes: `takenArea`, `toPlaced` (Tasks 5–6); `groundRect` (Task 5); `EditorFlags.ropePairs`, `flags.outside` (Task 6); `campRopeAngle`, `outsideText` (Task 9).
- Produces (`ropes.tsx`): `PlotTaken({ doc, onPickIds }): ReactElement` — a `<dt>`/`<dd>` pair; `PlotRopes({ doc, onPickIds }): ReactElement | null`; `ropeProblems(doc: EditorDoc, flags: EditorFlags): Array<{ key: string; tone: 'warn'; text: string; ids: string[] }>`. `PlotInspector`, `ChecksBar` and `Minimap` keep their props.

- [ ] **Step 1: Write the failing tests**

In `src/app/(admin)/site/editor/panels/ropes-panels.test.tsx`, add these imports:

```tsx
import type { ViewInfo } from '../scene/scene-view';
import { ChecksBar } from './checks-bar';
import { PlotInspector } from './inspector-plot';
import { Minimap } from './minimap';
```

and append:

```tsx
describe('the ropes on the plot, when nothing is selected', () => {
  const HREF = '/site?season=s26&act=plot';

  function renderPlot(map: EditorDoc) {
    const onPickIds = vi.fn();
    render(<PlotInspector doc={map} flags={flagsOf(map)} plotHref={HREF} onPickIds={onPickIds} />);
    return { onPickIds };
  }

  it('gives the area taken — footprints, ropes included, shared ground once — and it selects what it counts', () => {
    // The net's 14 × 14 m with its ropes, and a 3 × 3 m tent apart from it, of the plot's 624 m².
    const { onPickIds } = renderPlot(doc([item({ id: 'n1' }), tent({ id: 't1', xCm: 2000, yCm: 2000 })]));
    fireEvent.click(screen.getByRole('button', { name: '205 מ״ר מתוך 624 · 33%' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['n1', 't1']);
    expect(screen.getByText('כולל החבלים של רשתות הצל')).toBeTruthy();
  });

  it('says the camp’s angle, and the line opens a net', () => {
    const { onPickIds } = renderPlot(doc([item({ id: 'n1' }), item({ id: 'n2', label: 'רשת צל 2', xCm: 1500 })]));
    fireEvent.click(screen.getByRole('button', { name: 'זווית החבלים: 45° לכל הרשתות' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['n1']);
    expect(screen.getByText('החבלים לא מצלים — הם רק תופסים שטח.')).toBeTruthy();
  });

  it('says so when some nets keep an angle of their own', () => {
    const { onPickIds } = renderPlot(doc([item({ id: 'n1', ropeAngleDeg: 30 }), item({ id: 'n2', label: 'רשת צל 2', xCm: 1500 })]));
    fireEvent.click(screen.getByRole('button', { name: 'זווית החבלים: 45° לכל רשת בלי זווית משלה' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['n2']);
  });

  it('invites an angle while the camp has none, and the invitation opens a net without one of its own', () => {
    const { onPickIds } = renderPlot(doc([item({ id: 'n1', ropeAngleDeg: 30 }), item({ id: 'n2', label: 'רשת צל 2', xCm: 1500 })], {}));
    expect(screen.getByText('זווית החבלים עוד לא נקבעה')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'קביעת זווית' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['n2']);
  });

  it('lists a net whose ropes cross the fence, and each item in a band, as rows that select them', () => {
    const net = item({ id: 'n1', xCm: 1800, yCm: 800 });
    const { onPickIds } = renderPlot(doc([net, tent({ id: 't3', label: 'אוהל 3', xCm: 1450, yCm: 1000 })]));
    fireEvent.click(screen.getByRole('button', { name: 'החבלים יוצאים מהגדר: רשת צל 1' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['n1']);
    fireEvent.click(screen.getByRole('button', { name: 'בשטח החבלים: אוהל 3 · רשת צל 1' }));
    expect(onPickIds).toHaveBeenLastCalledWith(['n1', 't3']);
  });
});

describe('the checks bar, with ropes', () => {
  // A tent half in the band west of the net's cloth.
  const map = (defaults?: KindDefaults) => doc([item({ id: 'n1' }), tent({ id: 't1', xCm: 250, yCm: 700 })], defaults);

  it('counts what stands in a net’s rope band, and a press goes to the net and the item', () => {
    const shown = map();
    const onGo = vi.fn();
    render(<ChecksBar doc={shown} flags={flagsOf(shown)} onGo={onGo} />);
    const chip = screen.getByRole('button', { name: '1 בשטח החבלים' });
    expect(chip.getAttribute('title')).toBe('פריטים שעומדים בין שולי הבד של רשת צל לבין היתדות שלה');
    fireEvent.click(chip);
    expect(onGo).toHaveBeenCalledWith(['n1', 't1']);
  });

  it('says nothing about ropes while the camp has no angle (D16)', () => {
    const shown = map({});
    render(<ChecksBar doc={shown} flags={flagsOf(shown)} onGo={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /בשטח החבלים/ })).toBeNull();
  });
});

describe('the minimap, with ropes', () => {
  const STILL: ViewInfo = { yaw: 0, zoomPct: 100, pxPerM: 20, groundCorners: [], selectionBox: null, moving: false };

  it('dashes a net’s rope footprint, marks it when it crosses the fence, and frames the stakes past the fence', () => {
    const shown = doc([item({ id: 'n1', xCm: 1800, yCm: 800 })]);
    const { container } = render(<Minimap doc={shown} flags={flagsOf(shown)} selection={[]} info={STILL} onJump={vi.fn()} />);
    const ropes = container.querySelector('rect[data-ropes="n1"]');
    expect(['x', 'y', 'width', 'height'].map((name) => ropes?.getAttribute(name))).toEqual(['1500', '500', '1400', '1400']);
    expect(ropes?.getAttribute('data-outside')).toBe('true');
    const [x, , width] = (screen.getByRole('img', { name: /מפה מוקטנת/ }).getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect(x + width).toBeGreaterThanOrEqual(2900);
  });

  it('draws no rope footprint while the camp has no angle', () => {
    const shown = doc([item({ id: 'n1' })], {});
    const { container } = render(<Minimap doc={shown} flags={flagsOf(shown)} selection={[]} info={STILL} onJump={vi.fn()} />);
    expect(container.querySelector('rect[data-ropes]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run "src/app/(admin)/site/editor/panels" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — the 9 new tests (no "שטח תפוס", no angle line, no rope rows or chip, no dashed rectangle); every older panel test passes. The two "no angle" tests may pass already; they pin D16.

- [ ] **Step 3: The plot's pieces in `ropes.tsx`**

In `src/app/(admin)/site/editor/panels/ropes.tsx`, change `import { toPlaced } from '@/lib/site/derive';` to `import { takenArea, toPlaced } from '@/lib/site/derive';`, and append:

```tsx
/**
 * שטח תפוס (spec §3, §15): the union of every item's footprint — a net's
 * with its ropes — inside the fence, against the plot's area. Pressing the
 * figure selects every item it counts; "כולל החבלים של רשתות הצל" says when
 * ropes are in it. A `<dt>`/`<dd>` pair for `PlotInspector`'s figures.
 */
export function PlotTaken({ doc, onPickIds }: {
  doc: EditorDoc;
  onPickIds: (ids: string[]) => void;
}): ReactElement {
  const taken = takenArea(doc.plot, doc.items.map((entry) => toPlaced(entry, doc.defaults)));
  const plotM2 = areaM2(doc.plot);
  const share = plotM2 === 0 ? 0 : Math.round((taken.areaM2 / plotM2) * 100);
  const figure = `${formatArea(taken.areaM2)} מתוך ${plotM2} · ${share}%`;
  return (
    <>
      <dt>שטח תפוס</dt>
      <dd>
        {taken.ids.length === 0 ? <bdi>{figure}</bdi> : (
          <button type="button" className={chrome.link} onClick={() => { onPickIds(taken.ids); }}>
            <bdi>{figure}</bdi>
          </button>
        )}
        {taken.withRopes ? <p className={chrome.meta}>כולל החבלים של רשתות הצל</p> : null}
      </dd>
    </>
  );
}

/**
 * The camp's rope angle, under "צל" in the plot inspector (spec §15): a line
 * that opens a net following it — "זווית החבלים: 45° לכל הרשתות", or "… לכל
 * רשת בלי זווית משלה" when some nets keep their own — and, while the camp
 * has none, an invitation whose button opens a net without an angle of its
 * own. With no nets there is nothing to say.
 */
export function PlotRopes({ doc, onPickIds }: {
  doc: EditorDoc;
  onPickIds: (ids: string[]) => void;
}): ReactElement | null {
  const nets = doc.items.filter((entry) => entry.kind === 'shade');
  if (nets.length === 0) return null;
  const camp = campRopeAngle(doc);
  const following = nets.find((net) => net.ropeAngleDeg === null) ?? nets[0];
  const someOwn = nets.some((net) => net.ropeAngleDeg !== null);
  return (
    <>
      {camp === null ? (
        <p className={chrome.invite}>
          <span>זווית החבלים עוד לא נקבעה</span>
          {' '}
          <button type="button" className={chrome.link} onClick={() => { onPickIds([following.id]); }}>קביעת זווית</button>
        </p>
      ) : (
        <p className={chrome.meta}>
          <button type="button" className={chrome.link} onClick={() => { onPickIds([following.id]); }}>
            <bdi>{someOwn ? `זווית החבלים: ${camp}° לכל רשת בלי זווית משלה` : `זווית החבלים: ${camp}° לכל הרשתות`}</bdi>
          </button>
        </p>
      )}
      <p className={chrome.hint}>החבלים לא מצלים — הם רק תופסים שטח.</p>
    </>
  );
}

/** The plot inspector's rows for items in a rope band (spec §15): "בשטח החבלים: אוהל 3 · רשת צל 1", selecting both. */
export function ropeProblems(
  doc: EditorDoc, flags: EditorFlags,
): Array<{ key: string; tone: 'warn'; text: string; ids: string[] }> {
  const labelOf = (id: string) => doc.items.find((entry) => entry.id === id)?.label ?? '';
  return flags.ropePairs.map(([net, id]) => ({
    key: `ropes:${net}:${id}`, tone: 'warn', text: `בשטח החבלים: ${labelOf(id)} · ${labelOf(net)}`, ids: [net, id],
  }));
}
```

- [ ] **Step 4: The plot inspector uses them**

In `src/app/(admin)/site/editor/panels/inspector-plot.tsx`:

1. After `import styles from './inspector.module.css';` add:

```ts
import { outsideText, PlotRopes, PlotTaken, ropeProblems } from './ropes';
```

2. In `problemsOf`, change `key: \`outside:${entry.id}\`, tone: 'bad', text: \`מחוץ לגדר: ${entry.label}\`, ids: [entry.id],` to:

```ts
      key: `outside:${entry.id}`, tone: 'bad', text: `${outsideText(doc, entry)}: ${entry.label}`, ids: [entry.id],
```

and after the last spread in its array (the one that makes `edge:` rows, ending `})),`) add:

```ts
    ...ropeProblems(doc, flags),
```

3. In the figures list, right after the `<dd>` that shows the plot's area (`<dd><Link href={plotHref} className={chrome.link}><bdi>{formatArea(areaM2(plot))}</bdi></Link></dd>`), add:

```tsx
          <PlotTaken doc={doc} onPickIds={onPickIds} />
```

4. In the "צל" section, right after `<Count name="רשתות צל" figure={String(shade.nets)} ids={netIds} onPickIds={onPickIds} />`, add:

```tsx
              <PlotRopes doc={doc} onPickIds={onPickIds} />
```

- [ ] **Step 5: The checks bar's chip**

In `src/app/(admin)/site/editor/panels/checks-bar.tsx`:

1. Change `type Check = 'outside' | 'pairs' | 'partly';` to `type Check = 'outside' | 'pairs' | 'partly' | 'ropes';`.
2. In `cases`, after `partly: …,` add:

```ts
    ropes: flags.ropePairs.map(([net, id]) => [net, id]),
```

3. After the `if (cases.partly.length > 0) { … }` block add:

```ts
  if (cases.ropes.length > 0) {
    chips.push({
      check: 'ropes', tone: 'warn', text: `${cases.ropes.length} בשטח החבלים`,
      title: 'פריטים שעומדים בין שולי הבד של רשת צל לבין היתדות שלה',
    });
  }
```

4. In the file's opening comment, change `how many sit in a net's unshaded strip — or "הכול` to `how many sit in a net's unshaded strip, how many stand in a net's rope band — or "הכול`.

- [ ] **Step 6: The minimap's footprints**

In `src/app/(admin)/site/editor/panels/minimap.tsx`:

1. Replace `import { unionRect } from '@/lib/site/geometry';` with:

```ts
import { toPlaced } from '@/lib/site/derive';
import { groundRect, unionRect } from '@/lib/site/geometry';
```

and `import { rectOf, type EditorDoc } from '@/lib/site/editor/model';` with `import type { EditorDoc } from '@/lib/site/editor/model';`.

2. In `minimapBounds`, replace `const all = unionRect([plot, ...doc.items.map(rectOf)]) ?? plot;` with:

```ts
  // Footprints, not rectangles: a net's stakes past the fence are drawn, so they are framed too.
  const all = unionRect([plot, ...doc.items.map((item) => groundRect(toPlaced(item, doc.defaults)))]) ?? plot;
```

3. Right after the items' `))}` (the end of `{doc.items.map((item) => ( <rect … /> ))}`) and before the comment `{/* The pipes and cables, … */}`, add:

```tsx
        {/* A net's rope footprint, dashed (spec §15): where its stakes stand; red when they cross the fence. */}
        {doc.items.map((item) => {
          const placed = toPlaced(item, doc.defaults);
          if (placed.ropeCm === 0) return null;
          const ground = groundRect(placed);
          return (
            <rect
              key={`ropes-${item.id}`}
              data-ropes={item.id}
              data-outside={flags.outside.has(item.id) || undefined}
              className={cx(styles.mmRopes, chrome[`g_${SITE_KINDS[item.kind].group}`])}
              x={ground.x}
              y={ground.y}
              width={ground.width}
              height={ground.depth}
            />
          );
        })}
```

Append to `src/app/(admin)/site/editor/panels/minimap.module.css`:

```css
/* A net's rope footprint (spec §15): dashed in the net's colour, red when its stakes cross the fence. */
.mmRopes { fill: none; stroke: var(--swatch); stroke-width: 1px; stroke-dasharray: 3 2; vector-effect: non-scaling-stroke; }
.mmRopes[data-outside='true'] { stroke: var(--bad); }
```

- [ ] **Step 7: Run the tests**

Run the Step 2 command. Expected: all pass, exit 0 — the 9 new tests and every older panel test (the minimap's older tests have no ropes, so their bounds do not move).

- [ ] **Step 8: Typecheck and lint**

Run: `rtk proxy npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor/panels"` — expected no errors.
Run: `npx vitest run "src/app/(admin)/site/editor/editor-styles.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"` — expected pass (the style rules the editor's CSS keeps).

- [ ] **Step 9: Commit**

```bash
git add "src/app/(admin)/site/editor/panels/ropes.tsx" "src/app/(admin)/site/editor/panels/inspector-plot.tsx" \
  "src/app/(admin)/site/editor/panels/checks-bar.tsx" "src/app/(admin)/site/editor/panels/minimap.tsx" \
  "src/app/(admin)/site/editor/panels/minimap.module.css" "src/app/(admin)/site/editor/panels/ropes-panels.test.tsx"
git commit -m "feat(site): rope checks in the checks bar, the plot inspector and the minimap

'שטח תפוס' — the union of footprints, ropes included — selects what it
counts; the camp's angle, or an invitation to set one; 'N בשטח החבלים' and
its rows; a net whose ropes alone cross the fence says so; the minimap
dashes each footprint.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Verification and hand-off — the full suite, the migration, a browser, the collab docs, the PR body

**Files:**
- Modify: `docs/deploy.md` (§6: a record for `0014`)
- Modify: `docs/collab/claims.md` (the row from the preflight)
- Modify, only if `next dev` rewrote it: `AGENTS.md`
- Create, **not committed** (`/.superpowers/` is gitignored): `.superpowers/site-ropes/pr-body.md` and the screenshots beside it

**Interfaces:**
- Consumes: everything Tasks 1–10 built.
- Produces: the numbers the PR states, a browser check of spec §22's Part B case, the `0014` record for the camp lead, and a PR body on disk. The PR itself is not opened here.

This task is the coordinator's: the full suite runs once, here (`CLAUDE.md`: lanes run their own scope). The browser check never saves to the shared development database without the camp lead's yes.

- [ ] **Step 1: Make sure nobody else is mid-run**

```bash
pgrep -fl vitest
pgrep -fl "next build"
```

Expected: no output from either. If a run is going, wait for it to end (Monitor with an until-loop on `pgrep -fl vitest`); do not start a second.

- [ ] **Step 2: Run the full suite, once**

```bash
cd /Users/yarin/GitProjects/Shliff_Platform-lanes/site-ropes
OUT=".vitest/json/run-$$-full.json"
npx vitest run --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile "$OUT"
echo "exit=$? report=$OUT"
```

(`timeout` 600000 on the Bash call.) Write down the `exit=` value and the report path.

- [ ] **Step 3: Read the verdict with instruments the suite did not produce**

```bash
node -e "const r=require(require('path').resolve(process.argv[1]));console.log(JSON.stringify({total:r.numTotalTests,passed:r.numPassedTests,failed:r.numFailedTests,pending:r.numPendingTests,files:r.numTotalTestSuites,failedFiles:r.numFailedTestSuites}))" "<the report path from Step 2>"
node -e "const fs=require('fs'),p=require('path');let n=0;(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())w(f);else if(/\.test\.tsx?$/.test(e.name))n++;}})('src');console.log('test files on disk:',n)"
node -e "const fs=require('fs'),p=require('path');const hits=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())w(f);else if(/\.test\.tsx?$/.test(e.name)&&/\b(it|describe|test)\.(skip|todo)\(/.test(fs.readFileSync(f,'utf8')))hits.push(f);}})('src');console.log('files with a deliberate skip:',hits.length,hits.join(' '))"
```

Green only if: `exit=0` **and** `failed: 0` (a non-zero exit with `failed: 0` is dead workers — read the `Unhandled Errors` block, `pgrep -fl vitest`, rerun once when the box is quiet); `files` equals the test files on disk; `pending` equals the tests in files with a deliberate skip. A failure is investigated, not labelled: rerun that file with the capped command, and fix it test-first in the file that owns the code.

- [ ] **Step 4: Typecheck, lint and build, as CI does**

Run: `rtk proxy npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npm run lint` — expected no errors.
Run: `npx next build` (after `pgrep -fl vitest` shows nothing) — expected exit 0, `/site` marked `ƒ` (dynamic).

- [ ] **Step 5: The migration, once more — generated, numbered right, handed to the camp lead**

1. **Generated, never pushed or migrated.** `0014_site_rope_angles.sql` was made by `npx drizzle-kit generate` in Task 2; nothing in this branch ran `drizzle-kit push` or `drizzle-kit migrate`, and nothing may (`docs/deploy.md` §6: `push` offered to truncate real budget rows; `migrate` re-runs 0002–0004). Read the file with the Read tool: exactly the two `ALTER TABLE … ADD COLUMN "rope_angle_deg" integer` statements.
2. **Re-check the number at merge time.** #23 merged on 2026-09-25 (`6c92ce9`) and took `0013`, which is why this is `0014`. Another branch may still land a migration first, so check `origin/main` now, and again right before the PR merges:

```bash
/usr/bin/git fetch origin
/usr/bin/git ls-tree --name-only origin/main drizzle/ | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const f=s.trim().split('\n').filter(n=>n.endsWith('.sql')).sort();console.log(f.length,f[f.length-1])})"
```

Expected: `14 drizzle/0013_site_lines.sql`. If `origin/main` already has a `0014_*` (anyone's), this branch's number is taken: `/usr/bin/git merge origin/main`; delete `drizzle/0014_site_rope_angles.sql` and `drizzle/meta/0014_snapshot.json` and restore `drizzle/meta/_journal.json` to `origin/main`'s (`git checkout origin/main -- drizzle/meta/_journal.json`); run `npx drizzle-kit generate --name site_rope_angles` again (it takes the next free number); rerun Task 2's schema test; and change every "`0014`" in `docs/deploy.md`, `docs/collab/claims.md` and the PR body to the new number.
3. **The camp lead applies it by hand.** Add this record to `docs/deploy.md` §6, after the `0013` record and before `### Copying the laptop's database up`, with today's date:

````markdown
### Migration `0014` — generated <YYYY-MM-DD>, **not yet applied**

`0014_site_rope_angles` is the shade nets' rope angle (spec
`2026-09-25-site-map-pipes-ropes-underlay-design.md` §13): two nullable
columns, `site_items.rope_angle_deg` and `site_kind_defaults.rope_angle_deg`.
Additive: every existing row takes null, which means "no angle", so no net's
checks change until the camp sets one (D16). It must be on Railway **after
`0013` and before** the code that reads it deploys, because every `/site`
query selects the new columns. Applying it is the camp lead's step, by the
same procedure as `0012`:

```sh
docker run --rm -e R="$RAILWAY_URL" -v "$PWD/drizzle:/m:ro" postgres:18-alpine sh -euc '
  psql "$R" -v ON_ERROR_STOP=1 -1 -f /m/0014_site_rope_angles.sql
'
```

Read-only check before and after — `0` before, `2` after; the plan and item
counts do not move:

```sh
docker run --rm -e R="$RAILWAY_URL" postgres:18-alpine sh -c '
  psql "$R" -tAc "select count(*) from information_schema.columns where column_name='"'"'rope_angle_deg'"'"'"'
```

Record the measured numbers here when it is done.
````

```bash
git add docs/deploy.md
git commit -m "docs(deploy): migration 0014 — the rope angles, for the camp lead to apply after 0013

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: The browser check's preconditions — stop if any fails**

Each one that fails is a **STOP and ask the camp lead**, never a fix:

1. `docker ps -a --filter name=shliff` — `shliff-pg` `Up`, publishing **5433**. Stopped or missing: STOP. It is stopped on purpose to relieve memory pressure; do not start it.
2. Migrations `0013` and `0014` in the local database (read-only):
   `docker exec shliff-pg psql -U shliff -d shliff -tAc "select (select count(*) from information_schema.tables where table_name='site_lines'), (select count(*) from information_schema.columns where column_name='rope_angle_deg')"` — expected `1|2`. Anything else: STOP, and ask whether `0013`/`0014` may be applied to `shliff-pg` with `docker exec -i shliff-pg psql -U shliff -d shliff -v ON_ERROR_STOP=1 -1 < drizzle/<file>.sql` — both are additive, but the database is shared.
3. A season with a map that has a shade net (read-only):
   `docker exec shliff-pg psql -U shliff -d shliff -tAc "select s.id, s.name, count(i.id) filter (where i.kind='shade') from site_plans p join seasons s on s.id = p.season_id left join site_items i on i.plan_id = p.id group by s.id, s.name order by s.name"` — pick one with a net; call its id `<season>`. None: STOP.
4. `.env.local` exists in the worktree (`git check-ignore -v .env.local` names `.gitignore`); if not, copy it from `/Users/yarin/GitProjects/Shliff_Platform/.env.local`. Never stage it.
5. A free port: `lsof -nP -iTCP:3000 -sTCP:LISTEN`; if anything answers use 3001, then 3002. Start `npm run dev -- --port <port>` with the Bash tool's `run_in_background`, and poll `curl -s -o /dev/null -w '%{http_code}' http://localhost:<port>/signin` until `200`.

- [ ] **Step 7: The browser tools, a sign-in, and writes blocked**

Load the Playwright tools in one ToolSearch call: `select:mcp__plugin_playwright_playwright__browser_navigate,mcp__plugin_playwright_playwright__browser_snapshot,mcp__plugin_playwright_playwright__browser_click,mcp__plugin_playwright_playwright__browser_drag,mcp__plugin_playwright_playwright__browser_press_key,mcp__plugin_playwright_playwright__browser_take_screenshot,mcp__plugin_playwright_playwright__browser_console_messages,mcp__plugin_playwright_playwright__browser_run_code_unsafe,mcp__plugin_playwright_playwright__browser_evaluate,mcp__plugin_playwright_playwright__browser_type`.

`browser_navigate` to `http://localhost:<port>/signin`, then **STOP and ask the camp lead** to sign in in that window, or for a local admin's credentials. Then block every write before the map opens, with `browser_run_code_unsafe`:

```js
async (page) => {
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST' || !request.headers()['next-action']) return route.continue();
    let args = null;
    try { args = JSON.parse(request.postData() ?? ''); } catch { args = null; }
    // One string (or null) argument is a read: loadSiteDocAction(planId), the rail's counts.
    const read = Array.isArray(args) && args.length === 1 && (typeof args[0] === 'string' || args[0] === null);
    return read ? route.continue() : route.abort('failed');
  });
  return 'writes are blocked; reads pass';
}
```

`browser_navigate` to `http://localhost:<port>/site?season=<season>`. **Positive control on the block:** select any item and press `r`; after two seconds the top bar must read "לא נשמר —" with "ניסיון חוזר". If it reads "כל השינויים נשמרו", the block did not hold: press `Meta+z` at once and tell the camp lead. From here on every edit shows "לא נשמר" — the store still applies it, so the screen shows what it would save.

- [ ] **Step 8: Walk Part B — once in 3D and light, once in plan (`2`) and dark**

Theme with `browser_evaluate`: `() => { document.documentElement.dataset.theme = 'light'; }` (then `'dark'` for the second pass). Screenshot (`browser_take_screenshot`, `site-ropes-<n>-<what>.png`) wherever the expectation is visual.

| # | Do | Expected |
|---|---|---|
| 1 | Before any angle: select a net; then clear the selection | The net's "צל וחבלים" with the invitation "עוד לא נקבעה זווית לחבלים…", rows "מצל בפועל" and "הבד" only. The plot's "זווית החבלים עוד לא נקבעה" with "קביעת זווית"; "שטח תפוס" with no "כולל החבלים" line. The checks bar says what it said on `main` (D16) |
| 2 | "קביעת זווית" | A net is selected and flies into view; its inspector shows the angle box |
| 3 | Type `45` + Enter in "זווית החבלים מהקרקע" | In 3D, two ropes from each corner pole to eight pegs and a dashed footprint on the ground; in plan, eight strokes out from the corners and the dashed outline. Rows "עם החבלים" and "היתדות … מהבד: גובה … ÷ tan 45°" |
| 4 | "שמירת הזווית כברירת המחדל של רשתות צל" | Every net gets ropes; the box empties to the placeholder 45 with "ברירת המחדל של רשתות צל"; the library's net tile gets its "changed" dot; the plot reads "זווית החבלים: 45° לכל הרשתות"; "שטח תפוס" grows, with "כולל החבלים של רשתות הצל" |
| 5 | Drag a net toward a fence until its cloth is about a metre inside | The net's pill "החבלים יוצאים מהגדר"; the chip "N מחוץ לגדר"; the dashed outline and the minimap's dashed rectangle turn red; the plot's row "החבלים יוצאים מהגדר: …" |
| 6 | Drag a tent alongside a roped net, not under it | While dragging, the gap pill on that side measures to the stake line, not to the cloth |
| 7 | Drop the tent in the band | Its pill "בשטח החבלים של …" (the button selects both); the chip "1 בשטח החבלים"; on the net, "בשטח החבלים: …"; the plot's row "בשטח החבלים: … · …" |
| 8 | Drag the "אוהל" tile from the library over the band; then click the tile | The ghost's pill "בשטח החבלים של רשת צל"; the click lands a tent clear of every band |
| 9 | On a roped net, type its height `4` | The footprint grows (D18); the source line names 4 m |
| 10 | Type `81`, then `45.5`, in the angle box | "זווית החבלים היא מספר שלם של מעלות, מ־20 עד 80", then "צריך מספר שלם של מעלות — למשל 45"; nothing sent |
| 11 | Lock the net | The angle box and "חזרה לזווית ברירת המחדל" are disabled |
| 12 | "צל לפי שעה", 12:00 | Shadows and counts by the cloth only; the ropes cast none |
| 13 | `browser_console_messages` with `level: "error"` | None |

On the camp's real map expect the main shade to be flagged once an angle is set: #20 landed it 28 × 20 m, 4 m high, 2 m inside the fence, and at 45° its stakes stand 4 m out. That is the feature working on real data: tell the camp lead, and change nothing (the writes are blocked in any case). The map never mirrors in either pass.

- [ ] **Step 9: Leave everything as it was found**

1. In the blocked tab, reload the map through the conflict banner's "טעינת הגרסה העדכנית", or navigate to the page again: every unsaved edit of the walk is dropped.
2. Stop the dev server; close the browser.
3. Copy the screenshots the MCP saved into `.superpowers/site-ropes/`.
4. `git status --short`. If `AGENTS.md` is modified, it is the Next.js block `next dev` regenerates (`CLAUDE.md`, "Traps"):

```bash
git add AGENTS.md
git commit -m "chore: AGENTS.md's Next.js block as next dev writes it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Nothing else may be uncommitted: `.env.local`, `.superpowers/` and `.vitest/` are ignored.

- [ ] **Step 10: Say what is in flight — `docs/collab/claims.md`**

Read it (its §1 first). Replace the row the preflight added with this one, filling the two numbers from Step 3 and today's date, and bump the `**updated: …**` stamp:

```
| @Yarin-Shitrit | Camp map — shade-net ropes (spec Part B) | `feat/site-ropes` | **ready for review** — a net's ropes drawn to their stakes; once the camp sets an angle, the rope footprint is what the fence check, the new rope-band check, the gaps while dragging and "שטח תפוס" measure; shade stays the cloth's (spec `docs/superpowers/specs/2026-09-25-site-map-pipes-ropes-underlay-design.md` §§12–15, plan `docs/superpowers/plans/2026-09-25-site-ropes.md`). Full suite <total> tests in <files> files, 0 failed. Touches shared surfaces: migration **`0014_site_rope_angles`** (generated, **not applied to Railway** — the camp lead's step after `0013`, `docs/deploy.md` §6), `drizzle/meta/*`, the overview plan's interface contract, this file. Review goes to @josefcohen96 | <today> |
```

```bash
git add docs/collab/claims.md
git commit -m "docs(collab): the shade-net ropes are ready for review

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 11: Write the PR body to a file**

Create `.superpowers/site-ropes/pr-body.md` (gitignored; the camp lead opens the PR). Fill every `<…>` from this task's own output, never from memory:

```markdown
## What this does

A shade net's ropes are drawn from each corner pole down to their stakes, and once the camp sets a rope angle, the rope edge is the net's footprint: the fence check, a new rope-band check ("N בשטח החבלים"), the gap readouts while dragging and the plot's new "שטח תפוס" all use it. Shade is still cast by the cloth alone. Until an angle is set, nothing changes on any map (D16).

Spec: `docs/superpowers/specs/2026-09-25-site-map-pipes-ropes-underlay-design.md` §§12–15 (Part B), with the camp lead's §27 answers. Plan: `docs/superpowers/plans/2026-09-25-site-ropes.md`.

## Shared surfaces touched

- `drizzle/0014_site_rope_angles.sql`, `drizzle/meta/0014_snapshot.json`, `drizzle/meta/_journal.json` — the shared migration sequence. Generated with `npx drizzle-kit generate`; never `push`, never `migrate`. Additive: two nullable columns. **Not applied to Railway**: the camp lead applies it by hand after `0013`, before this deploys (`docs/deploy.md` §6 has the record and the read-only check). Number re-checked against `origin/main` on <date>.
- `docs/superpowers/plans/2026-09-24-site-3d-00-overview.md` — the interface contract, amended first (Part B's names).
- `docs/collab/claims.md` — this branch's row.
- `docs/deploy.md` §6 — the `0014` record.

## Merge notes

- #23 (utility lines) is already on `main`; this is built on it.
- Open PRs editing the same files, all additively on this side: #25 (`plan.ts`, `ops.ts`, `failure-messages.ts`, `use-editor-store.ts`, `plot-drawer.tsx`, `inspector-item.tsx`, `inspector-plot.tsx`, and test fixtures), #24 and #26 (`scene/engine.ts`, `page.tsx`, test fixtures). Every test fixture that builds an `EditorItem`, `KindSize` or `EditorFlags` gained one field.

## Tests

- Full suite: <total> tests in <files> files, <failed> failed, <pending> pending (Step 3's JSON line).
- `tsc`, `npm run lint` and `next build` clean.
- New: `degrees.test.ts`, `derive.test.ts`, `use-editor-store.ropes.test.ts`, `plot-drawer.ropes.test.tsx`, `panels/ropes-panels.test.tsx`; additions in `geometry`, `ops`, `commands`, `placement`, `plan`, `site` (schema), `meshes`, `scene-sync` and `scene-view` tests.

## In a browser

<Step 8's table, row by row: done / what was seen, with the screenshots' names; and what the camp's real map showed once an angle was set.>

## Not in this PR (spec §25)

The angle in the several-items inspector; ropes on some sides only, poles mid-side, nets tied to each other; ropes and stakes in a purchase list.

Review requested: @josefcohen96.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
