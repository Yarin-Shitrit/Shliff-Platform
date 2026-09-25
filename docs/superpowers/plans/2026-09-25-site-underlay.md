# מפת הקאמפ — Part C: an image to trace (תמונת רקע) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lead uploads a photo or scan of the camp's sketch. It lies under the map, see-through, only admins can see it, and it is scaled from one known distance. Moves and quarter turns line it up, and items are placed on it by hand as today.

**Architecture:** The file goes through a route, never a server action. `POST /site/underlay/<planId>` checks it and writes it with the existing storage driver under a key made from its own hash. `GET /site/underlay/<planId>/<file>` serves it to admins only. Where the image lies is saved as a new op, `setUnderlay`, in the editor's existing versioned batch (`applySiteOps`) and stored in a new table, `site_underlays` (migration `0015`). The rules are pure modules in `src/lib/site/` (limits and keys, header reading, placement maths, commands). The scene draws the image as one textured plane in three's opaque pass. The calibration and alignment tools get their own small pointer machine, so `gestures.ts` is not touched. A card in the editor's card stack holds upload, calibration, alignment, opacity and removal. How each viewer sees the image (shown or hidden, its opacity) lives in `EditorUi` and is never saved.

**Tech Stack:** Next.js 16.3.4 (App Router route handlers), React 19.2.8, TypeScript 5.9, drizzle-orm 0.45 + drizzle-kit 0.31, pglite (tests), `three@0.186.1`, `@vercel/blob` 2.8 through `src/lib/storage` (unchanged), vitest 5 + Testing Library + jsdom 29, CSS Modules on `src/app/tokens.css`.

**Spec:** `docs/superpowers/specs/2026-09-25-site-map-pipes-ropes-underlay-design.md`: Part C is §16–19, and §1–4 and §20–26 apply where they concern C. It builds on the editor spec (`2026-09-24-site-map-3d-editor-design.md`). The binding interface contract is `docs/superpowers/plans/2026-09-24-site-3d-00-overview.md`, which Task 1 amends first.

## Global Constraints

Every task's requirements include these. They are copied from the spec, the overview's constraints and `CLAUDE.md`, plus the rulings this plan was given.

- **Units:** every stored length is a whole number of centimetres. x grows east, y south, z up. Metres appear only in typed input and on screen. **The map never mirrors, and neither does the image:** at rotation 0 its top edge faces north and its left edge west, so Hebrew written on the sketch stays readable (spec §19).
- **Privacy (binding).** The repository is private and the uploads may show the camp's real layout.
  - Images are served **only** by `GET /site/underlay/<planId>/<file>`, which calls `requireAdmin` and serves only keys under that plan's prefix.
  - Production storage is Vercel Blob in the existing **private** store (`access: 'private'`, `src/lib/storage/index.ts`). There is never a public URL.
  - `LOCAL_STORAGE_DIR` (`.uploads/`, gitignored) exists only in development and tests.
  - Nothing is sent to any new service. There is no recognition and no Claude vision (D10).
  - No real sketch or photo is committed. Test images are headers built in code.
- **Not touched:**
  - `package.json`: no dependency is added.
  - `next.config.ts`: the upload is a route, so `serverActions.bodySizeLimit` stays as it is.
  - `src/lib/storage/**`: used, not changed.
  - `src/proxy.ts`, `scene/gestures.ts`, `scene/palette.ts`, `scene/meshes.ts`, `use-editor-store.ts`, `keyboard.ts`.
- **Limits (D20, spec §16):**
  - Only PNG, JPEG or WebP.
  - At most **4 MB** (`4 * 1024 * 1024` bytes).
  - **100–8192 px** on each side, as the header states it.
  - The key is `site-underlays/<planId>/<sha256>.<ext>`, with `ext` one of `png | jpg | webp`.
  - A decoded picture keeps at most **4096 px** on its long side (spec §19).
  - The image's width on the map is 10 cm – 500 m, and its middle is within ±500 m.
  - A typed calibration distance is `SIDE_RANGE` (10 cm – 500 m).
- **Saved and not saved (§27 answer, binding; D19):**
  - Placement, scale, turn and calibration are saved, versioned and undoable, as one `setUnderlay` op per user action.
  - Opacity and show/hide belong to each viewer. They live in `EditorUi.underlay` for the session and are never saved or sent.
  - Whenever the map has an image it is shown, at 50%.
- **Migration** `0015_site_underlays`:
  - Generate it with `npx drizzle-kit generate --name site_underlays`, **never** `drizzle-kit push` or `drizzle-kit migrate` (`docs/deploy.md` §6).
  - `0013` is #23's (`site_lines`) and `0014` is Part B's (ropes).
  - The number is re-checked at merge time against what has actually merged (Task 10).
  - The camp lead applies it to Railway by hand with the `psql -f` procedure in `docs/deploy.md` §6, **before** the code that reads it deploys. Every `/site` load reads the new table.
- **Hebrew only on screen, gender-neutral.**
  - Every sentence is spec §20's, word for word. The upload route answers with machine codes, and the card turns every code, including ones it does not know, into Hebrew.
  - Every name and number inside a Hebrew sentence is isolated (`<bdi>` or ⁦…⁩).
  - Library refusals are English with stable prefixes, and `failure-messages.ts` maps each one.
  - The format names PNG, JPEG, WebP, PDF, HEIC and the key names Shift and Esc appear only inside Hebrew sentences, as spec §20 writes them.
- **`three`** is imported only under `src/app/(admin)/site/editor/scene/**` (`three-guard.test.ts`). React files import from `scene/` with `import type` only.
- **Every admin entry point calls `requireAdmin(`** in its own body (`src/app/admin-guard.test.ts`). **A route module never imports `fs`** (`src/app/(admin)/route-modules.test.ts`).
- **Lint rules that bite** (`eslint-plugin-react-hooks` 7, as errors):
  - no `ref.current` read or written during render;
  - no synchronous `setState` in an effect body;
  - no `crypto.randomUUID()` / `Date.now()` during render.
- **CSS:** logical properties only; colours only from `tokens.css`; never `outline: none`.
- **Tests** run with the capped command, a unique output file each time, and only the task's own paths. Quote any path with parentheses:
  `npx vitest run <paths> --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
  A non-zero exit with zero failures means workers died, not green. The full suite is the coordinator's (Task 10).
- **Typecheck** with `npx tsc --noEmit`. **Lint** with `rtk proxy npx eslint <paths>`, because the RTK hook mangles bare `npx eslint`.
- **Read files with the Read tool, never `cat`.** Count with `node`, never with a hooked `grep | wc -l`. Use `/usr/bin/git log`. Stage by path and never `git add -A`: the git index is shared per tree.
- **Where to work:** a worktree of its own, from `origin/main`, for example `/Users/yarin/GitProjects/Shliff_Platform-lanes/site-underlay` on `feat/site-underlay`. The controller creates it. Never work in `/Users/yarin/GitProjects/Shliff_Platform`.

## Review Focus

These are the inputs spec §16–19 implies that no feature test would naturally hit, most likely first. Each one has its test in the task named.

1. **A phone JPEG with an EXIF rotation** (the spec's own review focus #5). The photo is stored landscape with orientation tag 6 and was held upright. It must be shown upright. It must be shrunk by its *displayed* width, not its stored one, so its long side stays within 4096 px. Its aspect must come from the decoded picture, and calibration must work on the picture as shown. → Task 1 (`image-facts.test.ts` "reads the EXIF orientation…" and "shows a picture turned…"), Task 2 (`underlay.test.ts` "calibrates a phone photo on the picture as shown"), Task 6 (`underlay-mesh.test.ts` "shrinks a sideways-stored phone photo by the width it is shown at" and "takes the aspect from the decoded picture").
2. **The same bytes uploaded twice on Vercel Blob:** a retry, or the old sketch uploaded again after a replace. `@vercel/blob` 2.8's `put` refuses an existing pathname (`allowOverwrite` defaults to false), and the key is the content's hash. The answer must be 201 with the same key, never 503 "storage unavailable". → Task 5 (`route.test.ts` "answers 201 when storage refuses to overwrite a file it already holds").
3. **An upload after the session expired.** The proxy redirects the POST to `/signin`, which answers **200 with HTML**. That must be the Hebrew failure, and no `setUnderlay` may be made from an undefined key. → Task 8 (`underlay-upload.test.ts` "treats a sign-in page as a failure, never as a stored picture").
4. **A request for an image without an admin session.** `src/proxy.ts` exempts every path ending `.png`/`.jpg`/`.webp` (it has to, for `public/`). So the image route's own `requireAdmin` is the *only* gate in front of the bytes. A plan id of `..` or any non-uuid must never reach storage. → Task 5 (`[file]/route.test.ts` "is not gated by the proxy, so it gates itself" and "never asks storage for a name outside the pattern").
5. **A slow load of a replaced picture landing after its replacement.** This happens after a quick replace, or an undo/redo across one. The newer picture must stay drawn and the late one must be released, never drawn over it. → Task 6 (`underlay-mesh.test.ts` "keeps the newer picture when an older load lands late").

## Order, Part B, and the files shared with #23

**C is built after B** and assumes B's schema pattern. B's first task is one task: schema, migration, the model field, the refusal and its Hebrew, the readers and `copyPlan`. C's Task 4 follows the same shape for its own table.

**C stands alone if B has not merged, apart from the migration number.** C reads nothing B adds (`ropeAngleDeg`, `ropeCm`, `groundRect`, `derive(plot, items, defaults)`), and B reads nothing C adds. The files both edit are edited in different places:

| File | B edits | C edits |
|---|---|---|
| `site.ts` | new columns on existing tables | a new table at the end |
| `ops.ts` | `ItemPatch.ropeAngleDeg`, `LOCKED_FIELDS` | a new `SiteOp` member and its refusal |
| `plan.ts` | `copyPlan`'s columns and the kind defaults | `readUnderlay`, `loadDoc`'s doc and one `applySiteOps` branch |
| `failure-messages.ts` | its own rows | its own rows |

So:

- If B has merged, branch from `origin/main` and drizzle-kit gives `0015`.
- If B has not merged, branch from `origin/main` as it is. Drizzle-kit gives the next free number. Task 10 regenerates the migration with whatever number is next when C merges, which is `0015` once `0013` and `0014` are on `main`. Migration numbers follow merge order (`docs/collab/ownership.md`, the `drizzle/` row; spec §24).

**Part A is #23** (`origin/feat/site-utility-lines`, its own design, migration `0013_site_lines`). `git diff --name-only origin/main...origin/feat/site-utility-lines` lists 60 files, counted with `node`. C edits 12 of them. For each, keep both sides:

| Shared file | #23's change | C's change | At merge |
|---|---|---|---|
| `drizzle/meta/_journal.json`, `drizzle/meta/*_snapshot.json` | `0013_site_lines` | `site_underlays` | Never hand-merge. Take `main`'s journal and regenerate C's migration (Task 10). |
| `src/db/schema/site.ts` | `jsonb` import; `siteLines` at the end | `jsonb` import; `siteUnderlays` at the end | Keep both. |
| `src/lib/site/editor/model.ts` | `EditorLine`; **required** `EditorDoc.lines`; line helpers | `EditorUnderlay`; optional `EditorDoc.underlay`; `underlayOf`, `sameUnderlay`, `copyUnderlay` | Keep both. |
| `src/lib/site/editor/ops.ts` | three line ops, `applyOps`'s `{ ...doc, items, lines, defaults }` | `setUnderlay`; `applyOps`'s return | `applyOps` must return `lines` **and** `underlay`. |
| `src/lib/site/plan.ts` | line readers; `loadDoc`'s doc gains `lines`; line branches in `applySiteOps`; `copyPlan` copies lines | `readUnderlay`; `loadDoc`'s doc gains `underlay`; `applySiteOps`'s `setKindDefault` branch restructured + `writeUnderlay` | Keep both. Re-run both `plan*.test.ts`. |
| `src/app/(admin)/site/failure-messages.ts` | rows appended | rows appended | Keep both. |
| `src/app/(admin)/site/editor/site-editor.tsx` | imports; handlers; inspector and objects wiring | imports; `INITIAL_UI`; `useUnderlay`; `runShortcut`; SceneView, Toolbar and PlotInspector props; the card | Keep both. |
| `src/app/(admin)/site/editor/scene/engine.ts` | imports (~l.10); `fitIds`; `itemAt` | imports; fields; constructor; `update`; `syncScene`; pointer handlers; overlay; context restore | Keep both. |
| `src/app/(admin)/site/editor/scene/scene-view.test.tsx` | its tests | `underlay` added to the `UI` literal | Keep both. |
| `src/app/(admin)/site/editor/panels/inspector-plot.tsx` | a prop and a section after "צל" | a prop and one `kv` row after "צפון" | Keep both; the prop destructuring line will conflict. |
| `docs/collab/claims.md`, `docs/deploy.md` | its own rows and records | its own rows and records | Keep both. |

**After #23 merges, C's own new test files fail to typecheck**, because `EditorDoc.lines` is required there. Add `lines: []` to each `EditorDoc` literal `tsc` names in:

- `ops.underlay.test.ts`
- `underlay-commands.test.ts`
- `underlay.scene.test.tsx`
- `inspector-plot.underlay.test.tsx`
- `site-editor.underlay.test.tsx`

This is why C makes `EditorDoc.underlay` **optional**. A required field would add a second conflicting edit to the ~18 existing test files that build an `EditorDoc` literal and that #23 already changed.

## What this plan adds to the contract

Task 1 Step 1 writes this into the overview's contract before any code, by the contract's own rule. The list is additive except where marked.

| Where | Addition | Why |
|---|---|---|
| `src/lib/site/underlay-limits.ts` (new, no imports) | the byte, pixel, texture, width, offset and calibration limits; `UNDERLAY_TYPES`, `UnderlayExtension`, `UnderlayContentType`, `UNDERLAY_PREFIX`, `UNDERLAY_FILE`, `isPlanId`, `underlayKey`, `underlayKeyPlan`, `underlayUrl`, `uploadUrl`, `contentTypeOf`, `UnderlayUploadCode`, `UNDERLAY_RULES_HE`, `UPLOAD_FAILED_HE`, `uploadRefusalHe` | One home for every number and the Hebrew that quotes it (spec §4's table) |
| `src/lib/site/image-facts.ts` (new) | `ImageKind`, `ImageFacts`, `imageFacts(bytes)`, `displaySize(facts)` | Type and pixel size from the header, plus the EXIF orientation (Review Focus #1) |
| `src/lib/site/underlay-file.ts` (new) | `UnderlayFileCheck`, `checkUnderlayFile(filename, bytes)` | One check for the route and the card (spec §18.1: "by the same rules as the server") |
| `src/lib/site/underlay.ts` (new) | `ImagePoint`, `MapPoint`, `UnderlayPlacement`, `UnderlayCalibration`, `imageToMap`, `mapToImage`, `isOnImage`, `normaliseTenths`, `initialPlacement`, `coverSize`, `moveBy`, `quarterTurn`, `calibrate` | The placement maths (spec §4's table, §18) |
| `model.ts` | `EditorUnderlay`; `EditorDoc.underlay?: EditorUnderlay \| null` — **optional where spec §17 writes `EditorUnderlay \| null`**. Absent and null both mean no image, and every reader goes through `underlayOf`. Also `underlayOf`, `sameUnderlay`, `copyUnderlay`. | Spec §17. Optional for the merge cost above. |
| `ops.ts` | `SiteOp` gains `{ type: 'setUnderlay'; underlay: EditorUnderlay \| null }`; `underlayRefusal`. Apply sets it; invert is the previous value, or nothing when unchanged; coalesce keeps the last value in the first one's place, like `setKindDefault`. | Spec §17 |
| `src/lib/site/editor/underlay-commands.ts` (new) | `UploadedUnderlay`, `uploadOps`, `placeOps`, `calibrateOps`, `removeUnderlayOps` | Every image edit as ops, with `commands.ts`'s rule: `[]` when nothing would change |
| `plan.ts` | `readUnderlay(db, planId)`; `loadDoc`'s doc carries `underlay`; `applySiteOps` writes `setUnderlay` and refuses another plan's key | Spec §17 |
| `scene-view.tsx` | `EditorUi.tool` adds `'calibrate' \| 'align'`; `EditorUi.underlay: { shown: boolean; opacity: number }` (required); `SceneViewProps.underlayMarks?`, `SceneViewProps.onUnderlay?`; `SceneHandle.retryUnderlay()` | Spec §23 |
| `scene/underlay-mesh.ts` (new) | `UNDERLAY_RENDER_ORDER`, `UNDERLAY_LIFT_CM`, `UnderlayStatus`, `UnderlayEvent`, `DecodedUnderlay`, `UnderlayLoader`, `loadUnderlayImage`, `buildUnderlayPlane`, `placeUnderlayPlane`, `UnderlayLayer` | The plane, the texture and its upkeep (spec §19) |
| `scene/underlay-tool.ts` (new) | `CALIBRATION_MIN_PX`, `UnderlayWorld`, `UnderlayIntent`, `UnderlayGestures`, `classifyPick` | The calibration and alignment tools' pointer machine. **`GestureWorld.tool()` is unchanged:** the engine hands these tools' events to `UnderlayGestures`, so `gestures.ts` (which #23 edits) is not touched. |
| panels | `Toolbar` gains `hasUnderlay?: boolean`; `PlotInspector` gains `onUnderlay?: () => void`; new `UnderlayCard(props: UnderlayCardProps)` and `CalibrationDraft` (`panels/underlay-card.tsx`) | Spec §18, §23 |
| editor | new `uploadUnderlay(file, planId, deps?)` (`underlay-upload.ts`), `useUnderlay(deps): UnderlayController` (`use-underlay.ts`) | The card's upload and the editor's glue, outside `site-editor.tsx` so the shared file changes little |
| routes (new) | `POST /site/underlay/[planId]`, `GET /site/underlay/[planId]/[file]` | Spec §16 |

## File map

| File | Task |
|---|---|
| `docs/superpowers/plans/2026-09-24-site-3d-00-overview.md` (the contract amendment) | 1 |
| `src/lib/site/underlay-limits.ts`, `image-facts.ts`, `underlay-file.ts` (+ tests) | 1 |
| `src/lib/site/underlay.ts` (+ test) | 2 |
| `src/lib/site/editor/model.ts`, `ops.ts`, `underlay-commands.ts` (new); `src/lib/site/plan.ts` (the op's branch, until Task 4); `src/app/(admin)/site/failure-messages.ts` (+ tests `ops.underlay.test.ts`, `underlay-commands.test.ts`, `failure-messages.test.ts`) | 3 |
| `src/db/schema/site.ts`; `drizzle/00NN_site_underlays.sql`, `drizzle/meta/00NN_snapshot.json`, `drizzle/meta/_journal.json` (generated); `src/lib/site/plan.ts` (+ `plan.underlay.test.ts`) | 4 |
| `src/app/(admin)/site/underlay/[planId]/route.ts`, `src/app/(admin)/site/underlay/[planId]/[file]/route.ts` (+ a test beside each) | 5 |
| `src/app/(admin)/site/editor/scene/underlay-mesh.ts` (+ test) | 6 |
| `src/app/(admin)/site/editor/scene/underlay-tool.ts` (+ test), `scene/engine.ts`, `scene/scene-view.tsx`, `scene/scene-view.test.tsx` (the `UI` literal), `scene/underlay.scene.test.tsx` (new) | 7 |
| `src/app/(admin)/site/editor/underlay-upload.ts` (+ test), `panels/underlay-card.tsx`, `panels/underlay-card.module.css` (+ test) | 8 |
| `src/app/(admin)/site/editor/use-underlay.ts`, `site-editor.tsx`, `editor.module.css` (a comment), `panels/toolbar.tsx`, `panels/inspector-plot.tsx` (+ `site-editor.underlay.test.tsx`, `panels/toolbar.test.tsx`, `panels/inspector-plot.underlay.test.tsx`) | 9 |
| `docs/deploy.md` (§6 record), `docs/collab/claims.md`; PR body at `.superpowers/site-underlay/pr-body.md` (gitignored) | 10 |

---

### Task 1: What an uploaded image may be — limits, header facts, one file check

**Files:**
- Modify: `docs/superpowers/plans/2026-09-24-site-3d-00-overview.md` (append the Part C amendment at the end)
- Create: `src/lib/site/underlay-limits.ts`, `src/lib/site/underlay-limits.test.ts`
- Create: `src/lib/site/image-facts.ts`, `src/lib/site/image-facts.test.ts`
- Create: `src/lib/site/underlay-file.ts`, `src/lib/site/underlay-file.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `underlay-limits.ts` (no imports):
    - numbers: `MAX_UNDERLAY_BYTES = 4194304`, `MAX_UNDERLAY_MB = 4`, `MIN_UNDERLAY_PX = 100`, `MAX_UNDERLAY_PX = 8192`, `MAX_UNDERLAY_TEXTURE_PX = 4096`, `MIN_UNDERLAY_WIDTH_CM = 10`, `MAX_UNDERLAY_WIDTH_CM = 50000`, `MAX_UNDERLAY_OFFSET_CM = 50000`, `MIN_CALIBRATION_CM = 10`, `MAX_CALIBRATION_CM = 50000`;
    - types: `UNDERLAY_TYPES`, `UnderlayExtension = 'png' | 'jpg' | 'webp'`, `UnderlayContentType = 'image/png' | 'image/jpeg' | 'image/webp'`;
    - keys and URLs: `UNDERLAY_PREFIX = 'site-underlays'`, `UNDERLAY_FILE: RegExp`, `isPlanId(value): boolean`, `underlayKey(planId, sha256, ext): string`, `underlayKeyPlan(key): string | null`, `underlayUrl(planId, key): string`, `uploadUrl(planId): string`, `contentTypeOf(name): UnderlayContentType | null`;
    - Hebrew: `UnderlayUploadCode`, `UNDERLAY_RULES_HE`, `UPLOAD_FAILED_HE`, `uploadRefusalHe(code: unknown): string`.
  - `image-facts.ts`: `ImageKind`; `ImageFacts { kind; width: number | null; height: number | null; orientation: number }`; `imageFacts(bytes: Uint8Array): ImageFacts`; `displaySize(facts): { width; height } | null`.
  - `underlay-file.ts`: `UnderlayFileCheck`; `checkUnderlayFile(filename: string, bytes: Uint8Array): UnderlayFileCheck`, meaning `{ ok: true; ext; contentType; width; height }` or `{ ok: false; code; status: 413 | 415 | 422 }`.

- [ ] **Step 1: Amend the interface contract first**

The overview's rule is that a change to a signature is made to its contract section first (`2026-09-24-site-3d-00-overview.md`, "Interface contract"). Read that file with the Read tool. At its very end, after the last `### Amendment…` section, append:

```markdown

### Amendments for Part C — the image to trace (spec `2026-09-25-site-map-pipes-ropes-underlay-design.md` §16–19; plan `2026-09-25-site-underlay.md`)

Recorded before any of Part C's code, by this section's own rule. Additive except where marked.

- `src/lib/site/underlay-limits.ts` (new; no imports): every limit, the storage key and URL helpers, and the upload codes' Hebrew (`uploadRefusalHe`).
- `src/lib/site/image-facts.ts` (new): `imageFacts(bytes)` — kind, stored size and EXIF orientation from the header; `displaySize(facts)`.
- `src/lib/site/underlay-file.ts` (new): `checkUnderlayFile(filename, bytes)` — the one check the route and the card both run.
- `src/lib/site/underlay.ts` (new): `ImagePoint`, `MapPoint`, `UnderlayPlacement`, `UnderlayCalibration`, `imageToMap`, `mapToImage`, `isOnImage`, `normaliseTenths`, `initialPlacement`, `coverSize`, `moveBy`, `quarterTurn`, `calibrate`.
- `model.ts`: `EditorUnderlay` (extends `UnderlayPlacement`; `storageKey`, `contentType`, `sizeBytes`, `filename`, `calibration`). **`EditorDoc.underlay?: EditorUnderlay | null` is optional** where spec §17 writes `EditorUnderlay | null`: absent and null both mean no image, and every reader goes through `underlayOf(doc)`. Also `sameUnderlay`, `copyUnderlay`.
- `ops.ts`: `SiteOp` gains `{ type: 'setUnderlay'; underlay: EditorUnderlay | null }`; `underlayRefusal(underlay)`, prefixes `an underlay file must be`, `an underlay placement must be`, `an underlay calibration must be`.
- `src/lib/site/editor/underlay-commands.ts` (new): `UploadedUnderlay`, `uploadOps`, `placeOps`, `calibrateOps`, `removeUnderlayOps`.
- `plan.ts`: `readUnderlay(db, planId)`; `loadDoc`'s doc carries `underlay`; `applySiteOps` applies `setUnderlay`, refusing a key under another plan's prefix.
- `scene-view.tsx`: `EditorUi.tool: 'select' | 'measure' | 'calibrate' | 'align'`; `EditorUi.underlay: { shown: boolean; opacity: number }`; `SceneViewProps.underlayMarks?: ReadonlyArray<ImagePoint>`; `SceneViewProps.onUnderlay?: (event: UnderlayEvent) => void`; `SceneHandle.retryUnderlay(): void`.
- `scene/underlay-mesh.ts` (new): `UnderlayStatus`, `UnderlayEvent`, `DecodedUnderlay`, `UnderlayLoader`, `loadUnderlayImage`, `buildUnderlayPlane`, `placeUnderlayPlane`, `UnderlayLayer`, `UNDERLAY_RENDER_ORDER = -3.5`, `UNDERLAY_LIFT_CM = 0.1`.
- `scene/underlay-tool.ts` (new): `UnderlayGestures`, `UnderlayWorld`, `UnderlayIntent`, `classifyPick`, `CALIBRATION_MIN_PX = 20`. **`GestureWorld.tool()` stays `'select' | 'measure'`**: the engine gives the calibration and alignment tools' pointer events to `UnderlayGestures` and tells `Gestures` the tool is `'select'` meanwhile.
- Panels: `Toolbar` gains `hasUnderlay?: boolean`; `PlotInspector` gains `onUnderlay?: () => void`; new `UnderlayCard` and `CalibrationDraft` (`panels/underlay-card.tsx`). Editor: new `uploadUnderlay` (`underlay-upload.ts`) and `useUnderlay` (`use-underlay.ts`).
- Routes (new): `POST /site/underlay/[planId]` (201 `{ storageKey, contentType, sizeBytes, filename }`, or a machine code), `GET /site/underlay/[planId]/[file]` (admins only).
```

Commit it on its own, so the contract is on the branch before any code that implements it:

```bash
git add docs/superpowers/plans/2026-09-24-site-3d-00-overview.md
git commit -m "docs(site): the contract gains Part C — the image to trace

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 2: Write the failing limits test**

Create `src/lib/site/underlay-limits.test.ts`. The Hebrew here is copied from spec §20 and is the oracle, not the module's own strings. The mark after "PNG," is U+200F, written `‏`, exactly as the spec has it.

```ts
import { describe, it, expect } from 'vitest';
import {
  MAX_UNDERLAY_BYTES, MAX_UNDERLAY_MB, MAX_UNDERLAY_PX, MAX_UNDERLAY_TEXTURE_PX, MIN_UNDERLAY_PX,
  UNDERLAY_FILE, UNDERLAY_RULES_HE, UPLOAD_FAILED_HE,
  contentTypeOf, isPlanId, underlayKey, underlayKeyPlan, underlayUrl, uploadRefusalHe, uploadUrl,
} from './underlay-limits';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const OTHER = '5e1d2c3b-4a59-4876-9e0f-a1b2c3d4e5f6';
const SHA = 'a'.repeat(64);

describe('the image limits', () => {
  it('stays inside the 4.5 MB Vercel lets a function receive and send', () => {
    // Above it the platform answers in English before the route runs.
    expect(MAX_UNDERLAY_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_UNDERLAY_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(MAX_UNDERLAY_MB).toBe(4);
    expect(Number.isInteger(MAX_UNDERLAY_MB)).toBe(true);
  });

  it('takes 100 to 8192 pixels a side, and keeps at most 4096 once decoded', () => {
    expect([MIN_UNDERLAY_PX, MAX_UNDERLAY_PX, MAX_UNDERLAY_TEXTURE_PX]).toEqual([100, 8192, 4096]);
  });
});

describe('where a picture is kept', () => {
  it('keys a file by its plan and its own hash', () => {
    expect(underlayKey(PLAN, SHA, 'png')).toBe(`site-underlays/${PLAN}/${SHA}.png`);
    expect(underlayKeyPlan(underlayKey(PLAN, SHA, 'jpg'))).toBe(PLAN);
    expect(underlayKeyPlan(underlayKey(OTHER, SHA, 'webp'))).toBe(OTHER);
  });

  it('knows no key outside its own folder, and no plan that is not a lower-case uuid', () => {
    for (const key of [
      `uploads/${SHA}.xlsx`,
      `site-underlays/${PLAN}/../${SHA}.png`,
      `site-underlays/../uploads/${SHA}.png`,
      `site-underlays/${PLAN}/${SHA}.gif`,
      `site-underlays/${PLAN.toUpperCase()}/${SHA}.png`,
      `site-underlays/not-a-plan/${SHA}.png`,
      `site-underlays/${PLAN}/${SHA}.png/more`,
      '',
    ]) {
      expect(underlayKeyPlan(key)).toBeNull();
    }
    expect(isPlanId(PLAN)).toBe(true);
    expect(isPlanId(PLAN.toUpperCase())).toBe(false);
    expect(isPlanId('..')).toBe(false);
  });

  it('is fetched from the admin route by its file name, and sent to the plan’s own address', () => {
    expect(underlayUrl(PLAN, underlayKey(PLAN, SHA, 'png'))).toBe(`/site/underlay/${PLAN}/${SHA}.png`);
    expect(uploadUrl(PLAN)).toBe(`/site/underlay/${PLAN}`);
  });

  it('serves only a hash with one of three extensions', () => {
    expect(UNDERLAY_FILE.test(`${SHA}.png`)).toBe(true);
    expect(UNDERLAY_FILE.test(`${SHA}.jpg`)).toBe(true);
    expect(UNDERLAY_FILE.test(`${SHA}.webp`)).toBe(true);
    for (const name of [`${SHA}.PNG`, `${SHA}.jpeg`, `${'g'.repeat(64)}.png`, `${SHA}.png.json`, 'x.png', `a${SHA}.png`]) {
      expect(UNDERLAY_FILE.test(name)).toBe(false);
    }
  });

  it('reads a content type from the stored extension', () => {
    expect(contentTypeOf(`${SHA}.png`)).toBe('image/png');
    expect(contentTypeOf(underlayKey(PLAN, SHA, 'jpg'))).toBe('image/jpeg');
    expect(contentTypeOf(`${SHA}.webp`)).toBe('image/webp');
    expect(contentTypeOf(`${SHA}.gif`)).toBeNull();
  });
});

describe('what an upload says, in Hebrew', () => {
  it('names every refusal the route can answer, in the spec’s words', () => {
    expect(uploadRefusalHe('unauthorized')).toBe('אין הרשאה להעלות קבצים.');
    expect(uploadRefusalHe('unknown plan')).toBe('לא מצאנו את המפה הזו — אולי נמחקה בינתיים');
    expect(uploadRefusalHe('missing file')).toBe('לא נבחר קובץ.');
    expect(uploadRefusalHe('file too large')).toBe('התמונה גדולה מדי — עד 4 מגה־בייט.');
    expect(uploadRefusalHe('pdf')).toBe('קובץ PDF אי אפשר להעלות כרקע. צילום מסך של העמוד יעבוד.');
    expect(uploadRefusalHe('heic')).toBe('הדפדפן לא מציג תמונות HEIC (ברירת המחדל של מצלמת האייפון). שמירה כ־JPEG, או צילום מסך, יעבדו.');
    expect(uploadRefusalHe('unsupported file type')).toBe('אפשר להעלות רק תמונה: PNG,‏ JPEG או WebP.');
    expect(uploadRefusalHe('image too large')).toBe('התמונה גדולה מדי — עד 8192 פיקסלים בכל צד.');
    expect(uploadRefusalHe('image too small')).toBe('התמונה קטנה מדי — לפחות 100 פיקסלים בכל צד.');
    expect(uploadRefusalHe('storage unavailable')).toBe('לא הצלחנו לשמור את התמונה. אפשר לנסות שוב.');
  });

  it('falls back to Hebrew for a code it does not know, or no code at all', () => {
    for (const code of ['import failed', 'constructor', '__proto__', '', undefined, null, 413, {}]) {
      expect(uploadRefusalHe(code)).toBe('ההעלאה נכשלה. אפשר לנסות שוב.');
    }
    expect(UPLOAD_FAILED_HE).toBe('ההעלאה נכשלה. אפשר לנסות שוב.');
  });

  it('states the limits it enforces', () => {
    expect(UNDERLAY_RULES_HE).toBe('PNG,‏ JPEG או WebP, עד 4 מגה־בייט');
    expect(uploadRefusalHe('file too large')).toContain(String(MAX_UNDERLAY_MB));
    expect(uploadRefusalHe('image too large')).toContain(String(MAX_UNDERLAY_PX));
    expect(uploadRefusalHe('image too small')).toContain(String(MIN_UNDERLAY_PX));
  });

  it('carries no Latin word but the formats it names', () => {
    const codes = ['unauthorized', 'unknown plan', 'missing file', 'file too large', 'pdf', 'heic',
      'unsupported file type', 'image too large', 'image too small', 'storage unavailable', 'unknown'];
    for (const sentence of [...codes.map(uploadRefusalHe), UNDERLAY_RULES_HE]) {
      expect(sentence).toMatch(/[֐-׿]/);
      const latin = sentence.match(/[A-Za-z]+/g) ?? [];
      expect(latin.filter((word) => !['PNG', 'JPEG', 'WebP', 'PDF', 'HEIC'].includes(word))).toEqual([]);
    }
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/lib/site/underlay-limits.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL, because `./underlay-limits` cannot be resolved and no tests run.

- [ ] **Step 4: Write `underlay-limits.ts`**

Create `src/lib/site/underlay-limits.ts`:

```ts
/**
 * What an image under the camp map may be, where its file is kept, and the
 * Hebrew that says so (spec §16, §20): one module for the numbers and the
 * sentences that quote them, as `src/lib/import/upload-limits.ts` is for
 * workbooks. A rules line that says 4 MB while the route refuses at 3 is
 * worse than no rules line.
 *
 * No imports. The upload route, the image route, `ops.ts`, the scene and the
 * card all read this, so it stays free of `@/db`, of `three`, of React and of
 * anything that touches a filesystem.
 *
 * The 4 MB ceiling is Vercel's, not a preference: a function receives at most
 * a 4.5 MB request body and sends at most a 4.5 MB response, and above that
 * the platform answers in English before the route runs. The image route
 * serves only what the upload route let in, so it never sends more either.
 */

export const MAX_UNDERLAY_BYTES = 4 * 1024 * 1024;
/** Whole megabytes, because the Hebrew below quotes it. */
export const MAX_UNDERLAY_MB = MAX_UNDERLAY_BYTES / (1024 * 1024);

/** Each side of the picture, in pixels, as its header states it. */
export const MIN_UNDERLAY_PX = 100;
export const MAX_UNDERLAY_PX = 8192;

/** The most a decoded picture keeps on its long side; the GPU's own limit may be lower (spec §19). */
export const MAX_UNDERLAY_TEXTURE_PX = 4096;

/** The map length of the picture's width: an item side's bounds, 10 cm to 500 m (`ops.ts`). */
export const MIN_UNDERLAY_WIDTH_CM = 10;
export const MAX_UNDERLAY_WIDTH_CM = 50_000;
/** How far the picture's middle may sit from the plot's corner, either way: `POSITION_RANGE`. */
export const MAX_UNDERLAY_OFFSET_CM = 50_000;
/** A typed calibration distance: `SIDE_RANGE`, 10 cm to 500 m (spec §18.3). */
export const MIN_CALIBRATION_CM = 10;
export const MAX_CALIBRATION_CM = 50_000;

export const UNDERLAY_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;
export type UnderlayExtension = keyof typeof UNDERLAY_TYPES;
export type UnderlayContentType = (typeof UNDERLAY_TYPES)[UnderlayExtension];

/**
 * Where every picture is kept: `site-underlays/<planId>/<sha256>.<ext>`. The
 * name is the file's own hash, so the same bytes land on the same key: a
 * second upload writes nothing new, and a replaced picture keeps its key for
 * an undo to bring back (spec §16). A plan id is lower case, as Postgres
 * writes a uuid, so one plan has one folder.
 */
export const UNDERLAY_PREFIX = 'site-underlays';
/** The one shape of file name the image route serves (spec §16). */
export const UNDERLAY_FILE = /^[0-9a-f]{64}\.(png|jpg|webp)$/;
const PLAN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A plan id as a key and a URL carry it: a lower-case uuid, and nothing a path could climb out with. */
export function isPlanId(value: string): boolean {
  return PLAN_ID.test(value);
}

export function underlayKey(planId: string, sha256: string, ext: UnderlayExtension): string {
  return `${UNDERLAY_PREFIX}/${planId}/${sha256}.${ext}`;
}

/** The plan a key was uploaded to, or null when the text is not a picture's key at all. */
export function underlayKeyPlan(key: string): string | null {
  const parts = key.split('/');
  if (parts.length !== 3 || parts[0] !== UNDERLAY_PREFIX) return null;
  return isPlanId(parts[1]) && UNDERLAY_FILE.test(parts[2]) ? parts[1] : null;
}

/** Where a browser asks for the picture: the admin-only route, never storage itself. */
export function underlayUrl(planId: string, key: string): string {
  return `/site/underlay/${planId}/${key.slice(key.lastIndexOf('/') + 1)}`;
}

/** Where a picture is sent. */
export function uploadUrl(planId: string): string {
  return `/site/underlay/${planId}`;
}

/** The content type a stored name's extension stands for, or null. */
export function contentTypeOf(name: string): UnderlayContentType | null {
  const match = /\.(png|jpg|webp)$/.exec(name);
  return match === null ? null : UNDERLAY_TYPES[match[1] as UnderlayExtension];
}

/** The machine codes `POST /site/underlay/<planId>` answers (spec §16). */
export type UnderlayUploadCode =
  | 'unauthorized' | 'unknown plan' | 'missing file' | 'file too large'
  | 'pdf' | 'heic' | 'unsupported file type' | 'image too small' | 'image too large'
  | 'storage unavailable';

/** The rules line under the upload button (spec §20). The mark after "PNG," keeps the comma with its word. */
export const UNDERLAY_RULES_HE = `PNG,‏ JPEG או WebP, עד ${MAX_UNDERLAY_MB} מגה־בייט`;

/** Any other answer: a code this list does not know, an HTML page, no answer at all. */
export const UPLOAD_FAILED_HE = 'ההעלאה נכשלה. אפשר לנסות שוב.';

/** A record, so `tsc` refuses a code without its sentence. */
const UPLOAD_HE: Readonly<Record<UnderlayUploadCode, string>> = {
  unauthorized: 'אין הרשאה להעלות קבצים.',
  'unknown plan': 'לא מצאנו את המפה הזו — אולי נמחקה בינתיים',
  'missing file': 'לא נבחר קובץ.',
  'file too large': `התמונה גדולה מדי — עד ${MAX_UNDERLAY_MB} מגה־בייט.`,
  pdf: 'קובץ PDF אי אפשר להעלות כרקע. צילום מסך של העמוד יעבוד.',
  heic: 'הדפדפן לא מציג תמונות HEIC (ברירת המחדל של מצלמת האייפון). שמירה כ־JPEG, או צילום מסך, יעבדו.',
  'unsupported file type': 'אפשר להעלות רק תמונה: PNG,‏ JPEG או WebP.',
  'image too large': `התמונה גדולה מדי — עד ${MAX_UNDERLAY_PX} פיקסלים בכל צד.`,
  'image too small': `התמונה קטנה מדי — לפחות ${MIN_UNDERLAY_PX} פיקסלים בכל צד.`,
  'storage unavailable': 'לא הצלחנו לשמור את התמונה. אפשר לנסות שוב.',
};
/** A Map, so a code such as `constructor` finds nothing. */
const BY_CODE = new Map<string, string>(Object.entries(UPLOAD_HE));

/** Whatever the route answered, as a Hebrew sentence, never the code itself (spec §21). */
export function uploadRefusalHe(code: unknown): string {
  return (typeof code === 'string' ? BY_CODE.get(code) : undefined) ?? UPLOAD_FAILED_HE;
}
```

- [ ] **Step 5: Run the limits test**

Run the Step 3 command. Expected: 11 passed, exit 0.

- [ ] **Step 6: Write the failing header test**

Create `src/lib/site/image-facts.test.ts`. The headers are built byte by byte here: no image file is read or committed. The JPEG carries a 60 kB APP2 segment, the size of a colour profile. Inside it is a *fake* frame header claiming 16 × 16, so a parser that searched for bytes instead of skipping segments by length would answer wrongly.

```ts
import { describe, it, expect } from 'vitest';
import { displaySize, imageFacts } from './image-facts';

type Part = number[] | string | Uint8Array;

function join(...parts: Part[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (let i = 0; i < part.length; i += 1) out.push(part.charCodeAt(i));
    else for (const byte of part) out.push(byte);
  }
  return Uint8Array.from(out);
}

const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

function png(width: number, height: number): Uint8Array {
  return join([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(width), be32(height), [8, 6, 0, 0, 0]);
}

/** An APP1 Exif segment whose first directory holds one entry: the orientation (tag 0x0112, SHORT). */
function exifSegment(orientation: number, little: boolean): Uint8Array {
  const u16 = little ? le16 : be16;
  const u32 = little ? le32 : be32;
  const tiff = join(little ? 'II' : 'MM', u16(42), u32(8), u16(1), u16(0x0112), u16(3), u32(1), u16(orientation), [0, 0], u32(0));
  const body = join('Exif', [0, 0], tiff);
  return join([0xff, 0xe1], be16(body.length + 2), body);
}

/** SOI, JFIF, an optional EXIF, a 60 kB APP2 with a decoy frame header inside, then the real (progressive) frame header and the scan. */
function jpeg(width: number, height: number, exif?: { orientation: number; little: boolean }): Uint8Array {
  const app0 = join([0xff, 0xe0], be16(16), 'JFIF', [0], [1, 1, 0], be16(72), be16(72), [0, 0]);
  const profile = new Uint8Array(60_000).fill(0xab);
  profile.set([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10], 100);
  const app2 = join([0xff, 0xe2], be16(profile.length + 2), profile);
  const frame = join([0xff, 0xc2], be16(17), [8], be16(height), be16(width), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return join([0xff, 0xd8], app0, exif === undefined ? [] : exifSegment(exif.orientation, exif.little), app2, frame, [0xff, 0xda, 0, 8]);
}

function webpLossy(width: number, height: number): Uint8Array {
  return join('RIFF', le32(22), 'WEBP', 'VP8 ', le32(10), [0x30, 0x01, 0x00], [0x9d, 0x01, 0x2a], le16(width), le16(height));
}

function webpLossless(width: number, height: number): Uint8Array {
  return join('RIFF', le32(13), 'WEBP', 'VP8L', le32(5), [0x2f], le32((width - 1) + (height - 1) * 0x4000));
}

function webpExtended(width: number, height: number): Uint8Array {
  return join('RIFF', le32(18), 'WEBP', 'VP8X', le32(10), [0x08, 0, 0, 0], le24(width - 1), le24(height - 1));
}

describe('what a picture is, from its first bytes', () => {
  it('reads a PNG’s size from its header', () => {
    expect(imageFacts(png(1600, 1200))).toEqual({ kind: 'png', width: 1600, height: 1200, orientation: 1 });
  });

  it('reads a JPEG’s size from its frame header, past the segments before it — skipped by length, never searched', () => {
    expect(imageFacts(jpeg(2048, 1536))).toEqual({ kind: 'jpeg', width: 2048, height: 1536, orientation: 1 });
  });

  it('reads the EXIF orientation of a phone photo stored sideways, in either byte order (Review Focus #1)', () => {
    expect(imageFacts(jpeg(4032, 3024, { orientation: 6, little: false })))
      .toEqual({ kind: 'jpeg', width: 4032, height: 3024, orientation: 6 });
    expect(imageFacts(jpeg(4032, 3024, { orientation: 8, little: true })).orientation).toBe(8);
    expect(imageFacts(jpeg(4032, 3024, { orientation: 3, little: true })).orientation).toBe(3);
  });

  it('shows a picture turned a quarter by its tag with its sides swapped, and any other as stored (Review Focus #1)', () => {
    expect(displaySize(imageFacts(jpeg(4032, 3024, { orientation: 6, little: false })))).toEqual({ width: 3024, height: 4032 });
    expect(displaySize(imageFacts(jpeg(4032, 3024, { orientation: 8, little: true })))).toEqual({ width: 3024, height: 4032 });
    expect(displaySize(imageFacts(jpeg(4032, 3024, { orientation: 3, little: false })))).toEqual({ width: 4032, height: 3024 });
    expect(displaySize(imageFacts(png(10, 20)))).toEqual({ width: 10, height: 20 });
  });

  it('reads the three kinds of WebP', () => {
    expect(imageFacts(webpLossy(800, 600))).toEqual({ kind: 'webp', width: 800, height: 600, orientation: 1 });
    expect(imageFacts(webpLossless(640, 480))).toEqual({ kind: 'webp', width: 640, height: 480, orientation: 1 });
    expect(imageFacts(webpLossless(1, 1))).toMatchObject({ width: 1, height: 1 });
    expect(imageFacts(webpLossless(16384, 16384))).toMatchObject({ width: 16384, height: 16384 });
    expect(imageFacts(webpExtended(5000, 4000))).toEqual({ kind: 'webp', width: 5000, height: 4000, orientation: 1 });
  });

  it('names what the map will not show: a PDF, an iPhone photo, a GIF and an SVG', () => {
    expect(imageFacts(join('%PDF-1.7\n'))).toMatchObject({ kind: 'pdf', width: null });
    expect(imageFacts(join(be32(24), 'ftyp', 'heic', be32(0), 'mif1', 'heic')).kind).toBe('heic');
    expect(imageFacts(join(be32(24), 'ftyp', 'mif1', be32(0), 'mif1', 'heic')).kind).toBe('heic');
    expect(imageFacts(join('GIF89a', le16(320), le16(200)))).toEqual({ kind: 'gif', width: 320, height: 200, orientation: 1 });
    expect(imageFacts(join('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')).kind).toBe('svg');
    expect(imageFacts(join([0xef, 0xbb, 0xbf], '  <svg width="10"/>')).kind).toBe('svg');
  });

  it('does not take an AVIF photo for an iPhone one', () => {
    expect(imageFacts(join(be32(24), 'ftyp', 'avif', be32(0), 'avif', 'mif1')).kind).toBe('unknown');
  });

  it('says no size when a file is cut short, and nothing at all about an unknown one', () => {
    expect(imageFacts(join([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ kind: 'png', width: null, height: null, orientation: 1 });
    expect(imageFacts(join([0xff, 0xd8, 0xff, 0xe0], be16(16), 'JFIF'))).toMatchObject({ kind: 'jpeg', width: null });
    expect(imageFacts(join('hello'))).toEqual({ kind: 'unknown', width: null, height: null, orientation: 1 });
    expect(imageFacts(new Uint8Array(0)).kind).toBe('unknown');
    expect(displaySize(imageFacts(join('hello')))).toBeNull();
  });
});
```

- [ ] **Step 7: Run it to see it fail**

Run: `npx vitest run src/lib/site/image-facts.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL, because `./image-facts` cannot be resolved.

- [ ] **Step 8: Write `image-facts.ts`**

Create `src/lib/site/image-facts.ts`:

```ts
/**
 * What kind of picture a file is and how many pixels it holds, read from its
 * first bytes (spec §16, §19), never by decoding it. The upload route refuses
 * a 48-megapixel photo without ever holding its pixels, and the scene knows
 * how far to shrink a picture before the browser decodes it.
 *
 * It also reads the one thing a phone photo needs before it is shown: its
 * EXIF orientation. A photo held upright is usually stored sideways with a
 * tag saying so. The browser turns it (`imageOrientation: 'from-image'`), and
 * the picture as shown is the stored one with its sides swapped
 * (`displaySize`). Only JPEG carries the tag in practice.
 *
 * No imports, no DOM, no Node: the route, the card and the scene each hand it
 * a `Uint8Array`.
 */

export type ImageKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'pdf' | 'heic' | 'svg' | 'unknown';

export interface ImageFacts {
  kind: ImageKind;
  /** As stored, before any EXIF turn. Null when the header does not say. */
  width: number | null;
  height: number | null;
  /** The EXIF orientation, 1 to 8; 1 when the file carries none. */
  orientation: number;
}

/** The brands an iPhone's HEIC/HEIF photo opens with (`ftyp`). AVIF's own brand is not one of them. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/** The JPEG frame markers that carry the picture's size: every SOFn but DHT (C4), JPG (C8) and DAC (CC). */
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function text(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = at; i < at + length && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

/* Multiplication, not shifts: a shift makes a 32-bit signed number, and a width of 2^31 would read as negative. */
function be16(bytes: Uint8Array, at: number): number {
  return bytes[at] * 0x100 + bytes[at + 1];
}

function be32(bytes: Uint8Array, at: number): number {
  return bytes[at] * 0x1000000 + bytes[at + 1] * 0x10000 + bytes[at + 2] * 0x100 + bytes[at + 3];
}

function le16(bytes: Uint8Array, at: number): number {
  return bytes[at] + bytes[at + 1] * 0x100;
}

function le24(bytes: Uint8Array, at: number): number {
  return bytes[at] + bytes[at + 1] * 0x100 + bytes[at + 2] * 0x10000;
}

function le32(bytes: Uint8Array, at: number): number {
  return le24(bytes, at) + bytes[at + 3] * 0x1000000;
}

function unsized(kind: ImageKind, orientation = 1): ImageFacts {
  return { kind, width: null, height: null, orientation };
}

function sized(kind: ImageKind, width: number, height: number, orientation = 1): ImageFacts {
  return { kind, width, height, orientation };
}

function png(bytes: Uint8Array): ImageFacts {
  // The first chunk is always IHDR, and its data starts with the width and the height.
  if (bytes.length < 24 || text(bytes, 12, 4) !== 'IHDR') return unsized('png');
  return sized('png', be32(bytes, 16), be32(bytes, 20));
}

/** The orientation tag (0x0112) in an APP1 Exif segment's first directory, or null. */
function exifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (text(bytes, start, 6) !== 'Exif\u0000\u0000') return null;
  const tiff = start + 6;
  const order = text(bytes, tiff, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const u16 = (at: number) => (little ? le16(bytes, at) : be16(bytes, at));
  const u32 = (at: number) => (little ? le32(bytes, at) : be32(bytes, at));
  if (tiff + 8 > end || u16(tiff + 2) !== 42) return null;
  const directory = tiff + u32(tiff + 4);
  if (directory + 2 > end) return null;
  const entries = u16(directory);
  for (let i = 0; i < entries; i += 1) {
    const entry = directory + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) === 0x0112) {
      // A SHORT sits in the first two bytes of the entry's value field, in the file's byte order.
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/**
 * Walks the segments to the frame header. EXIF, colour profiles and XMP come
 * first and can run to tens of kilobytes, so each segment is skipped by its
 * stated length. Searching for the frame marker's bytes would find one inside
 * a thumbnail or a profile as easily as the real one.
 */
function jpeg(bytes: Uint8Array): ImageFacts {
  let orientation = 1;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) break;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1; // a fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2; // a marker with no length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // the image ends, or its data starts: no size ahead
    const length = be16(bytes, at + 2);
    if (length < 2) break;
    if (JPEG_FRAMES.has(marker)) {
      if (at + 9 > bytes.length) break;
      return sized('jpeg', be16(bytes, at + 7), be16(bytes, at + 5), orientation);
    }
    if (marker === 0xe1) {
      orientation = exifOrientation(bytes, at + 4, Math.min(bytes.length, at + 2 + length)) ?? orientation;
    }
    at += 2 + length;
  }
  return unsized('jpeg', orientation);
}

function webp(bytes: Uint8Array): ImageFacts {
  const chunk = text(bytes, 12, 4);
  // Lossy: a three-byte frame tag, the start code 9D 01 2A, then 14-bit width and height.
  if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return sized('webp', le16(bytes, 26) & 0x3fff, le16(bytes, 28) & 0x3fff);
  }
  // Lossless: the signature 0x2F, then width − 1 and height − 1 in 14 bits each.
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = le32(bytes, 21);
    return sized('webp', (bits % 0x4000) + 1, (Math.floor(bits / 0x4000) % 0x4000) + 1);
  }
  // Extended: flags and three reserved bytes, then the canvas's width − 1 and height − 1 in 24 bits each.
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return sized('webp', le24(bytes, 24) + 1, le24(bytes, 27) + 1);
  }
  return unsized('webp');
}

export function imageFacts(bytes: Uint8Array): ImageFacts {
  if (PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return png(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return jpeg(bytes);
  if (text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP') return webp(bytes);
  const head = text(bytes, 0, 6);
  if (head === 'GIF87a' || head === 'GIF89a') {
    return bytes.length >= 10 ? sized('gif', le16(bytes, 6), le16(bytes, 8)) : unsized('gif');
  }
  if (text(bytes, 0, 5) === '%PDF-') return unsized('pdf');
  if (text(bytes, 4, 4) === 'ftyp' && HEIC_BRANDS.has(text(bytes, 8, 4))) return unsized('heic');
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  if (/^\s*<(\?xml|svg[\s>/])/i.test(text(bytes, start, 256))) return unsized('svg');
  return unsized('unknown');
}

/** The picture's size as the browser shows it, after its EXIF turn: orientations 5 to 8 are a quarter turn. */
export function displaySize(facts: ImageFacts): { width: number; height: number } | null {
  if (facts.width === null || facts.height === null) return null;
  return facts.orientation >= 5
    ? { width: facts.height, height: facts.width }
    : { width: facts.width, height: facts.height };
}
```

- [ ] **Step 9: Run the header test**

Run the Step 7 command. Expected: 8 passed, exit 0.

Then check that the "skipped by length" test can fail. Make `jpeg()` search instead of skip, with two temporary changes:
- replace `at += 2 + length;` with `at += 2;`;
- replace the first `if (bytes[at] !== 0xff) break;` with `if (bytes[at] !== 0xff) { at += 1; continue; }`.

Re-run. Expected: "reads a JPEG's size…" fails with `16` where `2048` was expected, because the search meets the decoy inside the profile first. Undo both changes and re-run: 8 passed.

- [ ] **Step 10: Write the failing file-check test**

Create `src/lib/site/underlay-file.test.ts`. It has its own small fixture, per the overview's ruling that test files never import one another.

```ts
import { describe, it, expect } from 'vitest';
import { checkUnderlayFile } from './underlay-file';
import { MAX_UNDERLAY_BYTES } from './underlay-limits';

function bytes(...parts: Array<number[] | string>): number[] {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (let i = 0; i < part.length; i += 1) out.push(part.charCodeAt(i));
    else out.push(...part);
  }
  return out;
}
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

/** A PNG header, zero-padded to `padTo` bytes: the checks read the header, not the pixels. */
function png(width: number, height: number, padTo = 0): Uint8Array {
  const header = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(width), be32(height), [8, 6, 0, 0, 0]);
  const out = new Uint8Array(Math.max(padTo, header.length));
  out.set(header);
  return out;
}
const jpeg = (width: number, height: number) =>
  Uint8Array.from(bytes([0xff, 0xd8], [0xff, 0xc0], be16(17), [8], be16(height), be16(width), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]));
const webp = (width: number, height: number) =>
  Uint8Array.from(bytes('RIFF', le32(13), 'WEBP', 'VP8L', le32(5), [0x2f], le32((width - 1) + (height - 1) * 0x4000)));
const PDF = Uint8Array.from(bytes('%PDF-1.7\n'));
const HEIC = Uint8Array.from(bytes(be32(24), 'ftyp', 'heic', be32(0), 'mif1', 'heic'));
const GIF = Uint8Array.from(bytes('GIF89a', [0x40, 0x01, 0xc8, 0x00]));
const SVG = Uint8Array.from(bytes('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"/>'));

describe('an image to trace, checked the same way in the browser and on the server', () => {
  it('takes a PNG, a JPEG and a WebP, whatever the case of the name', () => {
    expect(checkUnderlayFile('sketch.png', png(1600, 1200)))
      .toEqual({ ok: true, ext: 'png', contentType: 'image/png', width: 1600, height: 1200 });
    expect(checkUnderlayFile('IMG_2231.JPG', jpeg(4032, 3024))).toMatchObject({ ok: true, ext: 'jpg', contentType: 'image/jpeg' });
    expect(checkUnderlayFile('scan.jpeg', jpeg(800, 600))).toMatchObject({ ok: true, ext: 'jpg' });
    expect(checkUnderlayFile('מגרש.webp', webp(900, 700))).toMatchObject({ ok: true, ext: 'webp', contentType: 'image/webp' });
  });

  it('takes exactly 4 MB and refuses one byte more, before anything else about it', () => {
    expect(checkUnderlayFile('big.png', png(1600, 1200, MAX_UNDERLAY_BYTES)).ok).toBe(true);
    expect(checkUnderlayFile('big.png', png(1600, 1200, MAX_UNDERLAY_BYTES + 1)))
      .toEqual({ ok: false, code: 'file too large', status: 413 });
    const bigPdf = new Uint8Array(MAX_UNDERLAY_BYTES + 1);
    bigPdf.set(PDF);
    expect(checkUnderlayFile('plan.pdf', bigPdf)).toMatchObject({ code: 'file too large' });
  });

  it('says what to do with a PDF or an iPhone photo, found by its bytes or by its name', () => {
    expect(checkUnderlayFile('plan.pdf', PDF)).toEqual({ ok: false, code: 'pdf', status: 415 });
    expect(checkUnderlayFile('plan.png', PDF)).toMatchObject({ code: 'pdf' });
    expect(checkUnderlayFile('plan.pdf', png(400, 300))).toMatchObject({ code: 'pdf' });
    expect(checkUnderlayFile('IMG_0001.HEIC', HEIC)).toEqual({ ok: false, code: 'heic', status: 415 });
    expect(checkUnderlayFile('IMG_0001.jpg', HEIC)).toMatchObject({ code: 'heic' });
    expect(checkUnderlayFile('IMG_0001.heif', jpeg(400, 300))).toMatchObject({ code: 'heic' });
  });

  it('refuses any other kind, and a name that disagrees with the bytes', () => {
    const unsupported = { ok: false, code: 'unsupported file type', status: 415 };
    expect(checkUnderlayFile('anim.gif', GIF)).toEqual(unsupported);
    expect(checkUnderlayFile('plan.svg', SVG)).toEqual(unsupported);
    expect(checkUnderlayFile('sketch.jpg', png(400, 300))).toEqual(unsupported);
    expect(checkUnderlayFile('sketch', png(400, 300))).toEqual(unsupported);
    expect(checkUnderlayFile('notes.png', Uint8Array.from(bytes('hello')))).toEqual(unsupported);
    // A PNG cut off after its signature states no size, so nothing can be checked against the limits.
    expect(checkUnderlayFile('cut.png', png(400, 300).slice(0, 8))).toEqual(unsupported);
  });

  it('refuses under 100 or over 8192 pixels on a side, and takes both edges', () => {
    expect(checkUnderlayFile('a.png', png(99, 500))).toEqual({ ok: false, code: 'image too small', status: 422 });
    expect(checkUnderlayFile('a.png', png(500, 99))).toMatchObject({ code: 'image too small' });
    expect(checkUnderlayFile('a.png', png(100, 100)).ok).toBe(true);
    expect(checkUnderlayFile('a.png', png(8192, 8192)).ok).toBe(true);
    expect(checkUnderlayFile('a.png', png(8193, 500))).toEqual({ ok: false, code: 'image too large', status: 422 });
    expect(checkUnderlayFile('a.png', png(500, 8193))).toMatchObject({ code: 'image too large' });
  });
});
```

- [ ] **Step 11: Run it to see it fail**

Run: `npx vitest run src/lib/site/underlay-file.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL, because `./underlay-file` cannot be resolved.

- [ ] **Step 12: Write `underlay-file.ts`**

Create `src/lib/site/underlay-file.ts`:

```ts
import { imageFacts } from './image-facts';
import {
  MAX_UNDERLAY_BYTES, MAX_UNDERLAY_PX, MIN_UNDERLAY_PX, UNDERLAY_TYPES,
  type UnderlayContentType, type UnderlayExtension, type UnderlayUploadCode,
} from './underlay-limits';

/**
 * Whether a file may lie under the map (spec §16, steps 4–6), in the order
 * the route checks: its size, then its type from both its bytes and its
 * name, then its size in pixels. The route runs this on what it received; the
 * card runs it before sending anything (spec §18.1: "by the same rules as the
 * server"), so a refusal a lead sees in the browser is the one the server
 * would have given.
 *
 * Both the bytes and the name must say PNG, JPEG or WebP, and the same one,
 * as `/api/uploads` asks of a workbook. A PDF or an iPhone photo is named for
 * what it is, by either, so its refusal can say what to do instead.
 */

type RefusalCode = Extract<UnderlayUploadCode,
  'file too large' | 'pdf' | 'heic' | 'unsupported file type' | 'image too small' | 'image too large'>;

export type UnderlayFileCheck =
  | { ok: true; ext: UnderlayExtension; contentType: UnderlayContentType; width: number; height: number }
  | { ok: false; code: RefusalCode; status: 413 | 415 | 422 };

/** A Map, so a name ending ".constructor" finds nothing. */
const BY_NAME = new Map<string, UnderlayExtension | 'pdf' | 'heic'>([
  ['png', 'png'], ['jpg', 'jpg'], ['jpeg', 'jpg'], ['webp', 'webp'],
  ['pdf', 'pdf'], ['heic', 'heic'], ['heif', 'heic'],
]);

function named(filename: string): UnderlayExtension | 'pdf' | 'heic' | null {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match === null ? null : BY_NAME.get(match[1].toLowerCase()) ?? null;
}

export function checkUnderlayFile(filename: string, bytes: Uint8Array): UnderlayFileCheck {
  if (bytes.byteLength > MAX_UNDERLAY_BYTES) return { ok: false, code: 'file too large', status: 413 };

  const facts = imageFacts(bytes);
  const byName = named(filename);
  if (facts.kind === 'pdf' || byName === 'pdf') return { ok: false, code: 'pdf', status: 415 };
  if (facts.kind === 'heic' || byName === 'heic') return { ok: false, code: 'heic', status: 415 };

  const byBytes: UnderlayExtension | null = facts.kind === 'png' ? 'png'
    : facts.kind === 'jpeg' ? 'jpg'
      : facts.kind === 'webp' ? 'webp' : null;
  if (byBytes === null || byName !== byBytes || facts.width === null || facts.height === null) {
    return { ok: false, code: 'unsupported file type', status: 415 };
  }

  if (facts.width < MIN_UNDERLAY_PX || facts.height < MIN_UNDERLAY_PX) {
    return { ok: false, code: 'image too small', status: 422 };
  }
  if (facts.width > MAX_UNDERLAY_PX || facts.height > MAX_UNDERLAY_PX) {
    return { ok: false, code: 'image too large', status: 422 };
  }
  return { ok: true, ext: byBytes, contentType: UNDERLAY_TYPES[byBytes], width: facts.width, height: facts.height };
}
```

- [ ] **Step 13: Run all three tests, typecheck and lint**

Run: `npx vitest run src/lib/site/underlay-limits.test.ts src/lib/site/image-facts.test.ts src/lib/site/underlay-file.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: 24 passed (11 + 8 + 5), exit 0.

Run: `npx tsc --noEmit`. Expected: exit 0.
Run: `rtk proxy npx eslint src/lib/site/underlay-limits.ts src/lib/site/image-facts.ts src/lib/site/underlay-file.ts src/lib/site/underlay-limits.test.ts src/lib/site/image-facts.test.ts src/lib/site/underlay-file.test.ts`. Expected: no problems.

- [ ] **Step 14: Commit**

```bash
git add src/lib/site/underlay-limits.ts src/lib/site/underlay-limits.test.ts src/lib/site/image-facts.ts src/lib/site/image-facts.test.ts src/lib/site/underlay-file.ts src/lib/site/underlay-file.test.ts
git commit -m "feat(site): what an image to trace may be — limits, header facts, one file check

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `underlay.ts` — where the image lies, and calibration

**Files:**
- Create: `src/lib/site/underlay.ts`, `src/lib/site/underlay.test.ts`

**Interfaces:**
- Consumes: `MAX_UNDERLAY_OFFSET_CM`, `MAX_UNDERLAY_WIDTH_CM`, `MIN_UNDERLAY_WIDTH_CM` (`underlay-limits.ts`, Task 1); `displaySize` (`image-facts.ts`, Task 1; in the test only).
- Produces:
  - types: `ImagePoint = [number, number]` (u, v: fractions of the displayed picture from its top-left); `MapPoint = [number, number]` (cm); `UnderlayPlacement { centreXCm; centreYCm; widthCm; rotationTenths }`; `UnderlayCalibration { from: ImagePoint; to: ImagePoint; distanceCm: number }`;
  - reading points: `imageToMap(placement, aspect, point): MapPoint`; `mapToImage(placement, aspect, point): ImagePoint`; `isOnImage(point): boolean`;
  - placement: `normaliseTenths(tenths): number`; `initialPlacement(plot): UnderlayPlacement`; `coverSize(placement, aspect): { widthCm; depthCm }`; `moveBy(placement, dxCm, dyCm): UnderlayPlacement | null`; `quarterTurn(placement, direction: 1 | -1): UnderlayPlacement`;
  - calibration: `calibrate(placement, aspect, from, to, distanceCm, parallel): UnderlayPlacement | null`.
  - `aspect` is always the displayed picture's height ÷ width.

- [ ] **Step 1: Write the failing test**

Create `src/lib/site/underlay.test.ts`. The plot is the camp's 26 × 24 m, and the picture is 4:3 (aspect 0.75) as wide as the plot, which is how a new image lies (spec §18.2). Expected values are worked out by hand in the comments.

```ts
import { describe, it, expect } from 'vitest';
import { displaySize } from './image-facts';
import {
  calibrate, coverSize, imageToMap, initialPlacement, isOnImage, mapToImage, moveBy, normaliseTenths, quarterTurn,
  type ImagePoint, type MapPoint, type UnderlayPlacement,
} from './underlay';

const ASPECT = 0.75;
/** Centred on a 26 × 24 m plot, as wide as it: 26 × 19.5 m, unturned. */
const P: UnderlayPlacement = { centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0 };

const distance = (a: MapPoint, b: MapPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('a point on the picture and a point on the map', () => {
  it('puts the picture’s top-left at the north-west when unturned — never mirrored', () => {
    // Half the width (1300) west of the middle, half the depth (975) north of it.
    expect(imageToMap(P, ASPECT, [0, 0])).toEqual([0, 225]);
    expect(imageToMap(P, ASPECT, [1, 0])).toEqual([2600, 225]);
    expect(imageToMap(P, ASPECT, [1, 1])).toEqual([2600, 2175]);
    expect(imageToMap(P, ASPECT, [0.5, 0.5])).toEqual([1300, 1200]);
  });

  it('turns clockwise seen from above: a quarter turn brings the top-left corner to the north-east', () => {
    // (-1300, -975) turned 90° clockwise, with y pointing south, is (975, -1300).
    const [x, y] = imageToMap({ ...P, rotationTenths: 900 }, ASPECT, [0, 0]);
    expect(x).toBeCloseTo(2275, 6);
    expect(y).toBeCloseTo(-100, 6);
  });

  it('round-trips map → picture → map and picture → map → picture, however it is turned', () => {
    for (const placement of [P, { ...P, rotationTenths: 1234 }, { centreXCm: -400, centreYCm: 3100, widthCm: 777, rotationTenths: 3599 }]) {
      for (const point of [[0, 0], [0.13, 0.87], [1, 1], [0.5, 0.25]] as ImagePoint[]) {
        const back = mapToImage(placement, ASPECT, imageToMap(placement, ASPECT, point));
        expect(back[0]).toBeCloseTo(point[0], 9);
        expect(back[1]).toBeCloseTo(point[1], 9);
      }
      const ground: MapPoint = [1000, 800];
      const again = imageToMap(placement, ASPECT, mapToImage(placement, ASPECT, ground));
      expect(distance(again, ground)).toBeLessThan(1e-6);
    }
  });

  it('knows a point on the picture from one beside it, edges included', () => {
    expect(isOnImage([0, 0])).toBe(true);
    expect(isOnImage([1, 1])).toBe(true);
    expect(isOnImage([0.5, 0.5])).toBe(true);
    expect(isOnImage([-0.001, 0.5])).toBe(false);
    expect(isOnImage([0.5, 1.0001])).toBe(false);
    expect(isOnImage([Number.NaN, 0.5])).toBe(false);
  });
});

describe('where a new picture lies, and what it covers', () => {
  it('lies centred on the plot and as wide as it, unturned', () => {
    expect(initialPlacement({ widthCm: 2600, depthCm: 2400 })).toEqual(P);
    expect(initialPlacement({ widthCm: 2601, depthCm: 2401 })).toEqual({ centreXCm: 1301, centreYCm: 1201, widthCm: 2601, rotationTenths: 0 });
  });

  it('covers its width by the width times its aspect', () => {
    expect(coverSize(P, ASPECT)).toEqual({ widthCm: 2600, depthCm: 1950 });
    expect(coverSize({ ...P, widthCm: 3120 }, 2760 / 3120)).toEqual({ widthCm: 3120, depthCm: 2760 });
  });
});

describe('moving and turning it', () => {
  it('moves by whole centimetres, and not past half a kilometre', () => {
    expect(moveBy(P, 10.4, -100)).toEqual({ ...P, centreXCm: 1310, centreYCm: 1100 });
    expect(moveBy(P, 60_000, 0)).toBeNull();
    expect(moveBy(P, 0, -60_000)).toBeNull();
  });

  it('turns a quarter about its own middle, both ways, and comes round after four', () => {
    const right = quarterTurn(P, 1);
    expect(right).toEqual({ ...P, rotationTenths: 900 });
    expect(imageToMap(right, ASPECT, [0.5, 0.5])).toEqual([1300, 1200]);
    expect(quarterTurn(P, -1).rotationTenths).toBe(2700);
    expect(quarterTurn({ ...P, rotationTenths: 3500 }, 1).rotationTenths).toBe(800);
    expect(quarterTurn(quarterTurn(quarterTurn(quarterTurn(P, 1), 1), 1), 1)).toEqual(P);
  });

  it('keeps a turn inside one circle, in whole tenths', () => {
    expect(normaliseTenths(3600)).toBe(0);
    expect(normaliseTenths(-1)).toBe(3599);
    expect(normaliseTenths(7237.4)).toBe(37);
  });
});

describe('calibration', () => {
  it('scales about A, so A stays where it is and AB becomes the typed length', () => {
    // A (0.1, 0.5) is at x 260 and B (0.9, 0.5) at x 2340: 20.8 m apart. Typed 26 m, so the width grows by 26 / 20.8
    // to 3250, and the middle moves so A stays at x 260: 260 + 0.4 × 3250 = 1560.
    const next = calibrate(P, ASPECT, [0.1, 0.5], [0.9, 0.5], 2600, false);
    expect(next).toEqual({ centreXCm: 1560, centreYCm: 1200, widthCm: 3250, rotationTenths: 0 });
    expect(imageToMap(next!, ASPECT, [0.1, 0.5])).toEqual([260, 1200]);
    expect(distance(imageToMap(next!, ASPECT, [0.1, 0.5]), imageToMap(next!, ASPECT, [0.9, 0.5]))).toBe(2600);
  });

  it('keeps A within a centimetre, and AB within a centimetre of the length, for a turned picture and a skewed pair', () => {
    const turned = { ...P, rotationTenths: 125 };
    const from: ImagePoint = [0.2, 0.3];
    const to: ImagePoint = [0.85, 0.62];
    const next = calibrate(turned, ASPECT, from, to, 2600, false);
    expect(next).not.toBeNull();
    expect(next!.rotationTenths).toBe(125);
    const a = imageToMap(next!, ASPECT, from);
    expect(distance(a, imageToMap(turned, ASPECT, from))).toBeLessThanOrEqual(1);
    expect(Math.abs(distance(a, imageToMap(next!, ASPECT, to)) - 2600)).toBeLessThanOrEqual(1);
  });

  it('straightens the picture with the parallel box: AB then lies along the nearer map axis, turned about A', () => {
    // A line drawn a little crooked on a slightly turned photo: after the box, it runs east-west.
    const skewed = { ...P, rotationTenths: 37 };
    const from: ImagePoint = [0.1, 0.2];
    const to: ImagePoint = [0.9, 0.25];
    const next = calibrate(skewed, ASPECT, from, to, 2600, true)!;
    const a = imageToMap(next, ASPECT, from);
    const b = imageToMap(next, ASPECT, to);
    expect(distance(a, imageToMap(skewed, ASPECT, from))).toBeLessThanOrEqual(1);
    // A turn is kept in tenths of a degree: across 26 m that is at most 2.3 cm off the axis.
    expect(Math.abs(b[1] - a[1])).toBeLessThanOrEqual(3);
    expect(next.rotationTenths).not.toBe(37);
    // A nearly north-south line straightens to the other axis.
    const upright = calibrate(P, ASPECT, [0.5, 0.1], [0.53, 0.9], 1500, true)!;
    const top = imageToMap(upright, ASPECT, [0.5, 0.1]);
    const bottom = imageToMap(upright, ASPECT, [0.53, 0.9]);
    expect(Math.abs(bottom[0] - top[0])).toBeLessThanOrEqual(3);
  });

  it('calibrates a phone photo on the picture as shown, after its EXIF turn (Review Focus #1)', () => {
    // Stored 4032 × 3024 with orientation 6 — shown upright, 3024 × 4032.
    const shown = displaySize({ kind: 'jpeg', width: 4032, height: 3024, orientation: 6 })!;
    const aspect = shown.height / shown.width;
    expect(aspect).toBeCloseTo(4 / 3, 9);
    // The fence's long side marked top to bottom on the upright photo, typed as 24 m.
    const next = calibrate(P, aspect, [0.5, 0.1], [0.5, 0.9], 2400, false)!;
    const a = imageToMap(next, aspect, [0.5, 0.1]);
    const b = imageToMap(next, aspect, [0.5, 0.9]);
    expect(Math.abs(distance(a, b) - 2400)).toBeLessThanOrEqual(1);
    // Read with the stored (landscape) aspect instead, the same two clicks would be 24 m of a different picture.
    const wrong = calibrate(P, 0.75, [0.5, 0.1], [0.5, 0.9], 2400, false)!;
    expect(wrong.widthCm).not.toBe(next.widthCm);
  });

  it('refuses a scale the typed distance makes absurd, and two points that are one', () => {
    // 26 cm of picture typed as 500 m makes it 5 km wide.
    expect(calibrate(P, ASPECT, [0.5, 0.5], [0.51, 0.5], 50_000, false)).toBeNull();
    // Corner to corner typed as 10 cm makes it 8 cm wide.
    expect(calibrate(P, ASPECT, [0, 0], [1, 1], 10, false)).toBeNull();
    expect(calibrate(P, ASPECT, [0.3, 0.3], [0.3, 0.3], 2600, false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/site/underlay.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL, because `./underlay` cannot be resolved.

- [ ] **Step 3: Write `underlay.ts`**

Create `src/lib/site/underlay.ts`:

```ts
import { MAX_UNDERLAY_OFFSET_CM, MAX_UNDERLAY_WIDTH_CM, MIN_UNDERLAY_WIDTH_CM } from './underlay-limits';

/**
 * Where the picture under the map lies (spec §17–18), and the two ways of
 * naming a point on it: as a fraction of the picture, or as a place on the
 * map. Pure: no `three`, no React, no DOM.
 *
 * The placement stores the map length of the picture's width. Its depth
 * follows from the picture's own proportions, `aspect` (height ÷ width of the
 * picture as shown, after any EXIF turn), which only the decoded image knows,
 * so every function that needs it is handed it. The turn is clockwise seen
 * from above, in tenths of a degree, about the picture's middle. At 0 the
 * picture's top edge faces north and its left edge west: never mirrored,
 * whatever the page's direction.
 *
 * Calibration points are fractions of the picture as shown (0–1), so they
 * hold whatever size the browser decodes it at (spec §17).
 */

/** u, v: fractions of the displayed picture's width and height, from its top-left corner. */
export type ImagePoint = [number, number];
/** x, y: map centimetres, x east and y south; fractional until something is stored. */
export type MapPoint = [number, number];

export interface UnderlayPlacement {
  /** Where the picture's middle sits on the map. */
  centreXCm: number;
  centreYCm: number;
  /** The map length of the picture's width, as displayed. */
  widthCm: number;
  /** Clockwise seen from above, tenths of a degree, 0–3599. */
  rotationTenths: number;
}

/** Two points marked on the picture, and the distance a lead typed between them (spec §17). */
export interface UnderlayCalibration {
  from: ImagePoint;
  to: ImagePoint;
  distanceCm: number;
}

const FULL_TURN_TENTHS = 3600;
const QUARTER_TURN_TENTHS = 900;

function radians(tenths: number): number {
  return (tenths / 10) * (Math.PI / 180);
}

/** Turned clockwise on the map, which, with y pointing south, is clockwise seen from above. */
function turn([x, y]: MapPoint, angle: number): MapPoint {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - y * sin, x * sin + y * cos];
}

/** A picture point's offset from the middle, before the turn. */
function offsetOf(placement: UnderlayPlacement, aspect: number, [u, v]: ImagePoint): MapPoint {
  return [(u - 0.5) * placement.widthCm, (v - 0.5) * placement.widthCm * aspect];
}

/** Whole tenths, 0–3599. */
export function normaliseTenths(tenths: number): number {
  return ((Math.round(tenths) % FULL_TURN_TENTHS) + FULL_TURN_TENTHS) % FULL_TURN_TENTHS;
}

export function imageToMap(placement: UnderlayPlacement, aspect: number, point: ImagePoint): MapPoint {
  const [dx, dy] = turn(offsetOf(placement, aspect, point), radians(placement.rotationTenths));
  return [placement.centreXCm + dx, placement.centreYCm + dy];
}

export function mapToImage(placement: UnderlayPlacement, aspect: number, [x, y]: MapPoint): ImagePoint {
  const [dx, dy] = turn([x - placement.centreXCm, y - placement.centreYCm], -radians(placement.rotationTenths));
  return [dx / placement.widthCm + 0.5, dy / (placement.widthCm * aspect) + 0.5];
}

/** On the picture, its edges included. */
export function isOnImage([u, v]: ImagePoint): boolean {
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

/** A new picture before calibration: centred on the plot and as wide as it. A way to see it, not a scale (spec §18.2). */
export function initialPlacement(plot: { widthCm: number; depthCm: number }): UnderlayPlacement {
  return {
    centreXCm: Math.round(plot.widthCm / 2),
    centreYCm: Math.round(plot.depthCm / 2),
    widthCm: plot.widthCm,
    rotationTenths: 0,
  };
}

/** How much of the map the picture covers: "מכסה על המפה 31.2 × 27.6 מ׳" (spec §18). */
export function coverSize(placement: UnderlayPlacement, aspect: number): { widthCm: number; depthCm: number } {
  return { widthCm: placement.widthCm, depthCm: Math.round(placement.widthCm * aspect) };
}

function inBounds(placement: UnderlayPlacement): boolean {
  return Math.abs(placement.centreXCm) <= MAX_UNDERLAY_OFFSET_CM
    && Math.abs(placement.centreYCm) <= MAX_UNDERLAY_OFFSET_CM
    && placement.widthCm >= MIN_UNDERLAY_WIDTH_CM
    && placement.widthCm <= MAX_UNDERLAY_WIDTH_CM;
}

/** Moved by whole centimetres (spec §18.4). Null when that would take its middle past half a kilometre. */
export function moveBy(placement: UnderlayPlacement, dxCm: number, dyCm: number): UnderlayPlacement | null {
  const next = {
    ...placement,
    centreXCm: placement.centreXCm + Math.round(dxCm),
    centreYCm: placement.centreYCm + Math.round(dyCm),
  };
  return inBounds(next) ? next : null;
}

/** A quarter turn about the picture's middle (spec §18.4): 1 is to the right (clockwise), −1 to the left. */
export function quarterTurn(placement: UnderlayPlacement, direction: 1 | -1): UnderlayPlacement {
  return { ...placement, rotationTenths: normaliseTenths(placement.rotationTenths + direction * QUARTER_TURN_TENTHS) };
}

/**
 * Calibration (spec §18.3). A and B are two points on the picture, and the
 * lead typed the distance between them. The picture is scaled about A, so A
 * stays where it is on the map and AB on the map is that distance. With
 * `parallel` ("הקו הזה מקביל לגדר") it is also turned about A until AB lies
 * along the nearer map axis. That is how a photographed sketch is
 * straightened from the same two clicks, with no rotation dial.
 *
 * The width is kept in whole centimetres and the turn in tenths of a degree.
 * The middle is then placed from A under the rounded width and turn, so the
 * rounding never walks A away: A moves by at most the middle's own rounding,
 * under a centimetre.
 *
 * Null when A and B are one point on the map, or when the result would be
 * narrower than 10 cm, wider than 500 m, or have its middle past half a
 * kilometre. Then it is the typed distance, not the map, that is wrong.
 */
export function calibrate(
  placement: UnderlayPlacement, aspect: number, from: ImagePoint, to: ImagePoint, distanceCm: number, parallel: boolean,
): UnderlayPlacement | null {
  const a = imageToMap(placement, aspect, from);
  const b = imageToMap(placement, aspect, to);
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(length > 0) || !(distanceCm > 0)) return null;

  const widthCm = Math.round((placement.widthCm * distanceCm) / length);
  let rotationTenths = placement.rotationTenths;
  if (parallel) {
    // AB's direction on the map, in the same clockwise-positive degrees as the turn.
    const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    rotationTenths = normaliseTenths(placement.rotationTenths + (Math.round(angle / 90) * 90 - angle) * 10);
  }

  const [dx, dy] = turn(offsetOf({ ...placement, widthCm }, aspect, from), radians(rotationTenths));
  const next = { centreXCm: Math.round(a[0] - dx), centreYCm: Math.round(a[1] - dy), widthCm, rotationTenths };
  return inBounds(next) ? next : null;
}
```

- [ ] **Step 4: Run the test**

Run the Step 2 command. Expected: 14 passed, exit 0.

Then check that the "A stays" rule can fail. In `calibrate`, temporarily replace the `const next = …` line's centre with the old one, `centreXCm: placement.centreXCm, centreYCm: placement.centreYCm`, and re-run. Expected: "scales about A…" and "keeps A within a centimetre…" fail. Restore the line: 14 passed.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npx tsc --noEmit`. Expected: exit 0.
Run: `rtk proxy npx eslint src/lib/site/underlay.ts src/lib/site/underlay.test.ts`. Expected: no problems.

```bash
git add src/lib/site/underlay.ts src/lib/site/underlay.test.ts
git commit -m "feat(site): where the image to trace lies — picture and map points, moves, quarter turns, calibration

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The image in the editor's model — `EditorUnderlay`, the `setUnderlay` op, its refusals and commands

**Files:**
- Modify: `src/lib/site/editor/model.ts` (the image type, the doc's optional field, three helpers)
- Modify: `src/lib/site/editor/ops.ts` (the op, its refusal, apply / invert / copy / coalesce)
- Modify: `src/lib/site/plan.ts` (only `applySiteOps`'s last branch, so `tsc` stays green until Task 4 writes the op)
- Modify: `src/app/(admin)/site/failure-messages.ts`, `src/app/(admin)/site/failure-messages.test.ts`
- Create: `src/lib/site/editor/underlay-commands.ts`
- Create: `src/lib/site/editor/ops.underlay.test.ts`, `src/lib/site/editor/underlay-commands.test.ts`

The new tests go in new files: `ops.test.ts` is one of #23's files.

**Interfaces:**
- Consumes:
  - `UnderlayPlacement`, `UnderlayCalibration`, `ImagePoint`, `initialPlacement`, `calibrate` (`underlay.ts`, Task 2);
  - `UnderlayContentType`, `contentTypeOf`, `underlayKeyPlan`, the byte, width, offset and calibration limits (`underlay-limits.ts`, Task 1);
  - `isBlank` (`@/lib/text/normalize`).
- Produces:
  - `model.ts`: `interface EditorUnderlay extends UnderlayPlacement { storageKey: string; contentType: UnderlayContentType; sizeBytes: number; filename: string; calibration: UnderlayCalibration | null }`; `EditorDoc.underlay?: EditorUnderlay | null`; `underlayOf(doc): EditorUnderlay | null`; `sameUnderlay(a, b): boolean`; `copyUnderlay(u): EditorUnderlay | null`.
  - `ops.ts`: `SiteOp` gains `{ type: 'setUnderlay'; underlay: EditorUnderlay | null }`; `underlayRefusal(underlay: EditorUnderlay | null): string | null`. `applyOps`, `invertOps` and `coalesceOps` handle it.
  - `underlay-commands.ts`: `interface UploadedUnderlay { storageKey; contentType; sizeBytes; filename }`; `uploadOps(doc, file): SiteOp[]`; `placeOps(doc, placement: UnderlayPlacement | null): SiteOp[]`; `calibrateOps(doc, aspect, from, to, distanceCm, parallel): SiteOp[] | null`; `removeUnderlayOps(doc): SiteOp[]`.
  - `failure-messages.ts`: three new rows.

- [ ] **Step 1: Write the failing op test**

Create `src/lib/site/editor/ops.underlay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { underlayOf, type EditorDoc, type EditorItem, type EditorUnderlay } from './model';
import { applyOps, coalesceOps, invertOps, opRefusal, underlayRefusal, type SiteOp } from './ops';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const KEY_A = `site-underlays/${PLAN}/${'a'.repeat(64)}.png`;
const KEY_B = `site-underlays/${PLAN}/${'b'.repeat(64)}.jpg`;

/** This file's own fixture: a 26 × 24 m plot and one tent. */
const TENT: EditorItem = {
  id: 't1', kind: 'tent', label: 'אוהל 1', xCm: 500, yCm: 500, widthCm: 300, depthCm: 300,
  heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false,
};

function docOf(underlay?: EditorUnderlay | null): EditorDoc {
  const doc: EditorDoc = { plot: { id: PLAN, widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items: [TENT], defaults: {} };
  return underlay === undefined ? doc : { ...doc, underlay };
}

function image(over: Partial<EditorUnderlay> = {}): EditorUnderlay {
  return {
    storageKey: KEY_A, contentType: 'image/png', sizeBytes: 812_345, filename: 'שרטוט.png',
    centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0, calibration: null, ...over,
  };
}

const set = (underlay: EditorUnderlay | null): SiteOp => ({ type: 'setUnderlay', underlay });

describe('the image’s refusals', () => {
  it('passes a well-formed image, and none', () => {
    expect(underlayRefusal(image())).toBeNull();
    expect(underlayRefusal(image({ calibration: { from: [0, 0.25], to: [1, 0.5], distanceCm: 2600 } }))).toBeNull();
    expect(underlayRefusal(null)).toBeNull();
    expect(opRefusal(set(null))).toBeNull();
  });

  it('refuses a file that is not a picture uploaded to a map', () => {
    const file = 'an underlay file must be a png, jpeg or webp image uploaded to a map';
    expect(underlayRefusal(image({ storageKey: `uploads/${'a'.repeat(64)}.xlsx` }))).toBe(file);
    expect(underlayRefusal(image({ storageKey: `site-underlays/../${'a'.repeat(64)}.png` }))).toBe(file);
    expect(underlayRefusal(image({ contentType: 'image/jpeg' }))).toBe(file);
    expect(underlayRefusal(image({ storageKey: KEY_B, contentType: 'image/png' }))).toBe(file);
    expect(underlayRefusal(image({ sizeBytes: 0 }))).toBe(file);
    expect(underlayRefusal(image({ sizeBytes: 4 * 1024 * 1024 + 1 }))).toBe(file);
    expect(underlayRefusal(image({ sizeBytes: 1.5 }))).toBe(file);
    expect(underlayRefusal(image({ filename: '  ' }))).toBe(file);
    expect(opRefusal(set(image({ filename: '‏' })))).toBe(file);
  });

  it('refuses a placement in fractions, too small, too far or turned past a circle', () => {
    const placement = 'an underlay placement must be whole centimetres and tenths of a degree';
    expect(underlayRefusal(image({ centreXCm: 12.5 }))).toBe(placement);
    expect(underlayRefusal(image({ centreYCm: 50_001 }))).toBe(placement);
    expect(underlayRefusal(image({ centreXCm: -50_001 }))).toBe(placement);
    expect(underlayRefusal(image({ widthCm: 9 }))).toBe(placement);
    expect(underlayRefusal(image({ widthCm: 50_001 }))).toBe(placement);
    expect(underlayRefusal(image({ rotationTenths: 3600 }))).toBe(placement);
    expect(underlayRefusal(image({ rotationTenths: -1 }))).toBe(placement);
    expect(underlayRefusal(image({ rotationTenths: 12.5 }))).toBe(placement);
    expect(underlayRefusal(image({ centreXCm: -50_000, centreYCm: 50_000, widthCm: 10, rotationTenths: 3599 }))).toBeNull();
  });

  it('refuses a calibration off the picture, of no length, or not in whole centimetres', () => {
    const calibration = 'an underlay calibration must be two points on the image and a distance of 10 cm to 500 m';
    expect(underlayRefusal(image({ calibration: { from: [1.2, 0], to: [0.5, 0.5], distanceCm: 2600 } }))).toBe(calibration);
    expect(underlayRefusal(image({ calibration: { from: [0.1, Number.NaN], to: [0.5, 0.5], distanceCm: 2600 } }))).toBe(calibration);
    expect(underlayRefusal(image({ calibration: { from: [0.1, 0.1], to: [0.5, 0.5], distanceCm: 5 } }))).toBe(calibration);
    expect(underlayRefusal(image({ calibration: { from: [0.1, 0.1], to: [0.5, 0.5], distanceCm: 2600.5 } }))).toBe(calibration);
    expect(underlayRefusal(image({ calibration: { from: [0.1, 0.1], to: [0.5, 0.5], distanceCm: 50_001 } }))).toBe(calibration);
  });
});

describe('applying, undoing and batching the image', () => {
  it('reads a doc written before the image existed as having none', () => {
    expect(underlayOf(docOf())).toBeNull();
    expect(underlayOf(docOf(null))).toBeNull();
    expect(underlayOf(docOf(image()))).toEqual(image());
  });

  it('puts the image on the map and takes it off, and leaves the items as they were', () => {
    const before = docOf();
    const placed = applyOps(before, [set(image())]);
    expect(placed.skipped).toEqual([]);
    expect(underlayOf(placed.doc)).toEqual(image());
    expect(placed.doc.items).toBe(before.items);
    expect(underlayOf(applyOps(placed.doc, [set(null)]).doc)).toBeNull();
  });

  it('gives back the very same doc when no op touches the image or anything else', () => {
    const doc = docOf(image());
    expect(applyOps(doc, []).doc).toBe(doc);
    expect(applyOps(doc, [{ type: 'update', id: 't1', patch: { xCm: 600 } }]).doc.underlay).toBe(doc.underlay);
  });

  it('keeps its own copy: changing the op afterwards changes nothing on the map', () => {
    const op = set(image({ calibration: { from: [0.1, 0.5], to: [0.9, 0.5], distanceCm: 2600 } }));
    const doc = applyOps(docOf(), [op]).doc;
    (op as { underlay: EditorUnderlay }).underlay.calibration!.from[0] = 0.7;
    (op as { underlay: EditorUnderlay }).underlay.centreXCm = 9;
    expect(underlayOf(doc)?.calibration?.from[0]).toBe(0.1);
    expect(underlayOf(doc)?.centreXCm).toBe(1300);
  });

  it('undoes to what was there — none, or the image before — and records nothing for a change to the same', () => {
    const none = docOf();
    expect(invertOps(none, [set(image())])).toEqual([set(null)]);
    const old = docOf(image({ rotationTenths: 900 }));
    const inverse = invertOps(old, [set(image({ storageKey: KEY_B, contentType: 'image/jpeg' }))]);
    expect(inverse).toEqual([set(image({ rotationTenths: 900 }))]);
    expect(invertOps(old, [set(image({ rotationTenths: 900 }))])).toEqual([]);
    expect(invertOps(none, [set(null)])).toEqual([]);
  });

  it('comes back exactly after an op and its inverse', () => {
    for (const [start, op] of [
      [docOf(), set(image())],
      [docOf(image()), set(null)],
      [docOf(image()), set(image({ centreXCm: 1500, rotationTenths: 37 }))],
    ] as Array<[EditorDoc, SiteOp]>) {
      const after = applyOps(start, [op]).doc;
      const back = applyOps(after, invertOps(start, [op])).doc;
      expect(underlayOf(back)).toEqual(underlayOf(start));
    }
  });

  it('sends only the last image of a batch, in the first one’s place', () => {
    const move: SiteOp = { type: 'update', id: 't1', patch: { xCm: 600 } };
    expect(coalesceOps([set(image()), move, set(image({ centreXCm: 1400 })), set(null)])).toEqual([set(null), move]);
    expect(coalesceOps([move, set(image({ widthCm: 3000 }))])).toEqual([move, set(image({ widthCm: 3000 }))]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/site/editor/ops.underlay.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL, because `underlayOf` and `underlayRefusal` are not exported (`… is not a function`).

- [ ] **Step 3: Add the image to the model**

Read `src/lib/site/editor/model.ts` with the Read tool. Replace its first four lines (the imports) with:

```ts
import type { SiteItemKind } from '@/db/schema/site';
import type { KindDefaults } from '../defaults';
import type { Rect } from '../geometry';
import { SITE_KINDS } from '../kinds';
import type { UnderlayCalibration, UnderlayPlacement } from '../underlay';
import type { UnderlayContentType } from '../underlay-limits';
```

Replace the `EditorDoc` interface:

```ts
export interface EditorDoc {
  plot: EditorPlot;
  items: EditorItem[];
  defaults: KindDefaults;
}
```

with:

```ts
/**
 * The picture under the map (`site_underlays`, spec §17): its file and where
 * it lies, as the row holds them without their timestamps. How each viewer
 * sees it — shown or not, how see-through — is theirs alone
 * (`EditorUi.underlay`), never part of the doc (D19).
 */
export interface EditorUnderlay extends UnderlayPlacement {
  storageKey: string;
  contentType: UnderlayContentType;
  sizeBytes: number;
  filename: string;
  /** Null until the picture has been calibrated; the card then says its scale is temporary. */
  calibration: UnderlayCalibration | null;
}

export interface EditorDoc {
  plot: EditorPlot;
  items: EditorItem[];
  defaults: KindDefaults;
  /**
   * The picture under the map. Absent and null both mean none — read it only
   * through `underlayOf`. Optional so a doc built before the picture existed
   * (every test fixture, and #23's lines) is still a doc; `loadDoc` always
   * sets it.
   */
  underlay?: EditorUnderlay | null;
}
```

After `findItem`, add:

```ts
/** The picture under the map, or null: the one way to read `EditorDoc.underlay`. */
export function underlayOf(doc: Pick<EditorDoc, 'underlay'>): EditorUnderlay | null {
  return doc.underlay ?? null;
}

/** The same file lying the same way, calibrated from the same two points: field by field. */
export function sameUnderlay(a: EditorUnderlay | null, b: EditorUnderlay | null): boolean {
  if (a === null || b === null) return a === b;
  const ca = a.calibration;
  const cb = b.calibration;
  const sameCalibration = ca === null || cb === null
    ? ca === cb
    : ca.distanceCm === cb.distanceCm
      && ca.from[0] === cb.from[0] && ca.from[1] === cb.from[1]
      && ca.to[0] === cb.to[0] && ca.to[1] === cb.to[1];
  return sameCalibration
    && a.storageKey === b.storageKey && a.contentType === b.contentType
    && a.sizeBytes === b.sizeBytes && a.filename === b.filename
    && a.centreXCm === b.centreXCm && a.centreYCm === b.centreYCm
    && a.widthCm === b.widthCm && a.rotationTenths === b.rotationTenths;
}

/** A copy that shares no array with the one it came from: history and the save queue both keep ops. */
export function copyUnderlay(underlay: EditorUnderlay | null): EditorUnderlay | null {
  if (underlay === null) return null;
  const { calibration } = underlay;
  return {
    ...underlay,
    calibration: calibration === null ? null : {
      from: [calibration.from[0], calibration.from[1]],
      to: [calibration.to[0], calibration.to[1]],
      distanceCm: calibration.distanceCm,
    },
  };
}
```

- [ ] **Step 4: Add the op to `ops.ts`**

Read `src/lib/site/editor/ops.ts` with the Read tool. Make these edits:

1. Replace `import { findItem, type EditorDoc, type EditorItem } from './model';` with:

```ts
import {
  MAX_CALIBRATION_CM, MAX_UNDERLAY_BYTES, MAX_UNDERLAY_OFFSET_CM, MAX_UNDERLAY_WIDTH_CM,
  MIN_CALIBRATION_CM, MIN_UNDERLAY_WIDTH_CM, contentTypeOf, underlayKeyPlan,
} from '../underlay-limits';
import {
  copyUnderlay, findItem, sameUnderlay, underlayOf, type EditorDoc, type EditorItem, type EditorUnderlay,
} from './model';
```

2. Replace the `SiteOp` type:

```ts
export type SiteOp =
  | { type: 'add'; item: EditorItem }
  | { type: 'update'; id: string; patch: ItemPatch }
  | { type: 'remove'; id: string }
  | { type: 'setKindDefault'; kind: SiteItemKind; size: KindSize | null };
```

with:

```ts
export type SiteOp =
  | { type: 'add'; item: EditorItem }
  | { type: 'update'; id: string; patch: ItemPatch }
  | { type: 'remove'; id: string }
  | { type: 'setKindDefault'; kind: SiteItemKind; size: KindSize | null }
  /** The picture under the map, whole, or null to take it off (spec §17). One per map, so no id. */
  | { type: 'setUnderlay'; underlay: EditorUnderlay | null };
```

3. After `kindSizeRefusal`, add:

```ts
function isWholeIn(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isImagePoint(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2
    && value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1);
}

/**
 * The picture's shape (spec §17), checked by the client before it is queued
 * and by the server before it writes. Only the server can tell that the file
 * is this map's own (`plan.ts`); here a key must at least be a picture's key,
 * on some map, with the content type its extension names.
 */
export function underlayRefusal(underlay: EditorUnderlay | null): string | null {
  if (underlay === null) return null;
  const { storageKey, contentType, sizeBytes, filename, calibration } = underlay;
  if (typeof storageKey !== 'string' || underlayKeyPlan(storageKey) === null
    || contentTypeOf(storageKey) !== contentType
    || !isWholeIn(sizeBytes, 1, MAX_UNDERLAY_BYTES)
    || typeof filename !== 'string' || isBlank(filename)) {
    return 'an underlay file must be a png, jpeg or webp image uploaded to a map';
  }
  if (!isWholeIn(underlay.centreXCm, -MAX_UNDERLAY_OFFSET_CM, MAX_UNDERLAY_OFFSET_CM)
    || !isWholeIn(underlay.centreYCm, -MAX_UNDERLAY_OFFSET_CM, MAX_UNDERLAY_OFFSET_CM)
    || !isWholeIn(underlay.widthCm, MIN_UNDERLAY_WIDTH_CM, MAX_UNDERLAY_WIDTH_CM)
    || !isWholeIn(underlay.rotationTenths, 0, 3599)) {
    return 'an underlay placement must be whole centimetres and tenths of a degree';
  }
  if (calibration !== null && (typeof calibration !== 'object'
    || !isImagePoint(calibration.from) || !isImagePoint(calibration.to)
    || !isWholeIn(calibration.distanceCm, MIN_CALIBRATION_CM, MAX_CALIBRATION_CM))) {
    return 'an underlay calibration must be two points on the image and a distance of 10 cm to 500 m';
  }
  return null;
}
```

4. In `opRefusal`, before `default: return 'unknown operation';`, add:

```ts
    case 'setUnderlay': return underlayRefusal(op.underlay);
```

5. In `applyOps`, replace:

```ts
  let items = doc.items;
  let defaults = doc.defaults;
  const skipped: SiteOp[] = [];
  for (const op of ops) {
    if (op.type === 'setKindDefault') {
      defaults = withDefault(defaults, op.kind, op.size);
      continue;
    }
```

with:

```ts
  let items = doc.items;
  let defaults = doc.defaults;
  /** Undefined until an op sets the picture: a doc no op touches keeps its own field, or its lack of one. */
  let underlay: EditorUnderlay | null | undefined;
  const skipped: SiteOp[] = [];
  for (const op of ops) {
    if (op.type === 'setKindDefault') {
      defaults = withDefault(defaults, op.kind, op.size);
      continue;
    }
    if (op.type === 'setUnderlay') {
      underlay = copyUnderlay(op.underlay);
      continue;
    }
```

and replace its last two lines:

```ts
  const unchanged = items === doc.items && defaults === doc.defaults;
  return { doc: unchanged ? doc : { ...doc, items, defaults }, skipped };
```

with:

```ts
  if (items === doc.items && defaults === doc.defaults && underlay === undefined) return { doc, skipped };
  return { doc: underlay === undefined ? { ...doc, items, defaults } : { ...doc, items, defaults, underlay }, skipped };
```

6. In `inverseOf`'s switch, after the `setKindDefault` case, add:

```ts
    case 'setUnderlay': {
      const before = underlayOf(doc);
      return sameUnderlay(before, op.underlay) ? null : { type: 'setUnderlay', underlay: copyUnderlay(before) };
    }
```

7. In `copyOf`'s switch, add:

```ts
    case 'setUnderlay': return { type: 'setUnderlay', underlay: copyUnderlay(op.underlay) };
```

8. In `coalesceOps`, after `const lastForKind = new Map<SiteItemKind, number>();`, add `let underlayAt: number | undefined;`. After the `setKindDefault` block's closing `continue; }`, add:

```ts
    if (op.type === 'setUnderlay') {
      // One picture per map: the last value wins, in the first one's place, as a kind's default does.
      if (underlayAt === undefined) {
        underlayAt = out.length;
        out.push(copyOf(op));
      } else {
        out[underlayAt] = copyOf(op);
      }
      continue;
    }
```

Add `setUnderlay` to `coalesceOps`' docblock sentence "a kind's default keeps only its last size", so it reads "a kind's default, and the picture under the map, keep only their last value".

- [ ] **Step 5: Keep `applySiteOps` exhaustive until Task 4 writes the op**

`applySiteOps` in `src/lib/site/plan.ts` reaches `setKindDefault` by elimination (`} else if (op.size === null) {`). With a fifth op in the union that no longer typechecks. Read the file with the Read tool and replace:

```ts
      } else if (op.size === null) {
        await tx.delete(siteKindDefaults).where(eq(siteKindDefaults.kind, op.kind));
      } else {
        // Inset is a fact about nets only, same as an item's (`patchSet` above).
        const size = {
          widthCm: op.size.widthCm, depthCm: op.size.depthCm, heightCm: op.size.heightCm,
          insetCm: op.kind === 'shade' ? op.size.insetCm : null,
        };
        await tx.insert(siteKindDefaults).values({ kind: op.kind, ...size, updatedBy: actor })
          .onConflictDoUpdate({ target: siteKindDefaults.kind, set: { ...size, updatedAt: new Date(), updatedBy: actor } });
      }
```

with:

```ts
      } else if (op.type === 'setKindDefault') {
        if (op.size === null) {
          await tx.delete(siteKindDefaults).where(eq(siteKindDefaults.kind, op.kind));
        } else {
          // Inset is a fact about nets only, same as an item's (`patchSet` above).
          const size = {
            widthCm: op.size.widthCm, depthCm: op.size.depthCm, heightCm: op.size.heightCm,
            insetCm: op.kind === 'shade' ? op.size.insetCm : null,
          };
          await tx.insert(siteKindDefaults).values({ kind: op.kind, ...size, updatedBy: actor })
            .onConflictDoUpdate({ target: siteKindDefaults.kind, set: { ...size, updatedAt: new Date(), updatedBy: actor } });
        }
      } else {
        // `setUnderlay`: written from Task 4 of the Part C plan on, when its table exists. No client sends one before.
        throw new Error('unknown operation');
      }
```

- [ ] **Step 6: Run the op test**

Run the Step 2 command. Expected: 11 passed, exit 0.

- [ ] **Step 7: Write the failing commands test**

Create `src/lib/site/editor/underlay-commands.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { imageToMap, quarterTurn } from '../underlay';
import { underlayOf, type EditorDoc, type EditorUnderlay } from './model';
import { applyOps, invertOps } from './ops';
import { calibrateOps, placeOps, removeUnderlayOps, uploadOps, type UploadedUnderlay } from './underlay-commands';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const FILE_A: UploadedUnderlay = {
  storageKey: `site-underlays/${PLAN}/${'a'.repeat(64)}.png`, contentType: 'image/png', sizeBytes: 812_345, filename: 'שרטוט.png',
};
const FILE_B: UploadedUnderlay = {
  storageKey: `site-underlays/${PLAN}/${'b'.repeat(64)}.jpg`, contentType: 'image/jpeg', sizeBytes: 1_234_567, filename: 'IMG_2231.jpg',
};

function docOf(underlay: EditorUnderlay | null = null): EditorDoc {
  return { plot: { id: PLAN, widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items: [], defaults: {}, underlay };
}

/** Where a calibrated, straightened picture lies. */
const PLACED: EditorUnderlay = {
  ...FILE_A, centreXCm: 1000, centreYCm: 900, widthCm: 3000, rotationTenths: 37,
  calibration: { from: [0.1, 0.5], to: [0.9, 0.5], distanceCm: 2600 },
};

describe('a picture uploaded to the map', () => {
  it('lies centred on the plot and as wide as it, unturned and uncalibrated (§18.2)', () => {
    expect(uploadOps(docOf(), FILE_A)).toEqual([{
      type: 'setUnderlay',
      underlay: { ...FILE_A, centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0, calibration: null },
    }]);
  });

  it('replaces the old one where it lay — its middle and width — and starts the turn and the calibration over (§18.7)', () => {
    expect(uploadOps(docOf(PLACED), FILE_B)).toEqual([{
      type: 'setUnderlay',
      underlay: { ...FILE_B, centreXCm: 1000, centreYCm: 900, widthCm: 3000, rotationTenths: 0, calibration: null },
    }]);
  });

  it('changes nothing when the same file comes again', () => {
    expect(uploadOps(docOf(PLACED), FILE_A)).toEqual([]);
  });
});

describe('moving, turning, calibrating and removing it', () => {
  it('moves or turns it as one op, and does nothing without a picture, without a change, or for a refused move', () => {
    const turned = quarterTurn(PLACED, 1);
    expect(placeOps(docOf(PLACED), turned)).toEqual([{ type: 'setUnderlay', underlay: { ...PLACED, rotationTenths: 937 } }]);
    expect(placeOps(docOf(PLACED), { centreXCm: 1000, centreYCm: 900, widthCm: 3000, rotationTenths: 37 })).toEqual([]);
    expect(placeOps(docOf(PLACED), null)).toEqual([]);
    expect(placeOps(docOf(), turned)).toEqual([]);
  });

  it('calibrates as one op that keeps the two points and the distance (§18.3)', () => {
    const doc = docOf({ ...PLACED, rotationTenths: 0, calibration: null });
    const ops = calibrateOps(doc, 0.75, [0.1, 0.5], [0.9, 0.5], 2600, false);
    expect(ops).toHaveLength(1);
    const next = underlayOf(applyOps(doc, ops!).doc)!;
    expect(next.calibration).toEqual({ from: [0.1, 0.5], to: [0.9, 0.5], distanceCm: 2600 });
    const a = imageToMap(next, 0.75, [0.1, 0.5]);
    const b = imageToMap(next, 0.75, [0.9, 0.5]);
    expect(Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]))).toBe(2600);
  });

  it('answers null for a distance that makes the scale absurd, and nothing without a picture', () => {
    expect(calibrateOps(docOf(PLACED), 0.75, [0.5, 0.5], [0.51, 0.5], 50_000, false)).toBeNull();
    expect(calibrateOps(docOf(), 0.75, [0.1, 0.5], [0.9, 0.5], 2600, false)).toEqual([]);
  });

  it('takes it off the map, and does nothing when there is none', () => {
    expect(removeUnderlayOps(docOf(PLACED))).toEqual([{ type: 'setUnderlay', underlay: null }]);
    expect(removeUnderlayOps(docOf())).toEqual([]);
  });

  it('comes back exactly after each command and its inverse', () => {
    const start = docOf(PLACED);
    for (const ops of [
      uploadOps(start, FILE_B),
      placeOps(start, quarterTurn(PLACED, -1)),
      calibrateOps(start, 0.75, [0.2, 0.2], [0.8, 0.6], 1800, true)!,
      removeUnderlayOps(start),
    ]) {
      expect(ops.length).toBeGreaterThan(0);
      const after = applyOps(start, ops).doc;
      expect(underlayOf(applyOps(after, invertOps(start, ops)).doc)).toEqual(PLACED);
    }
  });
});
```

- [ ] **Step 8: Run it to see it fail**

Run: `npx vitest run src/lib/site/editor/underlay-commands.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL, because `./underlay-commands` cannot be resolved.

- [ ] **Step 9: Write `underlay-commands.ts`**

Create `src/lib/site/editor/underlay-commands.ts`:

```ts
import { calibrate, initialPlacement, type ImagePoint, type UnderlayPlacement } from '../underlay';
import type { UnderlayContentType } from '../underlay-limits';
import { sameUnderlay, underlayOf, type EditorDoc, type EditorUnderlay } from './model';
import type { SiteOp } from './ops';

/**
 * Every edit of the picture under the map as ops (spec §18), with the rule
 * `commands.ts` keeps: pure, and `[]` when nothing would change, so a no-op
 * is never recorded in history or sent. Each user action is one op, so one
 * undo step: an upload, a calibration, a drag, a nudge, a quarter turn, a
 * removal.
 */

/** What the upload route answered (spec §16): the file as stored, not yet on the map. */
export interface UploadedUnderlay {
  storageKey: string;
  contentType: UnderlayContentType;
  sizeBytes: number;
  filename: string;
}

function setTo(doc: EditorDoc, next: EditorUnderlay | null): SiteOp[] {
  return sameUnderlay(underlayOf(doc), next) ? [] : [{ type: 'setUnderlay', underlay: next }];
}

/**
 * A picture just uploaded, on the map. The first lies centred on the plot and
 * as wide as it, unturned and uncalibrated (§18.2). A replacement keeps where
 * the old one lay — its middle and its width — and starts over on the rest:
 * the calibration belonged to the old picture (§18.7), and so did any turn
 * that straightened it. The same file again changes nothing.
 */
export function uploadOps(doc: EditorDoc, file: UploadedUnderlay): SiteOp[] {
  const current = underlayOf(doc);
  if (current !== null && current.storageKey === file.storageKey) return [];
  const placement: UnderlayPlacement = current === null
    ? initialPlacement(doc.plot)
    : { centreXCm: current.centreXCm, centreYCm: current.centreYCm, widthCm: current.widthCm, rotationTenths: 0 };
  return setTo(doc, { ...file, ...placement, calibration: null });
}

/** The picture moved or turned (§18.4). `null` is a move `moveBy` refused. */
export function placeOps(doc: EditorDoc, placement: UnderlayPlacement | null): SiteOp[] {
  const current = underlayOf(doc);
  if (current === null || placement === null) return [];
  return setTo(doc, { ...current, ...placement });
}

/**
 * Calibration, as one op that keeps the two points and the distance, so the
 * card can say what it was calibrated from (§18.3). Null when the typed
 * distance puts the scale out of range (`calibrate`); `[]` with no picture.
 */
export function calibrateOps(
  doc: EditorDoc, aspect: number, from: ImagePoint, to: ImagePoint, distanceCm: number, parallel: boolean,
): SiteOp[] | null {
  const current = underlayOf(doc);
  if (current === null) return [];
  const placement = calibrate(current, aspect, from, to, distanceCm, parallel);
  if (placement === null) return null;
  return setTo(doc, {
    ...current,
    ...placement,
    calibration: { from: [from[0], from[1]], to: [to[0], to[1]], distanceCm },
  });
}

/** Off the map (§18.8). The file stays in storage, so an undo can bring it back (§16). */
export function removeUnderlayOps(doc: EditorDoc): SiteOp[] {
  return underlayOf(doc) === null ? [] : [{ type: 'setUnderlay', underlay: null }];
}
```

- [ ] **Step 10: Run the commands test**

Run the Step 8 command. Expected: 8 passed, exit 0.

- [ ] **Step 11: Write the failing Hebrew test**

Read `src/app/(admin)/site/failure-messages.test.ts`. Inside its `describe`, after the last `it`, add:

```ts
  it('says the image’s three refusals in Hebrew, in the spec’s words', () => {
    expect(siteFailureMessage(new Error('an underlay file must be one uploaded to this map')))
      .toBe('קובץ תמונת הרקע לא שייך למפה הזו. טעינה מחדש של המפה תסדר את זה');
    expect(siteFailureMessage(new Error('an underlay file must be a png, jpeg or webp image uploaded to a map')))
      .toBe('קובץ תמונת הרקע לא שייך למפה הזו. טעינה מחדש של המפה תסדר את זה');
    expect(siteFailureMessage(new Error('an underlay placement must be whole centimetres and tenths of a degree')))
      .toBe('מיקום תמונת הרקע נמדד במספר שלם של סנטימטרים');
    expect(siteFailureMessage(new Error('an underlay calibration must be two points on the image and a distance of 10 cm to 500 m')))
      .toBe('הכיול של תמונת הרקע לא נשמר כמו שצריך. אפשר לכייל שוב');
  });
```

Run: `npx vitest run "src/app/(admin)/site/failure-messages.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: 1 failed, because the sentence is the Hebrew fallback. The other tests pass.

- [ ] **Step 12: Add the three rows**

In `src/app/(admin)/site/failure-messages.ts`, add as the last three entries of `SITE_ERRORS`, after `['an item sort must be', …],`:

```ts
  ['an underlay file must be', 'קובץ תמונת הרקע לא שייך למפה הזו. טעינה מחדש של המפה תסדר את זה'],
  ['an underlay placement must be', 'מיקום תמונת הרקע נמדד במספר שלם של סנטימטרים'],
  ['an underlay calibration must be', 'הכיול של תמונת הרקע לא נשמר כמו שצריך. אפשר לכייל שוב'],
```

- [ ] **Step 13: Run this task's tests, typecheck, lint**

Run: `npx vitest run src/lib/site/editor/ops.underlay.test.ts src/lib/site/editor/underlay-commands.test.ts src/lib/site/editor/ops.test.ts "src/app/(admin)/site/failure-messages.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: exit 0, 0 failed. The existing `ops.test.ts` is included to prove the four item ops are unchanged.

Run: `npx tsc --noEmit`. Expected: exit 0. If `tsc` names another `switch` over `SiteOp` that is no longer exhaustive, stop and report it. The plan found only `ops.ts` and `plan.ts`.
Run: `rtk proxy npx eslint src/lib/site/editor/model.ts src/lib/site/editor/ops.ts src/lib/site/editor/underlay-commands.ts src/lib/site/editor/ops.underlay.test.ts src/lib/site/editor/underlay-commands.test.ts src/lib/site/plan.ts "src/app/(admin)/site/failure-messages.ts" "src/app/(admin)/site/failure-messages.test.ts"`. Expected: no problems.

- [ ] **Step 14: Commit**

```bash
git add src/lib/site/editor/model.ts src/lib/site/editor/ops.ts src/lib/site/editor/underlay-commands.ts src/lib/site/editor/ops.underlay.test.ts src/lib/site/editor/underlay-commands.test.ts src/lib/site/plan.ts "src/app/(admin)/site/failure-messages.ts" "src/app/(admin)/site/failure-messages.test.ts"
git commit -m "feat(site): the image under the map in the editor's model — setUnderlay, its refusals and commands

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `site_underlays` — the table, migration `0015`, and the image in `loadDoc` and `applySiteOps`

**Files:**
- Modify: `src/db/schema/site.ts` (the `jsonb` import; `siteUnderlays` at the end)
- Create (generated): `drizzle/00NN_site_underlays.sql`, `drizzle/meta/00NN_snapshot.json`. Modify (generated): `drizzle/meta/_journal.json`. `NN` is `15` once #23's `0013` and B's `0014` are on `main`; otherwise the next free number, renumbered in Task 10.
- Modify: `src/lib/site/plan.ts` (`readUnderlay`, `loadDoc`, `writeUnderlay`, the `setUnderlay` branch)
- Create: `src/lib/site/plan.underlay.test.ts`

The tests go in a new file: `plan.test.ts` is one of #23's files.

**Interfaces:**
- Consumes: `EditorUnderlay` (`model.ts`, Task 3); `underlayRefusal` (run by `opRefusal`, Task 3); `underlayKeyPlan`, `underlayKey` (`underlay-limits.ts`, Task 1).
- Produces:
  - `siteUnderlays` (drizzle table `site_underlays`): `planId` (primary key, a foreign key to `site_plans`, cascade), `storageKey`, `contentType`, `sizeBytes`, `filename`, `centreXCm`, `centreYCm`, `widthCm`, `rotationTenths` (default 0), `calibration` (jsonb, null), `uploadedAt`, `uploadedBy`, `updatedAt`, `updatedBy`;
  - `readUnderlay(db: AnyDb, planId: string): Promise<EditorUnderlay | null>`;
  - `loadDoc(...)`'s `doc.underlay` is always set (`EditorUnderlay | null`);
  - `applySiteOps` applies `setUnderlay`, and throws `an underlay file must be one uploaded to this map` for another plan's key.

- [ ] **Step 1: Check the migration number before anything else**

```bash
/usr/bin/git fetch origin
node -e "console.log(require('./drizzle/meta/_journal.json').entries.map(e=>e.tag).slice(-3).join('\n'))"
node -e "const {execSync}=require('child_process');console.log(execSync('/usr/bin/git ls-tree --name-only origin/main drizzle/').toString().split('\n').filter(f=>f.endsWith('.sql')).slice(-3).join('\n'))"
```

Read `docs/collab/claims.md` §1 and §3 for any other branch holding a migration. Write down the last tag the journal names:
- `0014_…`: B has merged, and this task generates `0015`.
- `0012_site_3d_editor` or `0013_site_lines`: B (and perhaps #23) has not merged. Generate anyway. Drizzle-kit gives the next free number, and Task 10 regenerates it once the others have merged.

This is the one thing B's merge order changes.

- [ ] **Step 2: Write the failing test**

Create `src/lib/site/plan.underlay.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { seasons } from '@/db/schema/camp';
import { sitePlans, siteUnderlays } from '@/db/schema/site';
import { applySiteOps, copyPlan, createPlan, listItems, loadDoc, planForSeason, readUnderlay } from './plan';
import type { EditorItem, EditorUnderlay } from './editor/model';
import { underlayKey } from './underlay-limits';

const LEAD = 'lead@shliff.camp';
const OTHER_LEAD = 'other@shliff.camp';
const PLOT = { widthCm: 2600, depthCm: 2400, gridCm: 50 };
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

/** A picture uploaded to `planId`, where a new one lies: centred on the 26 × 24 m plot, as wide as it. */
function imageOn(planId: string, over: Partial<EditorUnderlay> = {}): EditorUnderlay {
  return {
    storageKey: underlayKey(planId, SHA_A, 'png'), contentType: 'image/png', sizeBytes: 812_345, filename: 'שרטוט המגרש.png',
    centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0, calibration: null, ...over,
  };
}

describe('site_underlays, the migration', () => {
  let db: TestDb;
  let planId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [season] = await db.insert(seasons).values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    planId = await createPlan(db, season.id, PLOT, LEAD);
  });

  it('holds one picture per plan, unturned unless told, and none once the plan is gone', async () => {
    const row = {
      planId, storageKey: underlayKey(planId, SHA_A, 'png'), contentType: 'image/png' as const, sizeBytes: 10,
      filename: 'a.png', centreXCm: 0, centreYCm: 0, widthCm: 100,
    };
    await db.insert(siteUnderlays).values(row);
    const [stored] = await db.select().from(siteUnderlays);
    expect(stored).toMatchObject({ rotationTenths: 0, calibration: null, uploadedBy: null, updatedBy: null });
    await expect(db.insert(siteUnderlays).values({ ...row, storageKey: underlayKey(planId, SHA_B, 'png') })).rejects.toThrow();
    await db.delete(sitePlans).where(eq(sitePlans.id, planId));
    expect(await db.select().from(siteUnderlays)).toEqual([]);
  });
});

describe('the picture under a map', () => {
  let db: TestDb;
  let s25: string;
  let s26: string;
  let planId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const rows = await db.insert(seasons).values([
      { name: 'ברן 25', year: 2025, flatRate: '1500.00' },
      { name: 'ברן 26', year: 2026, flatRate: '1200.00' },
    ]).returning();
    s25 = rows[0].id;
    s26 = rows[1].id;
    planId = await createPlan(db, s26, PLOT, LEAD);
  });

  it('is none on a new map, and the editor’s doc says so', async () => {
    expect(await readUnderlay(db, planId)).toBeNull();
    expect((await loadDoc(db, planId))?.doc.underlay).toBeNull();
  });

  it('goes on the map in a saved batch, and comes back with the map — turn, calibration and all', async () => {
    const image = imageOn(planId, { rotationTenths: 37, calibration: { from: [0.1234, 0.5], to: [0.9, 0.5], distanceCm: 2600 } });
    expect(await applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: image }], LEAD)).toEqual({ status: 'saved', version: 1 });
    const loaded = await loadDoc(db, planId);
    expect(loaded?.version).toBe(1);
    expect(loaded?.doc.underlay).toEqual(image);
  });

  it('moves, and comes off the map, a version each', async () => {
    await applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: imageOn(planId) }], LEAD);
    await applySiteOps(db, planId, 1, [{ type: 'setUnderlay', underlay: imageOn(planId, { centreXCm: 1500 }) }], LEAD);
    expect((await readUnderlay(db, planId))?.centreXCm).toBe(1500);
    expect(await applySiteOps(db, planId, 2, [{ type: 'setUnderlay', underlay: null }], LEAD)).toEqual({ status: 'saved', version: 3 });
    expect(await readUnderlay(db, planId)).toBeNull();
  });

  it('refuses a file uploaded to another map, and writes nothing', async () => {
    const other = await createPlan(db, s25, PLOT, LEAD);
    await expect(applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: imageOn(other) }], LEAD))
      .rejects.toThrow('an underlay file must be');
    expect(await readUnderlay(db, planId)).toBeNull();
    expect((await planForSeason(db, s26))?.version).toBe(0);
  });

  it('refuses a batch whole when the picture in it is malformed', async () => {
    const tent: EditorItem = {
      id: crypto.randomUUID(), kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 100, widthCm: 300, depthCm: 300,
      heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false,
    };
    await expect(applySiteOps(db, planId, 0, [
      { type: 'add', item: tent },
      { type: 'setUnderlay', underlay: imageOn(planId, { centreXCm: 12.5 }) },
    ], LEAD)).rejects.toThrow('an underlay placement must be');
    expect(await listItems(db, planId)).toEqual([]);
    expect((await planForSeason(db, s26))?.version).toBe(0);
  });

  it('answers a stale version with a conflict, as for items, and writes nothing', async () => {
    await applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: imageOn(planId) }], LEAD);
    expect(await applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: imageOn(planId, { widthCm: 900 }) }], OTHER_LEAD))
      .toEqual({ status: 'conflict', version: 1 });
    expect((await readUnderlay(db, planId))?.widthCm).toBe(2600);
  });

  it('says who uploaded the file, and changes that only when the file changes', async () => {
    await applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: imageOn(planId) }], LEAD);
    await applySiteOps(db, planId, 1, [{ type: 'setUnderlay', underlay: imageOn(planId, { rotationTenths: 900 }) }], OTHER_LEAD);
    let [row] = await db.select().from(siteUnderlays);
    expect(row).toMatchObject({ uploadedBy: LEAD, updatedBy: OTHER_LEAD, rotationTenths: 900 });
    const firstUpload = row.uploadedAt;

    await applySiteOps(db, planId, 2, [{
      type: 'setUnderlay',
      underlay: imageOn(planId, { storageKey: underlayKey(planId, SHA_B, 'jpg'), contentType: 'image/jpeg', filename: 'IMG_2231.jpg' }),
    }], OTHER_LEAD);
    [row] = await db.select().from(siteUnderlays);
    expect(row.uploadedBy).toBe(OTHER_LEAD);
    expect(row.uploadedAt.getTime()).toBeGreaterThanOrEqual(firstUpload.getTime());
  });

  it('keeps the file name trimmed', async () => {
    await applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: imageOn(planId, { filename: '  שרטוט.png ' }) }], LEAD);
    expect((await readUnderlay(db, planId))?.filename).toBe('שרטוט.png');
  });

  it('is not copied with last year’s map: last year’s sketch is not this year’s plot', async () => {
    await applySiteOps(db, planId, 0, [{ type: 'setUnderlay', underlay: imageOn(planId) }], LEAD);
    const [s27] = await db.insert(seasons).values({ name: 'ברן 27', year: 2027, flatRate: '1300.00' }).returning();
    const copied = await copyPlan(db, s26, s27.id, LEAD);
    expect(await readUnderlay(db, copied)).toBeNull();
    expect((await loadDoc(db, copied))?.doc.underlay).toBeNull();
    expect(await readUnderlay(db, planId)).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/lib/site/plan.underlay.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL, because `siteUnderlays` and `readUnderlay` are not exported.

- [ ] **Step 4: Add the table**

Read `src/db/schema/site.ts` with the Read tool. Change the import on lines 1–3 to:

```ts
import {
  pgTable, uuid, text, integer, timestamp, unique, boolean, jsonb,
} from 'drizzle-orm/pg-core';
```

At the end of the file, add:

```ts
/**
 * The picture under a season's map (spec §16–§17, migration `0015`): a photo
 * or a scan of the camp's sketch, traced over by hand. One per plan — the
 * plan's id is the key — and gone with the plan. `copyPlan` does not copy it:
 * last year's sketch is not this year's plot.
 *
 * The file is not here. It is in storage (`STORAGE_DRIVER`: private Vercel
 * Blob in production), at `site-underlays/<planId>/<sha256>.<ext>`
 * (`src/lib/site/underlay-limits.ts`), and only
 * `GET /site/underlay/<planId>/<file>` reads it back, to admins. This row says
 * which file and where it lies: the map length of its width, its middle, its
 * turn in tenths of a degree, and the two points and the distance it was
 * calibrated from — fractions of the picture as shown, null until
 * calibrated. How see-through it is, and whether it is shown, are each
 * viewer's own and never stored (D19).
 *
 * `uploaded_at` and `uploaded_by` change only when the file does: a move is
 * an update, a new picture is an upload.
 */
export const siteUnderlays = pgTable('site_underlays', {
  planId: uuid('plan_id').primaryKey()
    .references(() => sitePlans.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key').notNull(),
  contentType: text('content_type').$type<'image/png' | 'image/jpeg' | 'image/webp'>().notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  filename: text('filename').notNull(),
  centreXCm: integer('centre_x_cm').notNull(),
  centreYCm: integer('centre_y_cm').notNull(),
  widthCm: integer('width_cm').notNull(),
  rotationTenths: integer('rotation_tenths').notNull().default(0),
  /** `UnderlayCalibration` (`src/lib/site/underlay.ts`), written here so the schema imports nothing from `lib`. */
  calibration: jsonb('calibration').$type<{ from: [number, number]; to: [number, number]; distanceCm: number }>(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  uploadedBy: text('uploaded_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});
```

- [ ] **Step 5: Generate the migration, and read it**

```bash
npx drizzle-kit generate --name site_underlays
```

This is **never** `drizzle-kit push` or `drizzle-kit migrate` (`docs/deploy.md` §6: both are forbidden here). Expected: one new `drizzle/00NN_site_underlays.sql`, with `NN` as Step 1 predicted. Read it with the Read tool. It must hold exactly these two statements:

```sql
CREATE TABLE "site_underlays" (
	"plan_id" uuid PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"filename" text NOT NULL,
	"centre_x_cm" integer NOT NULL,
	"centre_y_cm" integer NOT NULL,
	"width_cm" integer NOT NULL,
	"rotation_tenths" integer DEFAULT 0 NOT NULL,
	"calibration" jsonb,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "site_underlays" ADD CONSTRAINT "site_underlays_plan_id_site_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."site_plans"("id") ON DELETE cascade ON UPDATE no action;
```

Anything else in it means the base holds a schema change without its migration. A statement about another table is the sign. Stop and report; do not edit the file by hand. Then count, with a tool the RTK hook cannot touch:

```bash
node -e "const fs=require('fs');const sql=fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql'));console.log(sql.length, sql.slice(-2).join(' '))"
node -e "const fs=require('fs');console.log(fs.readdirSync('drizzle/meta').filter(f=>f.endsWith('_snapshot.json')).length, require('./drizzle/meta/_journal.json').entries.length)"
```

Expected: the first line prints one more `.sql` file than before, ending in `…_site_underlays.sql`. The second prints two equal numbers. Take each count twice (`CLAUDE.md`: counts here have come back inflated).

- [ ] **Step 6: Read and write the picture in `plan.ts`**

Read `src/lib/site/plan.ts` with the Read tool.

1. Replace `import { siteItems, siteKindDefaults, sitePlans, type SiteItemKind } from '@/db/schema/site';` with:

```ts
import { siteItems, siteKindDefaults, sitePlans, siteUnderlays, type SiteItemKind } from '@/db/schema/site';
```

2. Replace `import type { EditorDoc, EditorItem } from './editor/model';` with:

```ts
import type { EditorDoc, EditorItem, EditorUnderlay } from './editor/model';
import { underlayKeyPlan } from './underlay-limits';
```

3. After `kindDefaults`, add:

```ts
/** The picture under a map, or null (spec §17). Only its file and where it lies — never how a viewer sees it. */
export async function readUnderlay(db: AnyDb, planId: string): Promise<EditorUnderlay | null> {
  const [row] = await db.select().from(siteUnderlays).where(eq(siteUnderlays.planId, planId)).limit(1);
  if (row === undefined) return null;
  return {
    storageKey: row.storageKey,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    filename: row.filename,
    centreXCm: row.centreXCm,
    centreYCm: row.centreYCm,
    widthCm: row.widthCm,
    rotationTenths: row.rotationTenths,
    calibration: row.calibration ?? null,
  };
}
```

4. In `loadDoc`, replace:

```ts
  const items = await listItems(db, planId);
  const defaults = await kindDefaults(db);
  return {
    version: plan.version,
    doc: {
      plot: { id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm, northDeg: plan.northDeg },
      items: items.map(toEditorItem),
      defaults,
    },
  };
```

with:

```ts
  const items = await listItems(db, planId);
  const defaults = await kindDefaults(db);
  const underlay = await readUnderlay(db, planId);
  return {
    version: plan.version,
    doc: {
      plot: { id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm, northDeg: plan.northDeg },
      items: items.map(toEditorItem),
      defaults,
      underlay,
    },
  };
```

5. Before `export type ApplyResult`, add:

```ts
/**
 * The picture's row, written inside `applySiteOps`' transaction (spec §17).
 * Only a file uploaded to this map may lie under it: a key is a path in
 * storage, and another map's path would be served under this map's name. An
 * upload is a new file; anything else is a move, and keeps who uploaded it
 * and when.
 */
async function writeUnderlay(tx: AnyDb, planId: string, underlay: EditorUnderlay | null, actor: string): Promise<void> {
  if (underlay === null) {
    await tx.delete(siteUnderlays).where(eq(siteUnderlays.planId, planId));
    return;
  }
  if (underlayKeyPlan(underlay.storageKey) !== planId.toLowerCase()) {
    throw new Error('an underlay file must be one uploaded to this map');
  }
  const values = {
    storageKey: underlay.storageKey,
    contentType: underlay.contentType,
    sizeBytes: underlay.sizeBytes,
    filename: underlay.filename.trim(),
    centreXCm: underlay.centreXCm,
    centreYCm: underlay.centreYCm,
    widthCm: underlay.widthCm,
    rotationTenths: underlay.rotationTenths,
    calibration: underlay.calibration,
    updatedAt: new Date(),
    updatedBy: actor,
  };
  const [existing] = await tx.select({ storageKey: siteUnderlays.storageKey })
    .from(siteUnderlays).where(eq(siteUnderlays.planId, planId)).limit(1);
  if (existing === undefined) {
    await tx.insert(siteUnderlays).values({ planId, ...values, uploadedBy: actor });
    return;
  }
  const uploaded = existing.storageKey === underlay.storageKey ? {} : { uploadedAt: new Date(), uploadedBy: actor };
  await tx.update(siteUnderlays).set({ ...values, ...uploaded }).where(eq(siteUnderlays.planId, planId));
}
```

6. In `applySiteOps`, replace the placeholder branch Task 3 left:

```ts
      } else {
        // `setUnderlay`: written from Task 4 of the Part C plan on, when its table exists. No client sends one before.
        throw new Error('unknown operation');
      }
```

with:

```ts
      } else {
        await writeUnderlay(tx, planId, op.underlay, actor);
      }
```

and add one sentence to `applySiteOps`' docblock, after "…the item is not locked.": "A picture under the map must be a file uploaded to this map (`writeUnderlay`)."

`copyPlan` is not changed: it copies the plot and the items only, so the picture stays behind (spec §16). The test above proves it.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lib/site/plan.underlay.test.ts src/lib/site/plan.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: exit 0, 0 failed. `plan.underlay.test.ts` gives 10 passed, and `plan.test.ts` is unchanged and still green.

Then prove the other-plan refusal can fail. In `writeUnderlay`, temporarily change `!== planId.toLowerCase()` to `=== null` and re-run `plan.underlay.test.ts`. Expected: "refuses a file uploaded to another map…" fails. Restore it: 10 passed.

- [ ] **Step 8: Typecheck, lint, commit**

Run: `npx tsc --noEmit`. Expected: exit 0.
Run: `rtk proxy npx eslint src/db/schema/site.ts src/lib/site/plan.ts src/lib/site/plan.underlay.test.ts`. Expected: no problems.

```bash
git add src/db/schema/site.ts src/lib/site/plan.ts src/lib/site/plan.underlay.test.ts drizzle/meta/_journal.json
git add drizzle/*_site_underlays.sql drizzle/meta/*_snapshot.json
/usr/bin/git status --short drizzle/
```

The `git status` line must show exactly one new `.sql`, one new snapshot and the modified journal, all staged. Anything else under `drizzle/` staged means a snapshot that was not yours: unstage it with `git restore --staged <path>`.

```bash
git commit -m "feat(site): site_underlays — one picture per map, read with the map and written in its versioned batch

Migration generated with drizzle-kit generate; not applied anywhere. The camp
lead applies it to Railway by hand (docs/deploy.md §6) before this deploys.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The routes — `POST` stores a picture, `GET` serves it to admins only

**Files:**
- Create: `src/app/(admin)/site/underlay/[planId]/route.ts`, `src/app/(admin)/site/underlay/[planId]/route.test.ts`
- Create: `src/app/(admin)/site/underlay/[planId]/[file]/route.ts`, `src/app/(admin)/site/underlay/[planId]/[file]/route.test.ts`

**Interfaces:**
- Consumes:
  - `requireAdmin`, `AdminCheck` (`@/lib/auth/guard`);
  - `getStorage`, `sha256Hex`, `Storage` (`@/lib/storage`, unchanged);
  - `planById` (`@/lib/site/plan`);
  - `checkUnderlayFile` (Task 1);
  - `MAX_UNDERLAY_BYTES`, `isPlanId`, `underlayKey`, `UNDERLAY_FILE`, `UNDERLAY_PREFIX`, `contentTypeOf`, `UnderlayUploadCode` (Task 1);
  - `config` (`@/proxy`, in a test only).
- Produces (spec §16):
  - `POST /site/underlay/<planId>`, with a multipart field `file`. It answers `201 { storageKey, contentType, sizeBytes, filename }`, or `{ error: <code> }` with 401, 404, 400, 413, 415, 422 or 503. It writes nothing to the database.
  - `GET /site/underlay/<planId>/<sha256>.<ext>`. It answers 200 with the bytes and the headers `Content-Type`, `Cache-Control: private, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff`. Otherwise it answers 401 or 404 with an empty body.

Why a route and not a server action (spec §16): server actions take 1 MB bodies by default (`serverActions.bodySizeLimit`, `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`), and raising that means editing the shared `next.config.ts`.

- [ ] **Step 1: Read the route-handler conventions this Next uses**

Read, with the Read tool: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`. Two things to confirm:
- The second argument is `{ params: Promise<{ … }> }`, and `params` is awaited.
- A `GET` handler is dynamic by default since v15.

Also read `src/app/api/uploads/route.ts` and its test (the pattern copied here), `src/proxy.ts` (the matcher's image exemption), and `src/app/admin-guard.test.ts` (every exported function in a `route.ts` under `(admin)` must call `requireAdmin(` in its own body).

- [ ] **Step 2: Write the failing upload-route test**

Create `src/app/(admin)/site/underlay/[planId]/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, type TestDb } from '@/test/db';
import { seasons } from '@/db/schema/camp';
import { siteUnderlays } from '@/db/schema/site';
import { createPlan, planById } from '@/lib/site/plan';
import { MAX_UNDERLAY_BYTES } from '@/lib/site/underlay-limits';
import type { AdminCheck } from '@/lib/auth/guard';
import type { Storage } from '@/lib/storage';

/**
 * The route imports `@/db` and `@/lib/auth/guard` at module scope; `@/db`
 * throws without `DATABASE_URL`, and the guard reaches NextAuth. Both are
 * replaced before the route is imported, as `/api/uploads`' test does. The
 * database stand-in is a proxy onto whichever PGlite the current test built.
 *
 * Storage is the real local driver in a temporary directory, except where a
 * test swaps in a store that behaves as Vercel Blob does
 * (`storageRef.current`).
 */
const { dbRef, adminRef, dbProxy, storageRef } = vi.hoisted(() => {
  const dbRef: { current: TestDb | null } = { current: null };
  const adminRef: { current: AdminCheck } = { current: { ok: true, email: 'admin@example.com' } };
  const storageRef: { current: Storage | null } = { current: null };
  const dbProxy = new Proxy({} as TestDb, {
    get(_target, property) {
      const db = dbRef.current;
      if (!db) throw new Error('test database not initialised');
      const value = Reflect.get(db, property) as unknown;
      return typeof value === 'function' ? value.bind(db) : value;
    },
  });
  return { dbRef, adminRef, dbProxy, storageRef };
});

vi.mock('@/db', () => ({ db: dbProxy }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => adminRef.current }));
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return { ...actual, getStorage: () => storageRef.current ?? actual.getStorage() };
});

import { POST } from './route';
import { sha256Hex } from '@/lib/storage';

function bytes(...parts: Array<number[] | string>): number[] {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (let i = 0; i < part.length; i += 1) out.push(part.charCodeAt(i));
    else out.push(...part);
  }
  return out;
}
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** A PNG header, zero-padded: the route reads headers, never pixels. */
function png(width: number, height: number, padTo = 64): Uint8Array {
  const header = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(width), be32(height), [8, 6, 0, 0, 0]);
  const out = new Uint8Array(Math.max(padTo, header.length));
  out.set(header);
  return out;
}
const PDF = Uint8Array.from(bytes('%PDF-1.7\n'));
const HEIC = Uint8Array.from(bytes(be32(24), 'ftyp', 'heic', be32(0), 'mif1', 'heic'));
const GIF = Uint8Array.from(bytes('GIF89a', [0x40, 0x01, 0xc8, 0x00]));

function send(planId: string, file: File | null) {
  const form = new FormData();
  if (file !== null) form.set('file', file);
  return POST(
    new Request(`http://localhost/site/underlay/${planId}`, { method: 'POST', body: form }),
    { params: Promise.resolve({ planId }) },
  );
}
const upload = (planId: string, name: string, data: Uint8Array) => send(planId, new File([data], name));

describe('POST /site/underlay/<planId>', () => {
  let storageDir: string;
  let planId: string;

  beforeEach(async () => {
    dbRef.current = await createTestDb();
    adminRef.current = { ok: true, email: 'admin@example.com' };
    storageRef.current = null;
    storageDir = mkdtempSync(join(tmpdir(), 'shliff-underlay-'));
    process.env.STORAGE_DRIVER = 'local';
    process.env.LOCAL_STORAGE_DIR = storageDir;
    const [season] = await dbRef.current.insert(seasons).values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    planId = await createPlan(dbRef.current, season.id, { widthCm: 2600, depthCm: 2400, gridCm: 50 }, 'lead@shliff.camp');
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('refuses a request without an admin session with 401, and stores nothing', async () => {
    adminRef.current = { ok: false };
    const response = await upload(planId, 'sketch.png', png(1600, 1200));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(readdirSync(storageDir)).toEqual([]);
  });

  it('answers 404 for a map that is not there, or a plan id that is not one', async () => {
    for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-plan', '..']) {
      const response = await upload(id, 'sketch.png', png(1600, 1200));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'unknown plan' });
    }
    expect(readdirSync(storageDir)).toEqual([]);
  });

  it('answers 400 when no file came, or the body is not a form at all', async () => {
    const none = await send(planId, null);
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: 'missing file' });
    const text = await POST(
      new Request(`http://localhost/site/underlay/${planId}`, { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } }),
      { params: Promise.resolve({ planId }) },
    );
    expect(text.status).toBe(400);
    expect(await text.json()).toEqual({ error: 'missing file' });
  });

  it('takes exactly 4 MB and refuses one byte more with 413', async () => {
    expect((await upload(planId, 'big.png', png(1600, 1200, MAX_UNDERLAY_BYTES))).status).toBe(201);
    const over = await upload(planId, 'bigger.png', png(1600, 1200, MAX_UNDERLAY_BYTES + 1));
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: 'file too large' });
  });

  it('refuses a PDF, an iPhone photo and anything else with 415, each with its own code', async () => {
    for (const [name, data, code] of [
      ['plan.pdf', PDF, 'pdf'],
      ['IMG_0001.HEIC', HEIC, 'heic'],
      ['anim.gif', GIF, 'unsupported file type'],
      ['sketch.jpg', png(400, 300), 'unsupported file type'],
    ] as const) {
      const response = await upload(planId, name, data);
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: code });
    }
    expect(readdirSync(storageDir)).toEqual([]);
  });

  it('refuses under 100 or over 8192 pixels a side with 422', async () => {
    const small = await upload(planId, 'a.png', png(99, 300));
    expect(small.status).toBe(422);
    expect(await small.json()).toEqual({ error: 'image too small' });
    const large = await upload(planId, 'a.png', png(9000, 300));
    expect(large.status).toBe(422);
    expect(await large.json()).toEqual({ error: 'image too large' });
  });

  it('stores the picture under its map and its own hash, answers what the editor saves, and writes nothing to the database', async () => {
    const data = png(1600, 1200);
    const response = await upload(planId, ' שרטוט.png ', data);
    expect(response.status).toBe(201);
    const body = await response.json();
    const sha = sha256Hex(Buffer.from(data));
    expect(body).toEqual({
      storageKey: `site-underlays/${planId}/${sha}.png`, contentType: 'image/png', sizeBytes: data.byteLength, filename: 'שרטוט.png',
    });
    expect(readFileSync(join(storageDir, body.storageKey as string))).toEqual(Buffer.from(data));
    // Where it lies is the editor's op to save, against the map's version (spec §17).
    expect(await dbRef.current!.select().from(siteUnderlays)).toEqual([]);
    expect((await planById(dbRef.current!, planId))?.version).toBe(0);
  });

  it('answers the same key for the same bytes, however often they come', async () => {
    const data = png(1600, 1200);
    const first = await (await upload(planId, 'a.png', data)).json();
    const second = await upload(planId, 'b.png', data);
    expect(second.status).toBe(201);
    expect((await second.json()).storageKey).toBe(first.storageKey);
  });

  it('answers 201 when storage refuses to overwrite a file it already holds (Review Focus #2)', async () => {
    // @vercel/blob 2.8's put() throws when the pathname exists (allowOverwrite defaults to false), and the key is the
    // content's hash, so the same picture uploaded again always meets its own earlier copy.
    const data = png(1600, 1200);
    const put = vi.fn(async () => { throw new Error('Vercel Blob: This blob already exists'); });
    const get = vi.fn(async () => Buffer.from(data));
    storageRef.current = { put, get };
    const response = await upload(planId, 'sketch.png', data);
    expect(response.status).toBe(201);
    const { storageKey } = await response.json();
    expect(get).toHaveBeenCalledWith(storageKey);

    // A write that failed for any other reason cannot read the file back: that is storage being down.
    storageRef.current = { put, get: vi.fn(async () => { throw new Error('blob store unreachable'); }) };
    const down = await upload(planId, 'sketch.png', data);
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: 'storage unavailable' });
  });

  it('answers a machine code, not an error page, when production has no storage driver', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STORAGE_DRIVER', '');
    const response = await upload(planId, 'sketch.png', png(1600, 1200));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'storage unavailable' });
  });

  it('takes every limit from the shared modules, and declares none of its own', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/(admin)/site/underlay/[planId]/route.ts'), 'utf8');
    expect(source).toContain("from '@/lib/site/underlay-limits'");
    expect(source).toContain("from '@/lib/site/underlay-file'");
    expect(source).not.toMatch(/const [A-Z_]*(BYTES|PX|MB)\s*=/);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run "src/app/(admin)/site/underlay/[planId]/route.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL, because `./route` cannot be resolved.

- [ ] **Step 4: Write the upload route**

Create `src/app/(admin)/site/underlay/[planId]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { getStorage, sha256Hex } from '@/lib/storage';
import { planById } from '@/lib/site/plan';
import { checkUnderlayFile } from '@/lib/site/underlay-file';
import { MAX_UNDERLAY_BYTES, isPlanId, underlayKey, type UnderlayUploadCode } from '@/lib/site/underlay-limits';

/**
 * `POST /site/underlay/<planId>`: stores a picture to trace over (spec §16).
 * It checks, in order: an admin, the map, a file, its size, its type from
 * both its bytes and its name, and its size in pixels. It answers 201 with
 * what the editor saves, or a machine code the card turns into Hebrew
 * (`uploadRefusalHe`).
 *
 * Nothing here may throw. An unhandled throw leaves as an HTML error page,
 * the card's `response.json()` fails too, and the lead is left with nothing
 * on screen (the same contract as `/api/uploads`).
 *
 * The route writes nothing to the database. Where the picture lies is the
 * editor's `setUnderlay` op, saved in a batch against the map's version, so
 * two leads uploading at once meet the conflict banner, not an overwrite.
 *
 * Why a route and not a server action: server actions accept 1 MB bodies by
 * default (`serverActions.bodySizeLimit`), and raising that means editing the
 * shared `next.config.ts`.
 */

function refuse(code: UnderlayUploadCode, status: number): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

export async function POST(
  request: Request, context: { params: Promise<{ planId: string }> },
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return refuse('unauthorized', 401);

  // Lower case, as Postgres writes a uuid, so one map has one folder; and never a path that could climb out of it.
  const planId = (await context.params).planId.toLowerCase();
  if (!isPlanId(planId)) return refuse('unknown plan', 404);
  try {
    if ((await planById(db, planId)) === null) return refuse('unknown plan', 404);
  } catch {
    return refuse('storage unavailable', 503);
  }

  let file: FormDataEntryValue | null = null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    file = null;
  }
  if (!(file instanceof File)) return refuse('missing file', 400);
  // Before reading it: a body this size is refused without holding it twice.
  if (file.size > MAX_UNDERLAY_BYTES) return refuse('file too large', 413);

  const bytes = Buffer.from(await file.arrayBuffer());
  const check = checkUnderlayFile(file.name, bytes);
  if (!check.ok) return refuse(check.code, check.status);

  const storageKey = underlayKey(planId, sha256Hex(bytes), check.ext);
  if (!(await store(storageKey, bytes))) return refuse('storage unavailable', 503);

  return NextResponse.json(
    { storageKey, contentType: check.contentType, sizeBytes: bytes.byteLength, filename: file.name.trim() },
    { status: 201 },
  );
}

/**
 * Writes the file, or finds it already there. The key is the file's own
 * hash, so the same bytes always land on the same key: a second upload, or
 * the old picture uploaded again after a replace (spec §16). The local driver
 * overwrites. Vercel Blob refuses to — `put` throws when the pathname exists
 * (`allowOverwrite` defaults to false in `@vercel/blob` 2.x), and
 * `src/lib/storage` is not changed here — so a refused write whose key reads
 * back is a file already stored, not a failure (Review Focus #2).
 *
 * `getStorage()` itself may throw, when production has no driver named; that
 * is caught here too, and is storage being unavailable.
 */
async function store(key: string, bytes: Buffer): Promise<boolean> {
  try {
    await getStorage().put(key, bytes);
    return true;
  } catch {
    try {
      await getStorage().get(key);
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 5: Run the upload-route test**

Run the Step 3 command. Expected: 11 passed, exit 0.

Then prove Review Focus #2's test can fail. In `store`, temporarily replace the inner `try { await getStorage().get(key); return true; } catch { return false; }` with `return false;` and re-run. Expected: "answers 201 when storage refuses to overwrite…" fails with 503. Restore it: 11 passed.

- [ ] **Step 6: Write the failing image-route test**

Create `src/app/(admin)/site/underlay/[planId]/[file]/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import type { AdminCheck } from '@/lib/auth/guard';
import type { Storage } from '@/lib/storage';

const { adminRef, storageRef } = vi.hoisted(() => ({
  adminRef: { current: { ok: true, email: 'admin@example.com' } as AdminCheck },
  storageRef: { current: null as Storage | null },
}));

vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => adminRef.current }));
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return { ...actual, getStorage: () => storageRef.current ?? actual.getStorage() };
});

import { config } from '@/proxy';
import { getStorage } from '@/lib/storage';
import { GET } from './route';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const OTHER = '5e1d2c3b-4a59-4876-9e0f-a1b2c3d4e5f6';
const SHA = 'c'.repeat(64);
const BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const ask = (planId: string, file: string) =>
  GET(new Request(`http://localhost/site/underlay/${planId}/${file}`), { params: Promise.resolve({ planId, file }) });

/** A store that answers every read, and remembers what it was asked. */
function watchedStore(): { store: Storage; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn(async () => BYTES);
  return { store: { put: vi.fn(async (key: string) => key), get }, get };
}

describe('GET /site/underlay/<planId>/<file>', () => {
  let storageDir: string;

  beforeEach(() => {
    adminRef.current = { ok: true, email: 'admin@example.com' };
    storageRef.current = null;
    storageDir = mkdtempSync(join(tmpdir(), 'shliff-underlay-get-'));
    process.env.STORAGE_DRIVER = 'local';
    process.env.LOCAL_STORAGE_DIR = storageDir;
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('serves the picture to an admin with its type, a year of private caching and no sniffing', async () => {
    await getStorage().put(`site-underlays/${PLAN}/${SHA}.png`, BYTES);
    const response = await ask(PLAN, `${SHA}.png`);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BYTES);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('names the type by the stored extension', async () => {
    await getStorage().put(`site-underlays/${PLAN}/${SHA}.jpg`, BYTES);
    await getStorage().put(`site-underlays/${PLAN}/${SHA}.webp`, BYTES);
    expect((await ask(PLAN, `${SHA}.jpg`)).headers.get('Content-Type')).toBe('image/jpeg');
    expect((await ask(PLAN, `${SHA}.webp`)).headers.get('Content-Type')).toBe('image/webp');
  });

  it('is not gated by the proxy, so it gates itself: 401 without an admin session, and storage is never asked (Review Focus #4)', async () => {
    // The proxy lets every path ending in an image extension through unauthenticated (`src/proxy.ts`, for public/).
    // This route's own requireAdmin is the only thing between these bytes and anyone with the URL.
    expect(unstable_doesMiddlewareMatch({ config, url: `/site/underlay/${PLAN}/${SHA}.png` })).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, url: `/site/underlay/${PLAN}` })).toBe(true);

    const watched = watchedStore();
    storageRef.current = watched.store;
    adminRef.current = { ok: false };
    const response = await ask(PLAN, `${SHA}.png`);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    expect(watched.get).not.toHaveBeenCalled();
  });

  it('never asks storage for a name outside the pattern, or for a plan that is not a plan id (Review Focus #4)', async () => {
    const watched = watchedStore();
    storageRef.current = watched.store;
    for (const [planId, file] of [
      [PLAN, 'x.png'], [PLAN, `${SHA}.gif`], [PLAN, `${SHA}.PNG`], [PLAN, `${SHA}.png.json`], [PLAN, `${SHA}.jpeg`],
      ['..', `${SHA}.png`], ['not-a-plan', `${SHA}.png`], [`${PLAN}/..`, `${SHA}.png`],
    ]) {
      expect((await ask(planId, file)).status).toBe(404);
    }
    expect(watched.get).not.toHaveBeenCalled();
  });

  it('answers 404 for a file that is not there, and for one that belongs to another map', async () => {
    expect((await ask(PLAN, `${SHA}.png`)).status).toBe(404);
    await getStorage().put(`site-underlays/${OTHER}/${SHA}.png`, BYTES);
    expect((await ask(PLAN, `${SHA}.png`)).status).toBe(404);
    expect((await ask(OTHER, `${SHA}.png`)).status).toBe(200);
  });
});
```

- [ ] **Step 7: Run it to see it fail**

Run: `npx vitest run "src/app/(admin)/site/underlay/[planId]/[file]/route.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL, because `./route` cannot be resolved.

- [ ] **Step 8: Write the image route**

Create `src/app/(admin)/site/underlay/[planId]/[file]/route.ts`:

```ts
import { requireAdmin } from '@/lib/auth/guard';
import { getStorage } from '@/lib/storage';
import { UNDERLAY_FILE, UNDERLAY_PREFIX, contentTypeOf, isPlanId } from '@/lib/site/underlay-limits';

/**
 * `GET /site/underlay/<planId>/<sha256>.<ext>`: the picture under a map, to
 * admins only (spec §16).
 *
 * This route's own `requireAdmin` is the only gate in front of the bytes.
 * The proxy (`src/proxy.ts`) lets every path that ends in an image extension
 * through without a session — it has to, for `public/` — so it never runs
 * here. The name must be a hash with one of three extensions and the plan a
 * lower-case uuid, so nothing outside `site-underlays/<planId>/` is ever
 * asked of storage.
 *
 * The name is the content's hash, so the answer never changes: it is cached
 * for a year, privately, and the type comes from the extension with sniffing
 * off. It is never more than 4 MB, the upload's own cap, and so under
 * Vercel's 4.5 MB response limit.
 */
export async function GET(
  _request: Request, context: { params: Promise<{ planId: string; file: string }> },
): Promise<Response> {
  const admin = await requireAdmin();
  if (!admin.ok) return new Response(null, { status: 401 });

  const { planId: asked, file } = await context.params;
  const planId = asked.toLowerCase();
  const contentType = contentTypeOf(file);
  if (!isPlanId(planId) || !UNDERLAY_FILE.test(file) || contentType === null) {
    return new Response(null, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await getStorage().get(`${UNDERLAY_PREFIX}/${planId}/${file}`);
  } catch {
    return new Response(null, { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
```

- [ ] **Step 9: Run both route tests and the repo-wide nets**

Run: `npx vitest run "src/app/(admin)/site/underlay" src/app/admin-guard.test.ts "src/app/(admin)/route-modules.test.ts" src/proxy.test.ts --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`

Expected: exit 0, 0 failed.
- The two route files: 11 + 5 passed.
- `admin-guard.test.ts` now lists `src/app/(admin)/site/underlay/[planId]/route.ts → POST` and `…/[file]/route.ts → GET`, both guarded.
- `route-modules.test.ts` finds no filesystem import in either route file.

Then prove Review Focus #4's test can fail. Temporarily move the `const admin = await requireAdmin(); if (!admin.ok) …` lines of the `GET` handler below the `getStorage().get` call, and re-run the image-route test. Expected: "is not gated by the proxy…" fails, because storage was asked. Restore them.

- [ ] **Step 10: Typecheck, lint, commit**

Run: `npx tsc --noEmit`. Expected: exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/underlay"`. Expected: no problems.

```bash
git add "src/app/(admin)/site/underlay/[planId]/route.ts" "src/app/(admin)/site/underlay/[planId]/route.test.ts" "src/app/(admin)/site/underlay/[planId]/[file]/route.ts" "src/app/(admin)/site/underlay/[planId]/[file]/route.test.ts"
git commit -m "feat(site): the image routes — POST stores a checked picture under its hash, GET serves it to admins only

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `underlay-mesh.ts` — the picture as a plane in the scene, and its upkeep

**Files:**
- Create: `src/app/(admin)/site/editor/scene/underlay-mesh.ts`, `src/app/(admin)/site/editor/scene/underlay-mesh.test.ts`

**Interfaces:**
- Consumes:
  - `CM`, `worldOf`, `disposeObject`, `buildGround`, `buildItemObject` (`scene/meshes.ts`, unchanged; the last two only in the test);
  - `UnderlayPlacement`, `imageToMap` (`underlay.ts`, Task 2);
  - `imageFacts`, `displaySize` (Task 1).
- Produces:
  - constants: `UNDERLAY_RENDER_ORDER = -3.5`, `UNDERLAY_LIFT_CM = 0.1`;
  - types: `UnderlayStatus = { state: 'none' } | { state: 'loading' } | { state: 'ready'; aspect: number } | { state: 'failed' } | { state: 'missing' }`; `UnderlayEvent = { type: 'status'; status } | { type: 'point'; uv: [number, number] } | { type: 'offImage' } | { type: 'tooClose' }`; `DecodedUnderlay { source: ImageBitmap; width; height; close(): void }`; `UnderlayLoader = (url, maxSide) => Promise<DecodedUnderlay | 'missing'>`;
  - functions: `loadUnderlayImage: UnderlayLoader`; `buildUnderlayPlane(image): THREE.Mesh` (named `underlayPlane`); `placeUnderlayPlane(mesh, placement, view: { shown; opacity }): void`;
  - `class UnderlayLayer { constructor({ load, maxSide, onStatus, onLoaded }); readonly root: THREE.Group /* 'underlay' */; readonly aspect: number | null; sync({ url, placement, shown, opacity }): void; retry(): void; rebuild(): void; dispose(): void }`.

Draw order is the one design decision here, and the test pins it. three draws **every opaque object before any transparent one**, whatever their `renderOrder`. The plot, the grid, the fence and the drawn shade patches are all opaque. So a plane marked `transparent` would be drawn after all of them and cover the grid and the fence, which is not spec §19's order. This plane stays in the opaque pass and blends by itself (`CustomBlending`). three keeps its opacity in the shader because the `OPAQUE` define is only set for `NormalBlending`. `meshes.ts` is not changed.

- [ ] **Step 1: Write the failing test**

Create `src/app/(admin)/site/editor/scene/underlay-mesh.test.ts`. It runs in Node with no GPU: three builds meshes and textures without a renderer. `fetch` and `createImageBitmap` are stood in for with `vi.stubGlobal`.

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import type { EditorItem } from '@/lib/site/editor/model';
import { imageToMap, type UnderlayPlacement } from '@/lib/site/underlay';
import { buildGround, buildItemObject } from './meshes';
import {
  UNDERLAY_LIFT_CM, UNDERLAY_RENDER_ORDER, UnderlayLayer, buildUnderlayPlane, loadUnderlayImage, placeUnderlayPlane,
  type DecodedUnderlay, type UnderlayLoader, type UnderlayStatus,
} from './underlay-mesh';

type Picture = DecodedUnderlay & { close: ReturnType<typeof vi.fn> };

/** A decoded picture, as `createImageBitmap` would give it: three only reads its size here. */
function picture(width: number, height: number): Picture {
  return { source: { width, height } as unknown as ImageBitmap, width, height, close: vi.fn() };
}

const P: UnderlayPlacement = { centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0 };
const VIEW = { shown: true, opacity: 0.5 };

/** Where the plane's vertex with this uv lands on the map, in centimetres (three x is east, three z is south). */
function cornerOnMap(mesh: THREE.Mesh, u: number, v: number): [number, number] {
  mesh.updateMatrixWorld(true);
  const uv = mesh.geometry.getAttribute('uv');
  const position = mesh.geometry.getAttribute('position');
  for (let i = 0; i < uv.count; i += 1) {
    if (uv.getX(i) === u && uv.getY(i) === v) {
      const world = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      return [world.x / 0.01, world.z / 0.01];
    }
  }
  throw new Error(`no vertex at uv ${u},${v}`);
}

const planeOf = (layer: UnderlayLayer) => layer.root.getObjectByName('underlayPlane') as THREE.Mesh | undefined;
const settle = () => new Promise<void>((done) => { setTimeout(done, 0); });

function setup(load: UnderlayLoader) {
  const statuses: UnderlayStatus[] = [];
  const onLoaded = vi.fn();
  const maxSide = vi.fn(() => 4096);
  const layer = new UnderlayLayer({ load, maxSide, onStatus: (status) => { statuses.push(status); }, onLoaded });
  return { layer, statuses, onLoaded, maxSide };
}

/** A load the test answers when it chooses. */
function deferred() {
  let resolve!: (value: DecodedUnderlay | 'missing') => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<DecodedUnderlay | 'missing'>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the picture’s plane', () => {
  it('sits in three’s opaque pass between the plot and the shade patches, blends by itself, writes no depth and takes no click', () => {
    const mesh = buildUnderlayPlane(picture(400, 300));
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(mesh.name).toBe('underlayPlane');
    expect(mesh.renderOrder).toBe(UNDERLAY_RENDER_ORDER);
    expect(UNDERLAY_RENDER_ORDER).toBe(-3.5);
    expect(material.transparent).toBe(false);
    expect(material.blending).toBe(THREE.CustomBlending);
    expect([material.blendSrc, material.blendDst, material.blendEquation])
      .toEqual([THREE.SrcAlphaFactor, THREE.OneMinusSrcAlphaFactor, THREE.AddEquation]);
    expect(material.depthWrite).toBe(false);
    expect(mesh.userData.pick).toBe(false);

    // What it must sit between is in the same (opaque) pass, so render order alone decides.
    const ground = buildGround({ id: 'p', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, 'light');
    const layer = (name: string) => ground.getObjectByName(name) as THREE.Mesh;
    expect(layer('plot').renderOrder).toBeLessThan(UNDERLAY_RENDER_ORDER);
    for (const name of ['gridMinor', 'gridMajor', 'fence']) {
      expect(layer(name).renderOrder).toBeGreaterThan(UNDERLAY_RENDER_ORDER);
      expect((layer(name).material as THREE.Material).transparent).toBe(false);
    }
    const net: EditorItem = {
      id: 'n', kind: 'shade', label: 'רשת צל 1', xCm: 0, yCm: 0, widthCm: 800, depthCm: 800,
      heightCm: null, insetCm: 50, sort: 0, taskId: null, notes: null, locked: false,
    };
    let patch: THREE.Mesh | undefined;
    buildItemObject(net, 300, { theme: 'light', state: 'normal', issue: 'none' }).traverse((child) => {
      if (child.userData.part === 'patch') patch = child as THREE.Mesh;
    });
    expect(patch!.renderOrder).toBeGreaterThan(UNDERLAY_RENDER_ORDER);
    expect((patch!.material as THREE.Material).transparent).toBe(false);
  });

  it('draws the picture’s top-left at the north-west and its top-right at the north-east — never mirrored — where the maths puts them', () => {
    const mesh = buildUnderlayPlane(picture(400, 300));
    for (const placement of [P, { ...P, rotationTenths: 300 }, { centreXCm: -250, centreYCm: 4000, widthCm: 777, rotationTenths: 2700 }]) {
      placeUnderlayPlane(mesh, placement, VIEW);
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const [x, y] = cornerOnMap(mesh, u, v);
        const [ex, ey] = imageToMap(placement, 0.75, [u, v]);
        expect(x).toBeCloseTo(ex, 3);
        expect(y).toBeCloseTo(ey, 3);
      }
    }
    placeUnderlayPlane(mesh, P, VIEW);
    const [westX, northY] = cornerOnMap(mesh, 0, 0);
    expect(westX).toBeCloseTo(0, 3);
    expect(northY).toBeCloseTo(225, 3);
    expect(mesh.position.y).toBeCloseTo(UNDERLAY_LIFT_CM * 0.01, 9);
    const texture = (mesh.material as THREE.MeshBasicMaterial).map!;
    expect(texture.flipY).toBe(false);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('is shown or hidden, and as see-through as this viewer chose', () => {
    const mesh = buildUnderlayPlane(picture(400, 300));
    placeUnderlayPlane(mesh, P, { shown: false, opacity: 0.3 });
    expect(mesh.visible).toBe(false);
    expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.3, 9);
    placeUnderlayPlane(mesh, P, VIEW);
    expect(mesh.visible).toBe(true);
  });
});

describe('the picture layer', () => {
  it('loads the picture when the map gets one, and takes the aspect from the decoded picture (Review Focus #1)', async () => {
    // A phone photo stored 4032 × 3024 and turned by its tag: decoded upright, 3024 × 4032.
    const upright = picture(3024, 4032);
    const load = vi.fn<UnderlayLoader>(async () => upright);
    const { layer, statuses, onLoaded, maxSide } = setup(load);
    layer.sync({ url: '/site/underlay/p/a.jpg', placement: P, ...VIEW });
    expect(statuses).toEqual([{ state: 'loading' }]);
    expect(load).toHaveBeenCalledWith('/site/underlay/p/a.jpg', 4096);
    expect(maxSide).toHaveBeenCalled();
    await settle();
    expect(statuses).toEqual([{ state: 'loading' }, { state: 'ready', aspect: 4032 / 3024 }]);
    expect(layer.aspect).toBeCloseTo(4 / 3, 9);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    const [x, y] = cornerOnMap(planeOf(layer)!, 1, 1);
    const [ex, ey] = imageToMap(P, 4032 / 3024, [1, 1]);
    expect(x).toBeCloseTo(ex, 3);
    expect(y).toBeCloseTo(ey, 3);
  });

  it('says a file is missing, or failed to show, and tries again when asked', async () => {
    const answers: Array<() => Promise<DecodedUnderlay | 'missing'>> = [
      async () => 'missing',
      async () => { throw new Error('the picture route answered 500'); },
      async () => picture(400, 300),
    ];
    const { layer, statuses } = setup(vi.fn<UnderlayLoader>(() => answers.shift()!()));
    layer.sync({ url: '/a.png', placement: P, ...VIEW });
    await settle();
    expect(statuses.at(-1)).toEqual({ state: 'missing' });
    expect(planeOf(layer)).toBeUndefined();
    layer.retry();
    await settle();
    expect(statuses.at(-1)).toEqual({ state: 'failed' });
    layer.retry();
    await settle();
    expect(statuses.at(-1)).toEqual({ state: 'ready', aspect: 0.75 });
    expect(planeOf(layer)).toBeDefined();
  });

  it('keeps the newer picture when an older load lands late, and lets the late one go (Review Focus #5)', async () => {
    const first = deferred();
    const second = deferred();
    const loads = [first.promise, second.promise];
    const { layer, statuses } = setup(vi.fn<UnderlayLoader>(() => loads.shift()!));
    const older = picture(400, 300);
    const newer = picture(300, 400);
    layer.sync({ url: '/old.png', placement: P, ...VIEW });
    layer.sync({ url: '/new.png', placement: P, ...VIEW });
    second.resolve(newer);
    await settle();
    first.resolve(older);
    await settle();
    expect(older.close).toHaveBeenCalledTimes(1);
    expect(newer.close).not.toHaveBeenCalled();
    const map = (planeOf(layer)!.material as THREE.MeshBasicMaterial).map!;
    expect(map.image).toBe(newer.source);
    expect(statuses.filter((status) => status.state === 'ready')).toEqual([{ state: 'ready', aspect: 400 / 300 }]);
  });

  it('takes the picture off when the map has none, frees it, and says so', async () => {
    const shown = picture(400, 300);
    const { layer, statuses } = setup(vi.fn<UnderlayLoader>(async () => shown));
    layer.sync({ url: '/a.png', placement: P, ...VIEW });
    await settle();
    const texture = (planeOf(layer)!.material as THREE.MeshBasicMaterial).map!;
    const freed = vi.spyOn(texture, 'dispose');
    layer.sync({ url: null, placement: null, ...VIEW });
    expect(statuses.at(-1)).toEqual({ state: 'none' });
    expect(planeOf(layer)).toBeUndefined();
    expect(shown.close).toHaveBeenCalledTimes(1);
    expect(freed).toHaveBeenCalled();
    expect(layer.aspect).toBeNull();
  });

  it('moves, turns, hides and fades the plane without rebuilding it', async () => {
    const { layer } = setup(vi.fn<UnderlayLoader>(async () => picture(400, 300)));
    layer.sync({ url: '/a.png', placement: P, ...VIEW });
    await settle();
    const plane = planeOf(layer)!;
    layer.sync({ url: '/a.png', placement: { ...P, centreXCm: 1500, rotationTenths: 900 }, shown: false, opacity: 0.2 });
    expect(planeOf(layer)).toBe(plane);
    expect(plane.position.x).toBeCloseTo(15, 9);
    expect(plane.visible).toBe(false);
    expect((plane.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.2, 9);
  });

  it('rebuilds the plane where it lay after the WebGL context comes back', async () => {
    const { layer } = setup(vi.fn<UnderlayLoader>(async () => picture(400, 300)));
    layer.sync({ url: '/a.png', placement: { ...P, centreXCm: 900 }, ...VIEW });
    await settle();
    const before = planeOf(layer)!;
    layer.rebuild();
    const after = planeOf(layer)!;
    expect(after).not.toBe(before);
    expect(after.position.x).toBeCloseTo(9, 9);
    expect((after.material as THREE.MeshBasicMaterial).map).not.toBe((before.material as THREE.MeshBasicMaterial).map);
  });

  it('reports nothing once disposed, and lets every picture go — even one still on its way', async () => {
    const late = deferred();
    const { layer, statuses } = setup(vi.fn<UnderlayLoader>(() => late.promise));
    layer.sync({ url: '/a.png', placement: P, ...VIEW });
    layer.dispose();
    const arriving = picture(400, 300);
    late.resolve(arriving);
    await settle();
    expect(arriving.close).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([{ state: 'loading' }]);
    expect(planeOf(layer)).toBeUndefined();
  });
});

describe('the browser’s loader', () => {
  function bytes(...parts: Array<number[] | string>): Uint8Array {
    const out: number[] = [];
    for (const part of parts) {
      if (typeof part === 'string') for (let i = 0; i < part.length; i += 1) out.push(part.charCodeAt(i));
      else out.push(...part);
    }
    return Uint8Array.from(out);
  }
  const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
  const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const png = (width: number, height: number) =>
    bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(width), be32(height), [8, 6, 0, 0, 0]);
  /** A JPEG stored landscape, with EXIF orientation 6: held upright when it was taken. */
  const sidewaysPhoto = (width: number, height: number) => {
    const tiff = bytes('MM', be16(42), be32(8), be16(1), be16(0x0112), be16(3), be32(1), be16(6), [0, 0], be32(0));
    const exif = bytes('Exif', [0, 0], [...tiff]);
    return bytes([0xff, 0xd8], [0xff, 0xe1], be16(exif.length + 2), [...exif],
      [0xff, 0xc0], be16(17), [8], be16(height), be16(width), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], [0xff, 0xda]);
  };
  const serve = (body: Uint8Array | null, status = 200) => vi.fn(async () => new Response(body, { status }));
  const decoder = () => vi.fn(async (_blob: Blob, options?: ImageBitmapOptions) => ({
    width: options?.resizeWidth ?? 1, height: 1, close: vi.fn(),
  }));

  it('asks the admin route, says missing on 404, and fails on anything else', async () => {
    const fetch = serve(null, 404);
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('createImageBitmap', decoder());
    expect(await loadUnderlayImage('/site/underlay/p/a.png', 4096)).toBe('missing');
    expect(fetch).toHaveBeenCalledWith('/site/underlay/p/a.png', { credentials: 'same-origin' });
    vi.stubGlobal('fetch', serve(null, 401));
    await expect(loadUnderlayImage('/site/underlay/p/a.png', 4096)).rejects.toThrow();
  });

  it('shrinks a sideways-stored phone photo by the width it is shown at, and has the browser turn it (Review Focus #1)', async () => {
    // Stored 8000 × 6000, shown 6000 × 8000: the long side, 8000, comes down to 4096, so the shown width to 3072.
    const decode = decoder();
    vi.stubGlobal('fetch', serve(sidewaysPhoto(8000, 6000)));
    vi.stubGlobal('createImageBitmap', decode);
    const decoded = await loadUnderlayImage('/a.jpg', 4096);
    expect(decode).toHaveBeenCalledWith(expect.anything(), {
      imageOrientation: 'from-image', premultiplyAlpha: 'none', resizeWidth: 3072, resizeQuality: 'high',
    });
    expect(decoded).toMatchObject({ width: 3072 });
  });

  it('decodes a picture already small enough as it is, and honours a smaller GPU limit', async () => {
    const decode = decoder();
    vi.stubGlobal('fetch', serve(png(1600, 1200)));
    vi.stubGlobal('createImageBitmap', decode);
    await loadUnderlayImage('/a.png', 4096);
    expect(decode).toHaveBeenLastCalledWith(expect.anything(), { imageOrientation: 'from-image', premultiplyAlpha: 'none' });
    vi.stubGlobal('fetch', serve(png(1600, 1200)));
    await loadUnderlayImage('/a.png', 800);
    expect(decode).toHaveBeenLastCalledWith(expect.anything(), {
      imageOrientation: 'from-image', premultiplyAlpha: 'none', resizeWidth: 800, resizeQuality: 'high',
    });
  });

  it('fails on a body that states no size, without decoding it', async () => {
    const decode = decoder();
    vi.stubGlobal('fetch', serve(bytes('hello')));
    vi.stubGlobal('createImageBitmap', decode);
    await expect(loadUnderlayImage('/a.png', 4096)).rejects.toThrow();
    expect(decode).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run "src/app/(admin)/site/editor/scene/underlay-mesh.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL, because `./underlay-mesh` cannot be resolved.

- [ ] **Step 3: Write `underlay-mesh.ts`**

Create `src/app/(admin)/site/editor/scene/underlay-mesh.ts`:

```ts
import * as THREE from 'three';
import { displaySize, imageFacts } from '@/lib/site/image-facts';
import type { UnderlayPlacement } from '@/lib/site/underlay';
import { CM, disposeObject, worldOf } from './meshes';

/**
 * The picture under the map, in the scene (spec §19): one flat, unlit plane a
 * millimetre above the ground, and the upkeep of the texture on it. That is
 * fetching, decoding, replacing, freeing, and rebuilding after a lost WebGL
 * context.
 *
 * Draw order. three draws every opaque object before any transparent one,
 * whatever their `renderOrder`. The plot, the grid, the fence and the drawn
 * shade patches are all opaque and write no depth. A see-through plane made
 * `transparent` would be drawn after them and cover the grid and the fence.
 * So this one stays in the opaque pass (`transparent: false`) and blends by
 * itself (`CustomBlending`, source alpha over what is there). three keeps
 * its opacity in the shader, because the `OPAQUE` define is only set for
 * `NormalBlending`. Among the opaque layers it sorts by `renderOrder` −3.5:
 * - above the ground outside (−5) and the plot (−4);
 * - below the shade patches (−3), the grid (−2, −1.5) and the fence (−1).
 * It writes no depth, so everything that stands is drawn over it.
 *
 * It is never picked. It is not one of `SceneSync`'s objects, and it carries
 * `userData.pick = false` besides. The calibration and alignment tools test
 * ground points against the picture themselves (`engine.ts`).
 *
 * Never mirrored. The corners are laid out by hand: the picture's top-left
 * (uv 0,0) at the north-west and its top-right at the north-east. The texture
 * is uploaded unflipped (`flipY = false`; WebGL ignores the flag for an
 * `ImageBitmap` anyway), so the picture's first row is its top edge.
 */

export const UNDERLAY_RENDER_ORDER = -3.5;
/** A millimetre above the ground: over the plot's surface, under everything that stands. */
export const UNDERLAY_LIFT_CM = 0.1;

export type UnderlayStatus =
  | { state: 'none' }
  | { state: 'loading' }
  /** `aspect`: the decoded picture's height ÷ width, as shown after any EXIF turn. */
  | { state: 'ready'; aspect: number }
  | { state: 'failed' }
  | { state: 'missing' };

/** What the picture layer and the calibration tool tell the editor (`SceneViewProps.onUnderlay`). */
export type UnderlayEvent =
  | { type: 'status'; status: UnderlayStatus }
  /** A point marked on the picture, as fractions of it. */
  | { type: 'point'; uv: [number, number] }
  | { type: 'offImage' }
  | { type: 'tooClose' };

/** A decoded picture, as the scene draws it: already turned by its EXIF tag and shrunk to fit. */
export interface DecodedUnderlay {
  source: ImageBitmap;
  width: number;
  height: number;
  close(): void;
}

/** Fetches and decodes. 'missing' when the route answers 404; rejects on any other failure. */
export type UnderlayLoader = (url: string, maxSide: number) => Promise<DecodedUnderlay | 'missing'>;

/**
 * The browser's loader (spec §19). It asks the admin-only route, reads the
 * picture's size from its header, and decodes it once:
 * - `imageOrientation: 'from-image'`, so a phone photo stands the way it was
 *   taken;
 * - `premultiplyAlpha: 'none'`, because the plane's blending multiplies by
 *   alpha itself;
 * - a width that keeps the long side within `maxSide`, worked out before
 *   decoding, so a 48-megapixel photo is never held whole (Review Focus #1).
 *
 * Only a width is passed. The HTML spec turns by the EXIF tag before it
 * resizes, so the width asked for is the width as shown. A browser that
 * resized first would still keep the proportions and only miss the size, and
 * three shrinks any texture still over the GPU's limit by itself.
 */
export async function loadUnderlayImage(url: string, maxSide: number): Promise<DecodedUnderlay | 'missing'> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (response.status === 404) return 'missing';
  if (!response.ok) throw new Error(`the picture route answered ${response.status}`);
  const blob = await response.blob();
  const shown = displaySize(imageFacts(new Uint8Array(await blob.arrayBuffer())));
  if (shown === null) throw new Error('the picture states no size');
  const scale = Math.min(1, maxSide / Math.max(shown.width, shown.height));
  const options: ImageBitmapOptions = { imageOrientation: 'from-image', premultiplyAlpha: 'none' };
  if (scale < 1) {
    options.resizeWidth = Math.max(1, Math.round(shown.width * scale));
    options.resizeQuality = 'high';
  }
  const bitmap = await createImageBitmap(blob, options);
  return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => { bitmap.close(); } };
}

/** A plane one metre wide and `aspect` metres deep, centred on its origin, facing up. */
function planeGeometry(aspect: number): THREE.BufferGeometry {
  const half = aspect / 2;
  const geometry = new THREE.BufferGeometry();
  // North-west, north-east, south-east, south-west: the picture's top-left, top-right, bottom-right, bottom-left.
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, -half, 0.5, 0, -half, 0.5, 0, half, -0.5, 0, half,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  // Wound to face up (+Y): the map is only ever seen from above.
  geometry.setIndex([0, 3, 2, 0, 2, 1]);
  return geometry;
}

export function buildUnderlayPlane(image: DecodedUnderlay): THREE.Mesh {
  const texture = new THREE.Texture(image.source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(planeGeometry(image.height / image.width), material);
  mesh.name = 'underlayPlane';
  mesh.renderOrder = UNDERLAY_RENDER_ORDER;
  mesh.userData.pick = false;
  return mesh;
}

/** Where the plane lies and how this viewer sees it. A move, a turn or a fade never rebuilds it. */
export function placeUnderlayPlane(
  mesh: THREE.Mesh, placement: UnderlayPlacement, view: { shown: boolean; opacity: number },
): void {
  mesh.position.copy(worldOf(placement.centreXCm, placement.centreYCm, UNDERLAY_LIFT_CM));
  // Clockwise seen from above on the map is a negative turn about three's up axis (`meshes.ts`: map y is three's z).
  mesh.rotation.set(0, -((placement.rotationTenths / 10) * Math.PI) / 180, 0);
  const metres = placement.widthCm * CM;
  mesh.scale.set(metres, 1, metres);
  (mesh.material as THREE.MeshBasicMaterial).opacity = view.opacity;
  mesh.visible = view.shown;
  mesh.updateMatrixWorld(true);
}

function freePlane(mesh: THREE.Mesh): void {
  (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
  disposeObject(mesh);
}

function sameStatus(a: UnderlayStatus, b: UnderlayStatus): boolean {
  return a.state === b.state && (a.state !== 'ready' || b.state !== 'ready' || a.aspect === b.aspect);
}

export interface UnderlayLayerOptions {
  load: UnderlayLoader;
  /** The longest side a decoded picture may keep: 4096, or the GPU's own limit if smaller. */
  maxSide: () => number;
  onStatus: (status: UnderlayStatus) => void;
  /** A picture arrived: the scene has something new to draw. */
  onLoaded: () => void;
}

export interface UnderlaySyncInput {
  /** The admin route's URL for the picture, or null when the map has none. */
  url: string | null;
  placement: UnderlayPlacement | null;
  shown: boolean;
  opacity: number;
}

/**
 * The picture's upkeep, keyed by its URL (which carries the file's hash). A
 * new URL frees the old picture and loads the new one. A load that lands
 * after a newer one was asked for is released unseen, so a quick replace or
 * an undo across one never shows the wrong picture (Review Focus #5). The
 * decoded picture is kept while it is shown, so a lost WebGL context can
 * upload it again (`rebuild`).
 */
export class UnderlayLayer {
  readonly root = new THREE.Group();
  private url: string | null = null;
  private image: DecodedUnderlay | null = null;
  private mesh: THREE.Mesh | null = null;
  private status: UnderlayStatus = { state: 'none' };
  /** Bumped by every load and every drop: a load answering to an older number is stale. */
  private generation = 0;
  private last: UnderlaySyncInput | null = null;
  private disposed = false;

  constructor(private readonly options: UnderlayLayerOptions) {
    this.root.name = 'underlay';
  }

  /** The decoded picture's height ÷ width, or null while there is none to draw. */
  get aspect(): number | null {
    return this.image === null ? null : this.image.height / this.image.width;
  }

  sync(input: UnderlaySyncInput): void {
    if (this.disposed) return;
    this.last = input;
    if (input.url !== this.url) {
      this.drop();
      this.url = input.url;
      if (input.url === null) this.report({ state: 'none' });
      else this.load(input.url);
    }
    if (this.mesh !== null && input.placement !== null) placeUnderlayPlane(this.mesh, input.placement, input);
  }

  /** "ניסיון נוסף": load the same picture again after it failed or went missing. */
  retry(): void {
    if (this.disposed || this.url === null || this.image !== null) return;
    this.load(this.url);
  }

  /** The WebGL context came back: the kept picture goes up again, as a new texture on a new plane. */
  rebuild(): void {
    if (this.disposed || this.image === null) return;
    this.clearMesh();
    this.makeMesh();
  }

  dispose(): void {
    this.drop();
    this.disposed = true;
  }

  private load(url: string): void {
    this.generation += 1;
    const generation = this.generation;
    this.report({ state: 'loading' });
    this.options.load(url, this.options.maxSide()).then((result) => {
      if (this.disposed || generation !== this.generation) {
        if (result !== 'missing') result.close();
        return;
      }
      if (result === 'missing') {
        this.report({ state: 'missing' });
        return;
      }
      this.image = result;
      this.makeMesh();
      this.report({ state: 'ready', aspect: result.height / result.width });
      this.options.onLoaded();
    }, () => {
      if (this.disposed || generation !== this.generation) return;
      this.report({ state: 'failed' });
    });
  }

  private makeMesh(): void {
    if (this.image === null) return;
    this.mesh = buildUnderlayPlane(this.image);
    this.root.add(this.mesh);
    const last = this.last;
    if (last !== null && last.placement !== null) placeUnderlayPlane(this.mesh, last.placement, last);
  }

  private clearMesh(): void {
    if (this.mesh === null) return;
    this.root.remove(this.mesh);
    freePlane(this.mesh);
    this.mesh = null;
  }

  private drop(): void {
    this.generation += 1;
    this.clearMesh();
    this.image?.close();
    this.image = null;
  }

  private report(status: UnderlayStatus): void {
    if (this.disposed || sameStatus(status, this.status)) return;
    this.status = status;
    this.options.onStatus(status);
  }
}
```

- [ ] **Step 4: Run the test**

Run the Step 2 command. Expected: 14 passed, exit 0.

If `tsc` or the test rejects `imageOrientation: 'from-image'` as an `ImageBitmapOptions` value, the DOM lib predates the HTML spec's rename of `'none'` to `'from-image'`. Stop and report it. Do not cast it away: `'none'` would leave phone photos sideways in some browsers.

Then prove Review Focus #5's test can fail. In `load`'s success handler, temporarily delete `|| generation !== this.generation` and re-run. Expected: "keeps the newer picture when an older load lands late…" fails, because the late picture is drawn and never closed. Restore it: 14 passed.

- [ ] **Step 5: Typecheck, lint, the three guard, commit**

Run: `npx tsc --noEmit`. Expected: exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor/scene/underlay-mesh.ts" "src/app/(admin)/site/editor/scene/underlay-mesh.test.ts"`. Expected: no problems.
Run: `npx vitest run "src/app/(admin)/site/editor/three-guard.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`. Expected: 2 passed. The new file imports `three` from under `scene/`, which is allowed.

```bash
git add "src/app/(admin)/site/editor/scene/underlay-mesh.ts" "src/app/(admin)/site/editor/scene/underlay-mesh.test.ts"
git commit -m "feat(site): the picture under the map as a plane — opaque-pass blending, never mirrored, loaded, replaced and rebuilt

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The calibration and alignment tools, and the picture in the engine

**Files:**
- Create: `src/app/(admin)/site/editor/scene/underlay-tool.ts`, `src/app/(admin)/site/editor/scene/underlay-tool.test.ts`
- Modify: `src/app/(admin)/site/editor/scene/engine.ts`
- Modify: `src/app/(admin)/site/editor/scene/scene-view.tsx` (`EditorUi`, `SceneViewProps`, `SceneHandle`)
- Modify: `src/app/(admin)/site/editor/scene/scene-view.test.tsx` (its `UI` literal gains `underlay`; nothing else)
- Modify: `src/app/(admin)/site/editor/site-editor.tsx` (only `INITIAL_UI` gains `underlay`, so `tsc` stays green; Task 9 wires the rest)
- Create: `src/app/(admin)/site/editor/scene/underlay.scene.test.tsx`

**Interfaces:**
- Consumes:
  - `PointerInput` (`scene/gestures.ts`, unchanged, type only); `ViewMode` (`camera.ts`);
  - `UnderlayLayer`, `loadUnderlayImage`, `UNDERLAY_LIFT_CM`, `UnderlayEvent` (Task 6);
  - `imageToMap`, `mapToImage`, `isOnImage`, `moveBy`, `ImagePoint`, `MapPoint`, `UnderlayPlacement` (Task 2);
  - `placeOps` (Task 3); `underlayOf` (Task 3); `underlayUrl`, `MAX_UNDERLAY_TEXTURE_PX` (Task 1).
- Produces:
  - `underlay-tool.ts`: `CALIBRATION_MIN_PX = 20`; `interface UnderlayWorld { tool(): 'calibrate' | 'align'; mode(): ViewMode; groundAt(x, y): [number, number] | null; onImage(ground): boolean }`; `type UnderlayIntent = panBy | orbitBy | { type: 'pick'; x; y; ground } | { type: 'movePreview'; dxCm; dyCm } | { type: 'moveCommit'; dxCm; dyCm } | { type: 'cursor'; cursor }`; `class UnderlayGestures { constructor(world); readonly active: boolean; down(p); move(p); up(p); cancel() }`; `classifyPick(uv, at, first): 'point' | 'offImage' | 'tooClose'`.
  - `scene-view.tsx`:
    - `EditorUi.tool: 'select' | 'measure' | 'calibrate' | 'align'`;
    - `EditorUi.underlay: { shown: boolean; opacity: number }`;
    - `SceneViewProps.underlayMarks?: ReadonlyArray<ImagePoint>`;
    - `SceneViewProps.onUnderlay?: (event: UnderlayEvent) => void`;
    - `SceneHandle.retryUnderlay(): void`.
  - The engine:
    - draws the picture from `underlayOf(store.doc)` at `ui.underlay`'s visibility and opacity;
    - reports its loading state through `onUnderlay`;
    - calibrating, it sends `point` / `offImage` / `tooClose` for each click;
    - aligning, it runs `store.run('הזזת תמונת הרקע', placeOps(…))` on each drop;
    - it draws `underlayMarks` as measure dots and a line.

`gestures.ts` is **not** changed. `GestureWorld.tool()` still answers `'select' | 'measure'`: while the picture's tools are on, the engine gives pointer events to `UnderlayGestures` instead, and tells `Gestures` the tool is `'select'`.

- [ ] **Step 1: Write the failing pointer-machine test**

Create `src/app/(admin)/site/editor/scene/underlay-tool.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { PointerInput } from './gestures';
import { CALIBRATION_MIN_PX, UnderlayGestures, classifyPick, type UnderlayWorld } from './underlay-tool';

/** Ten centimetres to a pixel; the picture covers the ground from 0 to 1000 cm each way. */
function world(tool: 'calibrate' | 'align' = 'calibrate', mode: 'plan' | '3d' = 'plan'): UnderlayWorld {
  return {
    tool: () => tool,
    mode: () => mode,
    groundAt: (x, y) => [x * 10, y * 10],
    onImage: ([x, y]) => x >= 0 && x <= 1000 && y >= 0 && y <= 1000,
  };
}

const at = (x: number, y: number, over: Partial<PointerInput> = {}): PointerInput =>
  ({ x, y, button: 0, shift: false, meta: false, ctrl: false, alt: false, ...over });

describe('the picture’s tools, pointer by pointer', () => {
  it('calibrating, a click marks where it was pressed', () => {
    const gestures = new UnderlayGestures(world());
    expect(gestures.down(at(50, 40))).toEqual([]);
    expect(gestures.active).toBe(true);
    expect(gestures.move(at(51, 41))).toEqual([]);
    const intents = gestures.up(at(51, 41));
    expect(intents).toContainEqual({ type: 'pick', x: 50, y: 40, ground: [500, 400] });
    expect(intents.some((intent) => intent.type === 'panBy')).toBe(false);
    expect(gestures.active).toBe(false);
  });

  it('calibrating, a drag moves the view and marks nothing', () => {
    const gestures = new UnderlayGestures(world());
    gestures.down(at(50, 40));
    expect(gestures.move(at(70, 40))).toEqual([{ type: 'panBy', dxCm: -200, dyCm: 0 }]);
    expect(gestures.up(at(70, 40)).some((intent) => intent.type === 'pick')).toBe(false);
  });

  it('aligning, a drag that starts on the picture moves it in whole centimetres, and saves once, on release', () => {
    const gestures = new UnderlayGestures(world('align'));
    gestures.down(at(50, 40));
    expect(gestures.move(at(60.44, 40))).toEqual([{ type: 'movePreview', dxCm: 104, dyCm: 0 }]);
    expect(gestures.move(at(80, 45))).toEqual([{ type: 'movePreview', dxCm: 300, dyCm: 50 }]);
    const intents = gestures.up(at(80, 45));
    expect(intents).toContainEqual({ type: 'moveCommit', dxCm: 300, dyCm: 50 });
    expect(intents.filter((intent) => intent.type === 'moveCommit')).toHaveLength(1);
  });

  it('aligning, a drag beside the picture moves the view, and a click on it does nothing', () => {
    const gestures = new UnderlayGestures(world('align'));
    gestures.down(at(150, 40));
    expect(gestures.move(at(170, 40))).toEqual([{ type: 'panBy', dxCm: -200, dyCm: 0 }]);
    expect(gestures.up(at(170, 40)).some((intent) => intent.type === 'moveCommit')).toBe(false);
    gestures.down(at(50, 40));
    const click = gestures.up(at(50, 40));
    expect(click.some((intent) => intent.type === 'moveCommit' || intent.type === 'pick')).toBe(false);
  });

  it('orbits on a right-drag in 3D, pans on one in plan, and pans on the middle button', () => {
    const in3d = new UnderlayGestures(world('calibrate', '3d'));
    in3d.down(at(50, 40, { button: 2 }));
    expect(in3d.move(at(60, 40, { button: 2 }))[0]).toMatchObject({ type: 'orbitBy' });
    const inPlan = new UnderlayGestures(world('align', 'plan'));
    inPlan.down(at(50, 40, { button: 2 }));
    expect(inPlan.move(at(70, 40, { button: 2 }))).toEqual([{ type: 'panBy', dxCm: -200, dyCm: 0 }]);
    inPlan.up(at(70, 40, { button: 2 }));
    inPlan.down(at(50, 40, { button: 1 }));
    expect(inPlan.move(at(70, 40, { button: 1 }))).toEqual([{ type: 'panBy', dxCm: -200, dyCm: 0 }]);
  });

  it('says with the cursor what a press would do, and only when that changes', () => {
    const aligning = new UnderlayGestures(world('align'));
    expect(aligning.move(at(50, 40))).toEqual([{ type: 'cursor', cursor: 'move' }]);
    expect(aligning.move(at(51, 40))).toEqual([]);
    expect(aligning.move(at(150, 40))).toEqual([{ type: 'cursor', cursor: 'default' }]);
    expect(new UnderlayGestures(world()).move(at(50, 40))).toEqual([{ type: 'cursor', cursor: 'crosshair' }]);
  });

  it('drops a drag it is told to, and saves nothing afterwards', () => {
    const gestures = new UnderlayGestures(world('align'));
    gestures.down(at(50, 40));
    gestures.move(at(80, 40));
    expect(gestures.cancel()).toEqual([]);
    expect(gestures.active).toBe(false);
    expect(gestures.up(at(80, 40))).toEqual([]);
  });

  it('refuses a click off the picture, or nearer the first point than 20 pixels', () => {
    expect(CALIBRATION_MIN_PX).toBe(20);
    expect(classifyPick([1.2, 0.5], { x: 0, y: 0 }, null)).toBe('offImage');
    expect(classifyPick([0.5, -0.01], { x: 0, y: 0 }, null)).toBe('offImage');
    expect(classifyPick([0.5, 0.5], { x: 119, y: 100 }, { x: 100, y: 100 })).toBe('tooClose');
    expect(classifyPick([0.5, 0.5], { x: 120, y: 100 }, { x: 100, y: 100 })).toBe('point');
    expect(classifyPick([0, 1], { x: 5, y: 5 }, null)).toBe('point');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run "src/app/(admin)/site/editor/scene/underlay-tool.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL, because `./underlay-tool` cannot be resolved.

- [ ] **Step 3: Write `underlay-tool.ts`**

Create `src/app/(admin)/site/editor/scene/underlay-tool.ts`:

```ts
import type { ViewMode } from '@/lib/site/editor/camera';
import { isOnImage, type ImagePoint } from '@/lib/site/underlay';
import type { PointerInput } from './gestures';

/**
 * The picture's two tools as a pointer machine (spec §18.3–18.4), with no
 * `three`, no DOM and no store: pointer events in, intents out, as
 * `gestures.ts` is for items. The engine hands it the canvas's events while
 * the tool is 'calibrate' or 'align', and `Gestures` none of them.
 *
 * - Calibrating: a click is a point to mark (`pick`), a drag moves the view.
 *   Which clicks count is `classifyPick`'s, in the engine, which knows the
 *   picture and the screen.
 * - Aligning: a drag that starts on the picture moves it, freely, in whole
 *   centimetres, and saves once on release. A drag beside it moves the view.
 * - Either way the right button orbits in 3D and pans in plan, and the middle
 *   button pans, as they do for items.
 */

/** Two points marked nearer than this on screen are too close to measure a scale by (spec §18.3). */
export const CALIBRATION_MIN_PX = 20;
/** How far a press may wander and still be a click, as in `gestures.ts`. */
const CLICK_SLOP_PX = 4;
const YAW_PER_PX = 0.35;
const PITCH_PER_PX = 0.3;

export interface UnderlayWorld {
  tool(): 'calibrate' | 'align';
  mode(): ViewMode;
  groundAt(x: number, y: number): [number, number] | null;
  /** Whether the picture is drawn at this ground point. */
  onImage(ground: [number, number]): boolean;
}

export type UnderlayIntent =
  | { type: 'panBy'; dxCm: number; dyCm: number }
  | { type: 'orbitBy'; dYaw: number; dPitch: number }
  /** Calibrating: a click, where it was pressed on screen and on the ground. */
  | { type: 'pick'; x: number; y: number; ground: [number, number] }
  | { type: 'movePreview'; dxCm: number; dyCm: number }
  | { type: 'moveCommit'; dxCm: number; dyCm: number }
  | { type: 'cursor'; cursor: string };

type Point = { x: number; y: number };
type Drag =
  | { type: 'pan'; start: Point; grab: [number, number] | null; moved: boolean; pick: boolean }
  | { type: 'orbit'; last: Point }
  | { type: 'move'; start: Point; grab: [number, number]; moved: boolean; last: [number, number] };

function far(a: Point, b: Point, slop: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) >= slop;
}

export class UnderlayGestures {
  private drag: Drag | null = null;
  private cursor = '';

  constructor(private readonly world: UnderlayWorld) {}

  /** A drag is under way: the view counts as moving until it ends. */
  get active(): boolean {
    return this.drag !== null;
  }

  down(p: PointerInput): UnderlayIntent[] {
    const at = { x: p.x, y: p.y };
    this.drag = null;
    if (p.button === 2 || (p.button === 0 && p.ctrl)) {
      this.drag = this.world.mode() === '3d'
        ? { type: 'orbit', last: at }
        : { type: 'pan', start: at, grab: this.world.groundAt(p.x, p.y), moved: false, pick: false };
      return [];
    }
    if (p.button === 1) {
      this.drag = { type: 'pan', start: at, grab: this.world.groundAt(p.x, p.y), moved: false, pick: false };
      return [];
    }
    if (p.button !== 0) return [];
    const ground = this.world.groundAt(p.x, p.y);
    if (this.world.tool() === 'align' && ground !== null && this.world.onImage(ground)) {
      this.drag = { type: 'move', start: at, grab: ground, moved: false, last: [0, 0] };
      return [];
    }
    this.drag = { type: 'pan', start: at, grab: ground, moved: false, pick: this.world.tool() === 'calibrate' };
    return [];
  }

  move(p: PointerInput): UnderlayIntent[] {
    const drag = this.drag;
    const at = { x: p.x, y: p.y };
    if (drag === null) return this.hover(p);
    switch (drag.type) {
      case 'orbit': {
        const intent: UnderlayIntent = { type: 'orbitBy', dYaw: (p.x - drag.last.x) * YAW_PER_PX, dPitch: (p.y - drag.last.y) * PITCH_PER_PX };
        drag.last = at;
        return [intent];
      }
      case 'pan': {
        if (!drag.moved && !far(drag.start, at, CLICK_SLOP_PX)) return [];
        drag.moved = true;
        const ground = this.world.groundAt(p.x, p.y);
        if (drag.grab === null || ground === null) return [];
        // Keep the grabbed ground point under the pointer.
        return [{ type: 'panBy', dxCm: drag.grab[0] - ground[0], dyCm: drag.grab[1] - ground[1] }];
      }
      case 'move': {
        if (!drag.moved && !far(drag.start, at, CLICK_SLOP_PX)) return [];
        drag.moved = true;
        const ground = this.world.groundAt(p.x, p.y);
        if (ground !== null) drag.last = [Math.round(ground[0] - drag.grab[0]), Math.round(ground[1] - drag.grab[1])];
        return [{ type: 'movePreview', dxCm: drag.last[0], dyCm: drag.last[1] }];
      }
    }
  }

  up(p: PointerInput): UnderlayIntent[] {
    const drag = this.drag;
    this.drag = null;
    if (drag === null) return [];
    const settle = this.hover(p);
    if (drag.type === 'pan' && !drag.moved && drag.pick && drag.grab !== null) {
      return [{ type: 'pick', x: drag.start.x, y: drag.start.y, ground: drag.grab }, ...settle];
    }
    if (drag.type === 'move' && drag.moved) {
      const ground = this.world.groundAt(p.x, p.y);
      const [dxCm, dyCm] = ground === null
        ? drag.last
        : [Math.round(ground[0] - drag.grab[0]), Math.round(ground[1] - drag.grab[1])];
      return [{ type: 'moveCommit', dxCm, dyCm }, ...settle];
    }
    return settle;
  }

  /** The pointer was taken, the window lost focus, or the tool changed: nothing is saved, and the cursor is asked again. */
  cancel(): UnderlayIntent[] {
    this.drag = null;
    this.cursor = '';
    return [];
  }

  private hover(p: PointerInput): UnderlayIntent[] {
    let cursor = 'crosshair';
    if (this.world.tool() === 'align') {
      const ground = this.world.groundAt(p.x, p.y);
      cursor = ground !== null && this.world.onImage(ground) ? 'move' : 'default';
    }
    if (cursor === this.cursor) return [];
    this.cursor = cursor;
    return [{ type: 'cursor', cursor }];
  }
}

/**
 * A click while calibrating (spec §18.3): a point on the picture, a point
 * off it, or one nearer the first than `CALIBRATION_MIN_PX`, too close to
 * measure a scale by. `at` and `first` are in screen pixels.
 */
export function classifyPick(
  point: ImagePoint, at: { x: number; y: number }, first: { x: number; y: number } | null,
): 'point' | 'offImage' | 'tooClose' {
  if (!isOnImage(point)) return 'offImage';
  if (first !== null && Math.hypot(at.x - first.x, at.y - first.y) < CALIBRATION_MIN_PX) return 'tooClose';
  return 'point';
}
```

- [ ] **Step 4: Run the pointer-machine test**

Run the Step 2 command. Expected: 8 passed, exit 0.

- [ ] **Step 5: Widen the scene's contract**

Read `src/app/(admin)/site/editor/scene/scene-view.tsx` with the Read tool.

1. After `import type { SiteKindGroup } from '@/lib/site/kinds';` add `import type { ImagePoint } from '@/lib/site/underlay';`. After `import type { SceneTheme } from './palette';` add `import type { UnderlayEvent } from './underlay-mesh';`.

2. Replace the `EditorUi` interface with:

```ts
export interface EditorUi {
  /** 'calibrate' and 'align' are the picture's two tools (spec §18), entered from its card. */
  tool: 'select' | 'measure' | 'calibrate' | 'align';
  mode: ViewMode;
  labels: boolean;
  sun: boolean;
  netsHidden: boolean;
  snap: boolean;
  hiddenGroups: SiteKindGroup[];
  hour: number;
  theme: SceneTheme;
  /** How this viewer sees the picture under the map — never saved (D19). Shown, at 50%, whenever the map has one. */
  underlay: { shown: boolean; opacity: number };
}
```

3. In `SceneHandle`, after `exportPng(): string | null;` add:

```ts
  /** The picture's card's "ניסיון נוסף": load the picture again after it failed. */
  retryUnderlay(): void;
```

4. In `SceneViewProps`, after `onModeSettled?: (mode: ViewMode) => void;` add:

```ts
  /** Calibration marks to draw, as points on the picture: those marked so far, or the saved pair while its card is open. */
  underlayMarks?: ReadonlyArray<ImagePoint>;
  /** What the picture layer and its tools report: whether the picture is loading, shown or failed, and each click while calibrating. */
  onUnderlay?: (event: UnderlayEvent) => void;
```

5. In `useImperativeHandle`, after `exportPng: () => engineRef.current?.exportPng() ?? null,` add `retryUnderlay: () => engineRef.current?.retryUnderlay(),`.

Then make the two `EditorUi` literals carry the new field, so `tsc` stays green:

- In `src/app/(admin)/site/editor/scene/scene-view.test.tsx`, in `const UI: EditorUi = { … }`, after `hour: 14, theme: 'light',` add `underlay: { shown: true, opacity: 0.5 },`.
- In `src/app/(admin)/site/editor/site-editor.tsx`, replace:

```ts
/** The mock's opening state: 3D, labels on, snapping on, 14:00 for the sun. */
const INITIAL_UI: EditorUi = {
  tool: 'select', mode: '3d', labels: true, sun: false, netsHidden: false, snap: true,
  hiddenGroups: [], hour: 14, theme: 'light',
};
```

with:

```ts
/** The mock's opening state: 3D, labels on, snapping on, 14:00 for the sun; a picture under the map shown at 50% (spec §17). */
const INITIAL_UI: EditorUi = {
  tool: 'select', mode: '3d', labels: true, sun: false, netsHidden: false, snap: true,
  hiddenGroups: [], hour: 14, theme: 'light', underlay: { shown: true, opacity: 0.5 },
};
```

- [ ] **Step 6: Write the failing engine test**

Create `src/app/(admin)/site/editor/scene/underlay.scene.test.tsx`. It runs the real engine in jsdom, as `scene-view.test.tsx` does, with the renderer stood in for. The stand-in remembers the last scene drawn, so the test can find the plane in it. The picture route and the decoder are stubbed.

The view is plan, on a 1000 × 700 stage with no insets. So the plot's middle, (1300, 1200), is at the stage's middle, (500, 350).

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { Mesh, MeshBasicMaterial, Object3D } from 'three';
import type { EditorDoc, EditorItem, EditorUnderlay } from '@/lib/site/editor/model';
import type { SiteOp } from '@/lib/site/editor/ops';
import type { EditorStore } from '../use-editor-store';
import type { UnderlayEvent } from './underlay-mesh';

const { drawn } = vi.hoisted(() => ({ drawn: { scene: null as Object3D | null } }));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class WebGLRenderer {
    shadowMap = { enabled: false };
    setPixelRatio() {}
    setSize() {}
    render(scene: Object3D) { drawn.scene = scene; }
    dispose() {}
    forceContextLoss() {}
  }
  return { ...actual, WebGLRenderer };
});

import { SceneView, type EditorUi } from './scene-view';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const SHA = 'a'.repeat(64);
const IMAGE: EditorUnderlay = {
  storageKey: `site-underlays/${PLAN}/${SHA}.png`, contentType: 'image/png', sizeBytes: 1000, filename: 'שרטוט.png',
  centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0, calibration: null,
};
const TENT: EditorItem = {
  id: 'tent', kind: 'tent', label: 'אוהל 1', xCm: 1150, yCm: 1050, widthCm: 300, depthCm: 300,
  heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false,
};
const DOC: EditorDoc = {
  plot: { id: PLAN, widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items: [TENT], defaults: {}, underlay: IMAGE,
};
const UI: EditorUi = {
  tool: 'select', mode: 'plan', labels: false, sun: false, netsHidden: false, snap: true,
  hiddenGroups: [], hour: 14, theme: 'light', underlay: { shown: true, opacity: 0.5 },
};

type Store = EditorStore & { run: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> };
function fakeStore(): Store {
  return {
    doc: DOC, selection: [], canUndo: false, canRedo: false,
    flags: { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: [] },
    save: { status: 'saved', version: 0, pending: 0, error: null, errorKind: null }, conflict: null, notice: null,
    run: vi.fn(), undo: vi.fn(() => null), redo: vi.fn(() => null), select: vi.fn(),
    resolveConflict: vi.fn(async () => {}), retrySave: vi.fn(), dismissNotice: vi.fn(),
  };
}

/** A PNG header, 400 × 300: all the loader reads of what the route sends. */
const PNG_400x300 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0x01, 0x90, 0, 0, 0x01, 0x2c, 8, 6, 0, 0, 0,
]);
const bitmap = { width: 400, height: 300, close: vi.fn() };
const route = vi.fn(async () => new Response(PNG_400x300, { status: 200 }));
const decode = vi.fn(async () => bitmap);

const realRect = Element.prototype.getBoundingClientRect;
const realGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  drawn.scene = null;
  bitmap.close.mockClear();
  route.mockClear();
  decode.mockClear();
  vi.stubGlobal('fetch', route);
  vi.stubGlobal('createImageBitmap', decode);
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof realGetContext;
  Element.prototype.getBoundingClientRect = () => ({
    width: 1000, height: 700, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 700, toJSON: () => ({}),
  });
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  HTMLCanvasElement.prototype.getContext = realGetContext;
  vi.unstubAllGlobals();
});

function renderScene(ui: EditorUi = UI, store: Store = fakeStore()) {
  const onUnderlay = vi.fn<(event: UnderlayEvent) => void>();
  const scene = (nextUi: EditorUi, marks?: ReadonlyArray<[number, number]>) => (
    <SceneView store={store} ui={nextUi} insets={{ left: 0, right: 0, top: 0, bottom: 0 }} sunDate={null}
      onView={() => {}} onNotice={() => {}} underlayMarks={marks} onUnderlay={onUnderlay} />
  );
  const view = render(scene(ui));
  const canvas = view.container.querySelector('canvas') as HTMLCanvasElement;
  return { ...view, store, onUnderlay, canvas, rerenderWith: (nextUi: EditorUi, marks?: ReadonlyArray<[number, number]>) => { view.rerender(scene(nextUi, marks)); } };
}

const PRIMARY = { button: 0, pointerId: 1, isPrimary: true };
function click(canvas: HTMLCanvasElement, [x, y]: [number, number]) {
  fireEvent.pointerDown(canvas, { clientX: x, clientY: y, ...PRIMARY });
  fireEvent.pointerUp(canvas, { clientX: x, clientY: y, ...PRIMARY });
}
function drag(canvas: HTMLCanvasElement, [x0, y0]: [number, number], [x1, y1]: [number, number]) {
  fireEvent.pointerDown(canvas, { clientX: x0, clientY: y0, ...PRIMARY });
  fireEvent.pointerMove(canvas, { clientX: (x0 + x1) / 2, clientY: (y0 + y1) / 2, ...PRIMARY });
  fireEvent.pointerMove(canvas, { clientX: x1, clientY: y1, ...PRIMARY });
  fireEvent.pointerUp(canvas, { clientX: x1, clientY: y1, ...PRIMARY });
}
const frames = () => new Promise((done) => { setTimeout(done, 80); });
const plane = () => drawn.scene?.getObjectByName('underlayPlane') as Mesh | undefined;
async function ready(onUnderlay: ReturnType<typeof vi.fn>) {
  await waitFor(() => {
    expect(onUnderlay).toHaveBeenCalledWith({ type: 'status', status: { state: 'ready', aspect: 0.75 } });
  });
  await frames();
}

describe('the picture under the map, in the engine', () => {
  it('fetches the picture from the admin route, never from storage, and reports it loading, then ready with its aspect', async () => {
    const { onUnderlay } = renderScene();
    await ready(onUnderlay);
    expect(onUnderlay).toHaveBeenCalledWith({ type: 'status', status: { state: 'loading' } });
    expect(route).toHaveBeenCalledWith(`/site/underlay/${PLAN}/${SHA}.png`, { credentials: 'same-origin' });
    expect(decode).toHaveBeenCalledWith(expect.anything(), { imageOrientation: 'from-image', premultiplyAlpha: 'none' });
  });

  it('lies where it was placed, a millimetre up — and is hidden, so left out of the picture export, when this viewer hides it', async () => {
    const { onUnderlay, rerenderWith } = renderScene();
    await ready(onUnderlay);
    expect(plane()!.position.x).toBeCloseTo(13, 6);
    expect(plane()!.position.y).toBeCloseTo(0.001, 9);
    expect(plane()!.position.z).toBeCloseTo(12, 6);
    expect(plane()!.visible).toBe(true);
    rerenderWith({ ...UI, underlay: { shown: false, opacity: 0.3 } });
    await frames();
    expect(plane()!.visible).toBe(false);
    expect((plane()!.material as MeshBasicMaterial).opacity).toBeCloseTo(0.3, 9);
  });

  it('marks a calibration point where the picture is clicked, and refuses a click beside it or too near the first', async () => {
    const calibrating: EditorUi = { ...UI, tool: 'calibrate' };
    const { onUnderlay, canvas, store, rerenderWith } = renderScene(calibrating);
    await ready(onUnderlay);

    click(canvas, [500, 350]);
    const marked = onUnderlay.mock.lastCall?.[0] as Extract<UnderlayEvent, { type: 'point' }>;
    expect(marked.type).toBe('point');
    expect(marked.uv[0]).toBeCloseTo(0.5, 2);
    expect(marked.uv[1]).toBeCloseTo(0.5, 2);

    click(canvas, [5, 5]);
    expect(onUnderlay).toHaveBeenLastCalledWith({ type: 'offImage' });

    rerenderWith(calibrating, [[0.5, 0.5]]);
    await frames();
    click(canvas, [505, 350]);
    expect(onUnderlay).toHaveBeenLastCalledWith({ type: 'tooClose' });
    click(canvas, [560, 350]);
    expect((onUnderlay.mock.lastCall?.[0] as UnderlayEvent).type).toBe('point');

    // Marking is not editing, and the tent under the picture is not selected through it.
    expect(store.run).not.toHaveBeenCalled();
    expect(store.select).not.toHaveBeenCalled();
  });

  it('moves the picture by a drag in the alignment tool, as one saved step, and pans when the drag starts beside it', async () => {
    const { onUnderlay, canvas, store } = renderScene({ ...UI, tool: 'align' });
    await ready(onUnderlay);
    drag(canvas, [500, 350], [600, 350]);
    expect(store.run).toHaveBeenCalledTimes(1);
    const [label, ops] = store.run.mock.calls[0] as [string, SiteOp[]];
    expect(label).toBe('הזזת תמונת הרקע');
    const moved = (ops[0] as Extract<SiteOp, { type: 'setUnderlay' }>).underlay!;
    expect(moved.centreXCm).toBeGreaterThan(1300);
    expect(moved.centreYCm).toBe(1200);
    expect({ ...moved, centreXCm: 1300 }).toEqual(IMAGE);

    drag(canvas, [5, 5], [100, 100]);
    expect(store.run).toHaveBeenCalledTimes(1);
    expect(store.select).not.toHaveBeenCalled();
  });

  it('lets clicks through in the selection tool: a click on the picture selects the tent standing on it', async () => {
    const { onUnderlay, canvas, store } = renderScene();
    await ready(onUnderlay);
    click(canvas, [500, 350]);
    expect(store.select).toHaveBeenCalledWith(['tent']);
  });

  it('draws the calibration marks it is given as two dots and a line', async () => {
    const { onUnderlay, rerenderWith, container } = renderScene();
    await ready(onUnderlay);
    rerenderWith(UI, [[0.1, 0.5], [0.9, 0.5]]);
    await frames();
    expect(container.querySelectorAll('svg circle')).toHaveLength(2);
    expect(container.querySelectorAll('svg line')).toHaveLength(1);
  });

  it('builds the plane again when the WebGL context comes back, where it lay', async () => {
    const { onUnderlay, canvas } = renderScene();
    await ready(onUnderlay);
    const before = plane()!;
    fireEvent(canvas, new Event('webglcontextrestored'));
    await frames();
    const after = plane()!;
    expect(after).not.toBe(before);
    expect(after.position.x).toBeCloseTo(13, 6);
  });

  it('lets the decoded picture go when the map closes', async () => {
    const { onUnderlay, unmount } = renderScene();
    await ready(onUnderlay);
    unmount();
    expect(bitmap.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run it to see it fail**

Run: `npx vitest run "src/app/(admin)/site/editor/scene/underlay.scene.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL. `onUnderlay` is never called, because the engine does not draw a picture yet, so `ready()`'s `waitFor` times out.

- [ ] **Step 8: Wire the picture into the engine**

Read `src/app/(admin)/site/editor/scene/engine.ts` with the Read tool, all of it. Then make these edits, each at the text quoted.

1. **Imports.** Replace `import { findItem, rectOf, type EditorItem } from '@/lib/site/editor/model';` with:

```ts
import { findItem, rectOf, underlayOf, type EditorItem } from '@/lib/site/editor/model';
import { placeOps } from '@/lib/site/editor/underlay-commands';
```

After `import { SITE_KINDS, type SiteKindGroup } from '@/lib/site/kinds';` add:

```ts
import {
  imageToMap, isOnImage, mapToImage, moveBy, type ImagePoint, type MapPoint, type UnderlayPlacement,
} from '@/lib/site/underlay';
import { MAX_UNDERLAY_TEXTURE_PX, underlayUrl } from '@/lib/site/underlay-limits';
```

After `import { isShown, SceneSync } from './scene-sync';` add:

```ts
import { loadUnderlayImage, UNDERLAY_LIFT_CM, UnderlayLayer } from './underlay-mesh';
import { classifyPick, UnderlayGestures, type UnderlayIntent } from './underlay-tool';
```

2. **Fields.** Replace:

```ts
  private seen: { doc: unknown; selection: unknown; flags: unknown; ui: string; insets: string; tool: string } = {
    doc: null, selection: null, flags: null, ui: '', insets: '', tool: '',
  };
```

with:

```ts
  private seen: { doc: unknown; selection: unknown; flags: unknown; ui: string; insets: string; tool: string; marks: string } = {
    doc: null, selection: null, flags: null, ui: '', insets: '', tool: '', marks: '',
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
```

3. **Constructor.** Replace `      this.scene.add(this.hemisphere, this.light, this.light.target, this.sync.root);` with:

```ts
      this.scene.add(this.hemisphere, this.light, this.light.target, this.sync.root, this.underlay.root);
```

and replace `        tool: () => this.options.props().ui.tool,` with:

```ts
        // The picture's tools have their own pointer machine; to this one, they are the selection tool.
        tool: () => (this.options.props().ui.tool === 'measure' ? 'measure' : 'select'),
```

4. **`update()`.** Replace:

```ts
    const { store, ui, insets, sunDate } = this.options.props();
    const plot = store.doc.plot;
    // The plot's size is here for the light: its shadows cover the plot, so they follow a resize.
    const uiKey = [
      ui.tool, ui.labels, ui.sun, ui.netsHidden, ui.snap, ui.hiddenGroups.join(','), ui.hour, ui.theme, sunDate,
      plot.northDeg, plot.widthCm, plot.depthCm,
    ].join('|');
```

with:

```ts
    const { store, ui, insets, sunDate, underlayMarks } = this.options.props();
    const plot = store.doc.plot;
    // The plot's size is here for the light: its shadows cover the plot, so they follow a resize.
    const uiKey = [
      ui.tool, ui.labels, ui.sun, ui.netsHidden, ui.snap, ui.hiddenGroups.join(','), ui.hour, ui.theme, sunDate,
      plot.northDeg, plot.widthCm, plot.depthCm, ui.underlay.shown, ui.underlay.opacity,
    ].join('|');
    const marksKey = (underlayMarks ?? []).map(([u, v]) => `${u},${v}`).join(';');
```

After the block `if (insetsKey !== this.seen.insets) { … }` add:

```ts
    if (marksKey !== this.seen.marks) changed = true;
```

Replace:

```ts
    if (ui.tool !== this.seen.tool) {
      // The measure tool's crosshair; back to the plain arrow until the next hover says otherwise.
      this.canvas.style.cursor = ui.tool === 'measure' ? 'crosshair' : 'default';
    }
    this.seen = { doc: store.doc, selection: store.selection, flags: store.flags, ui: uiKey, insets: insetsKey, tool: ui.tool };
```

with:

```ts
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
      doc: store.doc, selection: store.selection, flags: store.flags, ui: uiKey, insets: insetsKey, tool: ui.tool, marks: marksKey,
    };
```

5. **`teardown()`.** Replace:

```ts
    window.removeEventListener('blur', this.onBlur);
    this.sync.dispose();
    if (this.ground !== null) disposeObject(this.ground);
```

with:

```ts
    window.removeEventListener('blur', this.onBlur);
    this.sync.dispose();
    this.underlay.dispose();
    if (this.ground !== null) disposeObject(this.ground);
```

6. **`SceneHandle`.** Before the line `  /* ── frames ─────────────────────────────────────────────────────────── */` add:

```ts
  /** The picture's card's "ניסיון נוסף": load the picture again after it failed or went missing. */
  retryUnderlay(): void {
    this.underlay.retry();
  }

```

7. **`syncScene()`.** Replace:

```ts
      sun: this.sunOn,
    });
  }
```

with:

```ts
      sun: this.sunOn,
    });
    const underlay = underlayOf(store.doc);
    this.underlay.sync({
      url: underlay === null ? null : underlayUrl(plot.id, underlay.storageKey),
      placement: this.underlayPreview ?? underlay,
      shown: ui.underlay.shown,
      opacity: ui.underlay.opacity,
    });
  }
```

8. **Where the picture is.** Before the line `  /** Eight handles on the ground around the one selected, unlocked, visible item — none while the camera flies. */` add:

```ts
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

```

9. **The marks.** In `overlayModel()`, before the loop `    for (const label of this.placed) {`, add:

```ts
    // Calibration marks (spec §18): the points marked so far while calibrating, the saved pair while the card is open.
    const marks = (this.options.props().underlayMarks ?? [])
      .map((point) => this.screenOfImagePoint(point))
      .filter((at): at is { x: number; y: number } => at !== null);
    if (marks.length === 2) {
      model.lines.push({ from: [marks[0].x, marks[0].y], to: [marks[1].x, marks[1].y], kind: 'measure' });
    }
    for (const at of marks) model.dots.push({ x: at.x, y: at.y, kind: 'measure' });
```

10. **The tools' intents.** Before the line `  /** The drag is over, however it ended: a view that was moving settles from now. */` add:

```ts
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
   * measure by — which the card says in Hebrew. Nothing while the picture is
   * still loading: there is nothing yet to mark.
   */
  private pickOnImage(x: number, y: number, ground: MapPoint): void {
    const props = this.options.props();
    const underlay = underlayOf(props.store.doc);
    const aspect = this.underlay.aspect;
    if (underlay === null || aspect === null) return;
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

```

11. **`abandon()`.** Replace:

```ts
    const open = this.gestures.active || this.preview.size > 0 || this.marquee !== null || this.guides.length > 0;
    if (!open) return;
    this.apply(this.gestures.cancel());
    this.marquee = null;
```

with:

```ts
    const open = this.gestures.active || this.preview.size > 0 || this.marquee !== null || this.guides.length > 0
      || this.underlayGestures.active || this.underlayPreview !== null;
    if (!open) return;
    this.apply(this.gestures.cancel());
    this.underlayGestures.cancel();
    this.underlayPreview = null;
    this.marquee = null;
```

(`clearPreview()`, called just after, marks the scene dirty, so a dropped picture preview is redrawn where the picture lies.)

12. **The pointer handlers.** In `onPointerDown`, replace:

```ts
    this.stopAnimation();
    this.apply(this.gestures.down(this.pointer(event)));
    if (!this.gestures.active) return;
```

with:

```ts
    this.stopAnimation();
    const input = this.pointer(event);
    if (this.underlayTool()) this.applyUnderlay(this.underlayGestures.down(input));
    else this.apply(this.gestures.down(input));
    if (!this.gestures.active && !this.underlayGestures.active) return;
```

In `onPointerMove`, replace `    this.apply(this.gestures.move(this.pointer(event)));` with:

```ts
    const input = this.pointer(event);
    if (this.underlayGestures.active || (this.underlayTool() && !this.gestures.active)) {
      this.applyUnderlay(this.underlayGestures.move(input));
    } else {
      this.apply(this.gestures.move(input));
    }
```

In `onPointerUp`, replace `    this.apply(this.gestures.up(this.pointer(event)));` with:

```ts
    const input = this.pointer(event);
    if (this.underlayGestures.active) this.applyUnderlay(this.underlayGestures.up(input));
    else this.apply(this.gestures.up(input));
```

In `onDoubleClick`, replace the first line of its body, `    const { x, y } = this.local(event);`, with:

```ts
    // Calibrating or aligning, a double-click is two clicks on the picture, not a flight to an item.
    if (this.underlayTool()) return;
    const { x, y } = this.local(event);
```

13. **Context restored.** In `onContextRestored`, replace `    this.scene.add(this.sync.root);` with:

```ts
    this.scene.add(this.sync.root);
    // The kept picture goes up again as a new texture (spec §19).
    this.underlay.rebuild();
```

Also extend the class's opening docblock sentence "…the overlay marks and the labels." to "…the overlay marks, the labels, and the picture under the map with its two tools."

- [ ] **Step 9: Run the engine test, and the scene tests that must not change**

Run: `npx vitest run "src/app/(admin)/site/editor/scene" "src/app/(admin)/site/editor/three-guard.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: exit 0, 0 failed.
- `underlay.scene.test.tsx`: 8 passed.
- `underlay-tool.test.ts`: 8 passed.
- `underlay-mesh.test.ts`: 14 passed.
- `scene-view.test.tsx`, `gestures.test.ts`, `scene-sync.test.ts`, `picking.test.ts`, `meshes.test.ts`, `camera-rig.test.ts` and `labels-layer.test.tsx`: as green as before this task.

Read the console's summary: a `pending` count above 0 with no `.skip` in these files means a worker died (`CLAUDE.md`). Rerun when the box is quiet.

Then prove the click-through test can fail. In `onPointerDown`, temporarily make the first branch `if (true)` and re-run `underlay.scene.test.tsx`. Expected: "lets clicks through in the selection tool…" fails, because the tent is not selected. Restore it: 8 passed.

- [ ] **Step 10: Typecheck, lint, commit**

Run: `npx tsc --noEmit`. Expected: exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor/scene" "src/app/(admin)/site/editor/site-editor.tsx"`. Expected: no problems.

```bash
git add "src/app/(admin)/site/editor/scene/underlay-tool.ts" "src/app/(admin)/site/editor/scene/underlay-tool.test.ts" "src/app/(admin)/site/editor/scene/engine.ts" "src/app/(admin)/site/editor/scene/scene-view.tsx" "src/app/(admin)/site/editor/scene/scene-view.test.tsx" "src/app/(admin)/site/editor/scene/underlay.scene.test.tsx" "src/app/(admin)/site/editor/site-editor.tsx"
git commit -m "feat(site): the picture in the scene — calibration and alignment tools, click-through otherwise, rebuilt after a lost context

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The upload in the browser, and the picture's card

**Files:**
- Create: `src/app/(admin)/site/editor/underlay-upload.ts`, `src/app/(admin)/site/editor/underlay-upload.test.ts`
- Create: `src/app/(admin)/site/editor/panels/underlay-card.tsx`, `panels/underlay-card.module.css`, `panels/underlay-card.test.tsx`

**Interfaces:**
- Consumes:
  - `checkUnderlayFile` (Task 1); `uploadRefusalHe`, `UPLOAD_FAILED_HE`, `uploadUrl`, `underlayKeyPlan`, `contentTypeOf`, `MAX_UNDERLAY_BYTES`, `UNDERLAY_RULES_HE` (Task 1);
  - `UploadedUnderlay` (Task 3); `EditorUnderlay` (Task 3); `coverSize`, `ImagePoint` (Task 2);
  - `UnderlayStatus` (Task 6); `EditorUi` (Task 7);
  - `formatMetres`, `formatSize` (`geometry.ts`); `Button`, `Icon`, `cx`, `EditorIcon`, `panel.module.css`.
- Produces:
  - `underlay-upload.ts`: `type UploadOutcome = { ok: true; file: UploadedUnderlay } | { ok: false; error: string }`; `interface UploadDeps { fetch; decode }`; `uploadUnderlay(file: File, planId: string, deps?: UploadDeps): Promise<UploadOutcome>`. It never throws, and every error is Hebrew.
  - `panels/underlay-card.tsx`: `interface CalibrationDraft { points: ImagePoint[]; refusal: string | null }`; `interface UnderlayCardProps { underlay; status; view; tool; sending; uploadError; draft; onFile; onCalibrate; onApplyCalibration(distanceText, parallel); onCancelCalibration; onAlign; onFinishAlign; onTurn(direction); onOpacity(opacity); onRemove; onRetry; onClose }`; `UnderlayCard(props): ReactElement`.

- [ ] **Step 1: Write the failing upload test**

Create `src/app/(admin)/site/editor/underlay-upload.test.ts`. It runs in Node, which has `File`, `FormData` and `Response`. The route and the decoder are handed in.

```ts
import { describe, it, expect, vi } from 'vitest';
import { uploadUnderlay, type UploadDeps } from './underlay-upload';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const OTHER = '5e1d2c3b-4a59-4876-9e0f-a1b2c3d4e5f6';
const KEY = `site-underlays/${PLAN}/${'a'.repeat(64)}.png`;
const FAILED = 'ההעלאה נכשלה. אפשר לנסות שוב.';

function bytes(...parts: Array<number[] | string>): number[] {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (let i = 0; i < part.length; i += 1) out.push(part.charCodeAt(i));
    else out.push(...part);
  }
  return out;
}
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
function png(width: number, height: number, padTo = 64): Uint8Array {
  const header = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(width), be32(height), [8, 6, 0, 0, 0]);
  const out = new Uint8Array(Math.max(padTo, header.length));
  out.set(header);
  return out;
}
const file = (data: Uint8Array, name: string) => new File([data], name);
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function deps(answer: () => Promise<Response>) {
  const fetch = vi.fn<UploadDeps['fetch']>(answer);
  const decode = vi.fn<UploadDeps['decode']>(async () => {});
  return { fetch, decode };
}

describe('sending a picture from the card', () => {
  it('checks it, proves the browser can show it, sends it to the map’s own address, and answers the stored file', async () => {
    const stored = { storageKey: KEY, contentType: 'image/png', sizeBytes: 64, filename: 'שרטוט.png' };
    const route = deps(async () => json(stored, 201));
    const sketch = file(png(1600, 1200), 'שרטוט.png');
    expect(await uploadUnderlay(sketch, PLAN, route)).toEqual({ ok: true, file: stored });
    expect(route.decode).toHaveBeenCalledWith(sketch);
    const [url, init] = route.fetch.mock.calls[0];
    expect(url).toBe(`/site/underlay/${PLAN}`);
    expect(init.method).toBe('POST');
    expect(((init.body as FormData).get('file') as File).name).toBe('שרטוט.png');
  });

  it('refuses in Hebrew before sending anything: a PDF, an iPhone photo, too many bytes, too few pixels', async () => {
    for (const [data, name, said] of [
      [Uint8Array.from(bytes('%PDF-1.7\n')), 'plan.pdf', 'קובץ PDF אי אפשר להעלות כרקע. צילום מסך של העמוד יעבוד.'],
      [Uint8Array.from(bytes(be32(24), 'ftyp', 'heic', be32(0), 'mif1', 'heic')), 'IMG_0001.HEIC',
        'הדפדפן לא מציג תמונות HEIC (ברירת המחדל של מצלמת האייפון). שמירה כ־JPEG, או צילום מסך, יעבדו.'],
      [png(1600, 1200, 4 * 1024 * 1024 + 1), 'big.png', 'התמונה גדולה מדי — עד 4 מגה־בייט.'],
      [png(80, 1200), 'thin.png', 'התמונה קטנה מדי — לפחות 100 פיקסלים בכל צד.'],
    ] as const) {
      const route = deps(async () => json({}, 201));
      expect(await uploadUnderlay(file(data, name), PLAN, route)).toEqual({ ok: false, error: said });
      expect(route.fetch).not.toHaveBeenCalled();
      expect(route.decode).not.toHaveBeenCalled();
    }
  });

  it('says the upload failed when the browser cannot show the picture, and sends nothing', async () => {
    const route = deps(async () => json({}, 201));
    route.decode.mockRejectedValueOnce(new Error('The source image could not be decoded.'));
    expect(await uploadUnderlay(file(png(1600, 1200), 'a.png'), PLAN, route)).toEqual({ ok: false, error: FAILED });
    expect(route.fetch).not.toHaveBeenCalled();
  });

  it('turns every refusal the route answers into its Hebrew, and an unknown one into the fallback', async () => {
    for (const [code, status, said] of [
      ['unauthorized', 401, 'אין הרשאה להעלות קבצים.'],
      ['unknown plan', 404, 'לא מצאנו את המפה הזו — אולי נמחקה בינתיים'],
      ['storage unavailable', 503, 'לא הצלחנו לשמור את התמונה. אפשר לנסות שוב.'],
      ['import failed', 422, FAILED],
    ] as const) {
      const outcome = await uploadUnderlay(file(png(1600, 1200), 'a.png'), PLAN, deps(async () => json({ error: code }, status)));
      expect(outcome).toEqual({ ok: false, error: said });
    }
  });

  it('treats a sign-in page as a failure, never as a stored picture (Review Focus #3)', async () => {
    // An expired session: the proxy redirects the POST to /signin, which answers 200 with a page.
    const signIn = deps(async () => new Response('<!doctype html><html lang="he"><body>כניסה</body></html>', {
      status: 200, headers: { 'Content-Type': 'text/html' },
    }));
    expect(await uploadUnderlay(file(png(1600, 1200), 'a.png'), PLAN, signIn)).toEqual({ ok: false, error: FAILED });
  });

  it('refuses an answer that names another map’s file, a type its name does not carry, or no file', async () => {
    for (const body of [
      { storageKey: `site-underlays/${OTHER}/${'a'.repeat(64)}.png`, contentType: 'image/png', sizeBytes: 64, filename: 'a.png' },
      { storageKey: KEY, contentType: 'image/jpeg', sizeBytes: 64, filename: 'a.png' },
      { storageKey: KEY, contentType: 'image/png', sizeBytes: 0, filename: 'a.png' },
      { storageKey: KEY, contentType: 'image/png', sizeBytes: 64, filename: '' },
      {},
    ]) {
      expect(await uploadUnderlay(file(png(1600, 1200), 'a.png'), PLAN, deps(async () => json(body, 201))))
        .toEqual({ ok: false, error: FAILED });
    }
  });

  it('says the upload failed when no answer came at all', async () => {
    const offline = deps(async () => { throw new TypeError('Failed to fetch'); });
    expect(await uploadUnderlay(file(png(1600, 1200), 'a.png'), PLAN, offline)).toEqual({ ok: false, error: FAILED });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run "src/app/(admin)/site/editor/underlay-upload.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL, because `./underlay-upload` cannot be resolved.

- [ ] **Step 3: Write `underlay-upload.ts`**

Create `src/app/(admin)/site/editor/underlay-upload.ts`:

```ts
import type { UploadedUnderlay } from '@/lib/site/editor/underlay-commands';
import { checkUnderlayFile } from '@/lib/site/underlay-file';
import {
  MAX_UNDERLAY_BYTES, UPLOAD_FAILED_HE, contentTypeOf, underlayKeyPlan, uploadRefusalHe, uploadUrl,
} from '@/lib/site/underlay-limits';

/**
 * Sending a picture from the card (spec §18.1). First the checks the route
 * will make — type, size, pixels — so a refusal needs no round trip. Then one
 * small decode, to be sure this browser can show the picture at all. Then
 * the POST. Nothing here throws, and every failure is a Hebrew sentence, so
 * the card never shows English and never hangs on "מעלה…".
 *
 * Only a 201 carrying a well-formed answer is a stored picture. An expired
 * session is redirected by the proxy to the sign-in page, which answers 200
 * with HTML (Review Focus #3). Taking "ok" for success would put a picture
 * with no file on the map.
 */

export type UploadOutcome = { ok: true; file: UploadedUnderlay } | { ok: false; error: string };

export interface UploadDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** Proves the browser can show the picture. Decoded small: the check needs no pixels kept. */
  decode: (file: Blob) => Promise<void>;
}

async function decodeOnce(file: Blob): Promise<void> {
  const bitmap = await createImageBitmap(file, { resizeWidth: 64, resizeQuality: 'low' });
  bitmap.close();
}

const BROWSER: UploadDeps = { fetch: (input, init) => fetch(input, init), decode: decodeOnce };

/** A JSON body, without assuming there is one: an HTML page, or nothing, reads as `{}`. */
async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body !== null && typeof body === 'object' ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** The route's answer as a stored file of this map, or null when it is not one. */
function storedFile(body: Record<string, unknown>, planId: string): UploadedUnderlay | null {
  const { storageKey, contentType, sizeBytes, filename } = body;
  if (typeof storageKey !== 'string' || underlayKeyPlan(storageKey) !== planId) return null;
  const type = contentTypeOf(storageKey);
  if (type === null || contentType !== type) return null;
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_UNDERLAY_BYTES) return null;
  if (typeof filename !== 'string' || filename.trim() === '') return null;
  return { storageKey, contentType: type, sizeBytes, filename };
}

export async function uploadUnderlay(file: File, planId: string, deps: UploadDeps = BROWSER): Promise<UploadOutcome> {
  const failed: UploadOutcome = { ok: false, error: UPLOAD_FAILED_HE };

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return failed;
  }
  const check = checkUnderlayFile(file.name, bytes);
  if (!check.ok) return { ok: false, error: uploadRefusalHe(check.code) };

  try {
    await deps.decode(file);
  } catch {
    return failed;
  }

  const form = new FormData();
  form.set('file', file);
  let response: Response;
  try {
    response = await deps.fetch(uploadUrl(planId), { method: 'POST', body: form });
  } catch {
    return failed; // offline, aborted, DNS
  }
  const body = await readJson(response);
  if (response.status !== 201) return { ok: false, error: uploadRefusalHe(body.error) };
  const stored = storedFile(body, planId);
  return stored === null ? failed : { ok: true, file: stored };
}
```

- [ ] **Step 4: Run the upload test**

Run the Step 2 command. Expected: 7 passed, exit 0.

Then prove Review Focus #3's test can fail. Temporarily change `if (response.status !== 201)` to `if (!response.ok)` and delete the `storedFile` check, returning `{ ok: true, file: body as unknown as UploadedUnderlay }` instead. Re-run. Expected: "treats a sign-in page as a failure…" fails. Restore both: 7 passed.

- [ ] **Step 5: Write the failing card test**

Create `src/app/(admin)/site/editor/panels/underlay-card.test.tsx`. Every sentence is spec §20's. `⁦`…`⁩` isolate a number inside a sentence, as the component writes it.

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { unnamedControls } from '@/test/a11y';
import type { EditorUnderlay } from '@/lib/site/editor/model';
import { UnderlayCard, type UnderlayCardProps } from './underlay-card';

const LRI = '⁦';
const PDI = '⁩';
const IMAGE: EditorUnderlay = {
  storageKey: `site-underlays/0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a/${'a'.repeat(64)}.png`, contentType: 'image/png',
  sizeBytes: 812_345, filename: 'שרטוט המגרש.png', centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0, calibration: null,
};
const CALIBRATED: EditorUnderlay = { ...IMAGE, calibration: { from: [0.1, 0.5], to: [0.9, 0.5], distanceCm: 2600 } };

function renderCard(over: Partial<UnderlayCardProps> = {}) {
  const props: UnderlayCardProps = {
    underlay: IMAGE, status: { state: 'ready', aspect: 0.75 }, view: { shown: true, opacity: 0.5 }, tool: 'select',
    sending: false, uploadError: null, draft: { points: [], refusal: null },
    onFile: vi.fn(), onCalibrate: vi.fn(), onApplyCalibration: vi.fn(), onCancelCalibration: vi.fn(), onAlign: vi.fn(),
    onFinishAlign: vi.fn(), onTurn: vi.fn(), onOpacity: vi.fn(), onRemove: vi.fn(), onRetry: vi.fn(), onClose: vi.fn(),
    ...over,
  };
  const view = render(<UnderlayCard {...props} />);
  return { ...view, props, rerenderWith: (next: Partial<UnderlayCardProps>) => { view.rerender(<UnderlayCard {...props} {...next} />); } };
}

const button = (name: string) => screen.getByRole('button', { name });
const fileInput = (container: HTMLElement) => container.querySelector('input[type="file"]') as HTMLInputElement;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the picture’s card', () => {
  it('invites an upload when the map has no picture, by its button or by a drop', () => {
    const picked = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const { container, props } = renderCard({ underlay: null, status: { state: 'none' } });
    expect(screen.getByText('אפשר להעלות צילום או סריקה של שרטוט המגרש ולהניח עליו את הפריטים ביד. אחרי ההעלאה, סימון של מרחק ידוע על התמונה — למשל אורך הגדר — קובע את קנה המידה. צילום ישר מלמעלה, או סריקה, ייתנו את התוצאה המדויקת ביותר.')).toBeTruthy();
    expect(screen.getByText('PNG,‏ JPEG או WebP, עד 4 מגה־בייט')).toBeTruthy();
    fireEvent.click(button('העלאת תמונה'));
    expect(picked).toHaveBeenCalled();
    const sketch = new File(['x'], 'sketch.png', { type: 'image/png' });
    fireEvent.change(fileInput(container), { target: { files: [sketch] } });
    expect(props.onFile).toHaveBeenLastCalledWith(sketch);
    const dropped = new File(['y'], 'scan.jpg', { type: 'image/jpeg' });
    fireEvent.drop(screen.getByRole('group', { name: 'תמונת רקע' }), { dataTransfer: { files: [dropped] } });
    expect(props.onFile).toHaveBeenLastCalledWith(dropped);
  });

  it('says it is uploading, and why an upload was refused', () => {
    const { rerenderWith } = renderCard({ underlay: null, sending: true });
    expect(screen.getByRole('status').textContent).toBe('מעלה…');
    expect(screen.queryByRole('button', { name: 'העלאת תמונה' })).toBeNull();
    rerenderWith({ underlay: null, sending: false, uploadError: 'קובץ PDF אי אפשר להעלות כרקע. צילום מסך של העמוד יעבוד.' });
    expect(screen.getByRole('alert').textContent).toBe('קובץ PDF אי אפשר להעלות כרקע. צילום מסך של העמוד יעבוד.');
  });

  it('says it is loading the picture, and offers no calibration or moving until it can be shown', () => {
    renderCard({ status: { state: 'loading' } });
    expect(screen.getByText('טוען…')).toBeTruthy();
    expect((button('כיול') as HTMLButtonElement).disabled).toBe(true);
    expect((button('הזזה') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a picture could not be shown and offers a retry, and says a missing file can be uploaded again', () => {
    const { props, rerenderWith } = renderCard({ status: { state: 'failed' } });
    expect(screen.getByRole('alert').textContent).toBe('לא הצלחנו להציג את התמונה. אפשר לנסות שוב, או להעלות אותה מחדש.');
    fireEvent.click(button('ניסיון נוסף'));
    expect(props.onRetry).toHaveBeenCalled();
    rerenderWith({ status: { state: 'missing' } });
    expect(screen.getByRole('alert').textContent).toBe('קובץ התמונה לא נמצא. אפשר להעלות אותו מחדש.');
  });

  it('says an uncalibrated picture’s scale is temporary, and every scale figure opens the calibration', () => {
    const { props } = renderCard();
    expect(screen.getByText('שרטוט המגרש.png')).toBeTruthy();
    expect(screen.getByText('לא כוילה')).toBeTruthy();
    expect(screen.getByText('קנה המידה זמני עד הכיול.')).toBeTruthy();
    fireEvent.click(button('כיול'));
    fireEvent.click(button(`מכסה על המפה ${LRI}26 × 19.5 מ׳${PDI}`));
    expect(props.onCalibrate).toHaveBeenCalledTimes(2);
    expect(screen.getByText('כשהתמונה מוצגת, היא נכללת גם בייצוא התמונה של המפה.')).toBeTruthy();
  });

  it('says what a calibrated picture was calibrated from, and offers to calibrate again', () => {
    const { props } = renderCard({ underlay: CALIBRATED });
    expect(screen.getByText(`כויל לפי ${LRI}26 מ׳${PDI} שסומנו על התמונה`)).toBeTruthy();
    expect(screen.queryByText('לא כוילה')).toBeNull();
    fireEvent.click(button('כיול מחדש'));
    expect(props.onCalibrate).toHaveBeenCalled();
    expect(screen.getByText('הכיול יתחיל מחדש')).toBeTruthy();
  });

  it('sets this viewer’s opacity, from 10% to 100% in tens', () => {
    const { props } = renderCard();
    const slider = screen.getByRole('slider', { name: 'שקיפות' }) as HTMLInputElement;
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual(['10', '100', '10', '50']);
    expect(slider.getAttribute('aria-valuetext')).toBe('50%');
    expect(screen.getByText(`שקיפות ${LRI}50%${PDI}`)).toBeTruthy();
    fireEvent.change(slider, { target: { value: '30' } });
    expect(props.onOpacity).toHaveBeenCalledWith(0.3);
  });

  it('moves, replaces and removes the picture', () => {
    const picked = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const { props } = renderCard();
    fireEvent.click(button('הזזה'));
    expect(props.onAlign).toHaveBeenCalled();
    fireEvent.click(button('החלפת תמונה'));
    expect(picked).toHaveBeenCalled();
    fireEvent.click(button('הסרת התמונה'));
    expect(props.onRemove).toHaveBeenCalled();
  });

  it('walks the calibration: the first point, the second, then the distance and the parallel box', () => {
    const { props, rerenderWith } = renderCard({ tool: 'calibrate' });
    expect(screen.getByRole('status').textContent).toBe('סימון הנקודה הראשונה על התמונה');
    expect(screen.getByText('הכיול נעשה בתצוגת תוכנית.')).toBeTruthy();
    rerenderWith({ tool: 'calibrate', draft: { points: [[0.1, 0.5]], refusal: null } });
    expect(screen.getByRole('status').textContent).toBe('סימון הנקודה השנייה');
    rerenderWith({ tool: 'calibrate', draft: { points: [[0.1, 0.5], [0.9, 0.5]], refusal: null } });
    fireEvent.change(screen.getByLabelText('המרחק בין שתי הנקודות, במטרים'), { target: { value: '26' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'הקו הזה מקביל לגדר' }));
    fireEvent.click(button('כיול'));
    expect(props.onApplyCalibration).toHaveBeenCalledWith('26', true);
    fireEvent.click(button('ביטול'));
    expect(props.onCancelCalibration).toHaveBeenCalled();
  });

  it('shows a calibration refusal in Hebrew, beside the distance it is about', () => {
    renderCard({ tool: 'calibrate', draft: { points: [[0.1, 0.5], [0.12, 0.5]], refusal: 'שתי הנקודות קרובות מדי זו לזו. מרחק ארוך, כמו צלע של הגדר, נותן כיול מדויק יותר.' } });
    expect(screen.getByRole('alert').textContent).toBe('שתי הנקודות קרובות מדי זו לזו. מרחק ארוך, כמו צלע של הגדר, נותן כיול מדויק יותר.');
    expect(screen.getByLabelText('המרחק בין שתי הנקודות, במטרים').getAttribute('aria-invalid')).toBe('true');
  });

  it('aligns: a quarter turn either way, and done', () => {
    const { props } = renderCard({ tool: 'align' });
    expect(screen.getByText('גרירה מזיזה את התמונה · החצים — 10 ס״מ, עם Shift — מטר · Esc — סיום')).toBeTruthy();
    fireEvent.click(button('סיבוב רבע ימינה'));
    fireEvent.click(button('סיבוב רבע שמאלה'));
    expect(props.onTurn).toHaveBeenNthCalledWith(1, 1);
    expect(props.onTurn).toHaveBeenNthCalledWith(2, -1);
    fireEvent.click(button('סיום'));
    expect(props.onFinishAlign).toHaveBeenCalled();
  });

  it('closes', () => {
    const { props } = renderCard();
    fireEvent.click(button('סגירה'));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('names every control, and writes no Latin but the formats and keys spec §20 names', () => {
    for (const over of [
      { underlay: null, status: { state: 'none' } },
      {},
      { underlay: CALIBRATED },
      { status: { state: 'failed' } },
      { tool: 'calibrate', draft: { points: [[0.1, 0.5], [0.9, 0.5]], refusal: null } },
      { tool: 'align' },
    ] as Array<Partial<UnderlayCardProps>>) {
      const { container, unmount } = renderCard(over);
      expect(unnamedControls(container)).toEqual([]);
      // The file's own name ("שרטוט המגרש.png") is the lead's data, not copy: its extension is let through too.
      const latin = (container.textContent ?? '').match(/[A-Za-z]+/g) ?? [];
      expect(latin.filter((word) => !['PNG', 'JPEG', 'WebP', 'Shift', 'Esc', 'png'].includes(word))).toEqual([]);
      unmount();
    }
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run "src/app/(admin)/site/editor/panels/underlay-card.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL, because `./underlay-card` cannot be resolved.

- [ ] **Step 7: Write the card**

Create `src/app/(admin)/site/editor/panels/underlay-card.module.css`:

```css
/*
 * The picture's card (spec §18, §20): its width, its rows and its form. The
 * card itself, the hint, meta and invitation lines and the links are the
 * shared `panel.module.css` (ruling W10).
 *
 * Tokens only, logical properties throughout (A10).
 */

.card { inline-size: 360px; }

/* A file dragged over the card: where it will land. */
.over {
  outline: 2px dashed var(--focus);
  outline-offset: -4px;
}

.title {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-dense);
  font-weight: 600;
}

.filename {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-meta);
  overflow-wrap: anywhere;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.badge {
  display: inline-flex;
  align-items: center;
  block-size: 20px;
  padding-inline: 8px;
  border-radius: var(--radius-pill);
  background: var(--warn-soft);
  color: var(--ink);
  font-size: var(--text-label);
  font-weight: 600;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  color: var(--ink-3);
  font-size: var(--text-label);
}

.input {
  inline-size: 100%;
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

/* A typed figure reads left to right whatever the page's direction (A11). */
.number {
  direction: ltr;
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-2);
  font-size: var(--text-meta);
}

.opacity {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink-2);
  font-size: var(--text-meta);
}
.opacity input {
  flex: 1;
  accent-color: var(--brand);
}

.error {
  margin: 0;
  color: var(--bad);
  font-size: var(--text-meta);
}

/* The file picker the buttons open: never shown, never tabbed to. */
.file { display: none; }
```

Create `src/app/(admin)/site/editor/panels/underlay-card.tsx`:

```tsx
'use client';

/**
 * תמונת רקע (spec §18, §20): the card for the picture under the map. It
 * shows one of these, in this order:
 * - an upload under way;
 * - an invitation, with no picture;
 * - the calibration steps, while calibrating;
 * - the alignment tool, while aligning;
 * - otherwise the picture: its file, whether it shows, its scale (temporary
 *   until calibrated), what it covers, how see-through it is for this viewer,
 *   and the ways to move, replace or remove it.
 *
 * Every figure that is a scale opens the calibration, because a figure links
 * to what changes it. A file can be dropped anywhere on the card. It says
 * that a shown picture goes into the map's PNG export.
 *
 * Presentational: `SiteEditor`'s `useUnderlay` holds the state and does the
 * work.
 */

import { useId, useRef, useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import type { EditorUnderlay } from '@/lib/site/editor/model';
import { formatMetres, formatSize } from '@/lib/site/geometry';
import { coverSize, type ImagePoint } from '@/lib/site/underlay';
import { UNDERLAY_RULES_HE } from '@/lib/site/underlay-limits';
import type { EditorUi } from '../scene/scene-view';
import type { UnderlayStatus } from '../scene/underlay-mesh';
import { EditorIcon } from './editor-icons';
import chrome from './panel.module.css';
import styles from './underlay-card.module.css';

/** Where a calibration stands: the points marked so far on the picture, in order, and the last refusal in Hebrew. */
export interface CalibrationDraft {
  points: ImagePoint[];
  refusal: string | null;
}

export interface UnderlayCardProps {
  underlay: EditorUnderlay | null;
  status: UnderlayStatus;
  view: EditorUi['underlay'];
  tool: EditorUi['tool'];
  sending: boolean;
  uploadError: string | null;
  draft: CalibrationDraft;
  onFile: (file: File) => void;
  onCalibrate: () => void;
  onApplyCalibration: (distanceText: string, parallel: boolean) => void;
  onCancelCalibration: () => void;
  onAlign: () => void;
  onFinishAlign: () => void;
  onTurn: (direction: 1 | -1) => void;
  onOpacity: (opacity: number) => void;
  onRemove: () => void;
  onRetry: () => void;
  onClose: () => void;
}

/** Bidi isolates (LRI…PDI) around a number inside a Hebrew sentence (spec §20). */
const isolate = (text: string) => `⁦${text}⁩`;

const INVITATION = 'אפשר להעלות צילום או סריקה של שרטוט המגרש ולהניח עליו את הפריטים ביד. אחרי ההעלאה, סימון של מרחק ידוע על התמונה — למשל אורך הגדר — קובע את קנה המידה. צילום ישר מלמעלה, או סריקה, ייתנו את התוצאה המדויקת ביותר.';

export function UnderlayCard(props: UnderlayCardProps): ReactElement {
  const { underlay, sending, uploadError, tool } = props;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const choose = () => { input.current?.click(); };

  let body: ReactElement;
  if (sending) {
    body = <p className={chrome.hint} role="status">מעלה…</p>;
  } else if (underlay === null) {
    body = <Invitation onChoose={choose} />;
  } else if (tool === 'calibrate') {
    body = <Calibration draft={props.draft} onApply={props.onApplyCalibration} onCancel={props.onCancelCalibration} />;
  } else if (tool === 'align') {
    body = <Alignment onTurn={props.onTurn} onFinish={props.onFinishAlign} />;
  } else {
    body = <Picture {...props} underlay={underlay} onChoose={choose} />;
  }

  return (
    <div
      className={cx(chrome.card, styles.card, over && styles.over)}
      role="group"
      aria-label="תמונת רקע"
      data-panel="true"
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => { setOver(false); }}
      onDrop={(event) => {
        // Without preventDefault the browser leaves the map to open the file.
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer.files[0] as File | undefined;
        if (file !== undefined) props.onFile(file);
      }}
    >
      <div className={chrome.cardHead}>
        <h2 className={styles.title}>תמונת רקע</h2>
        <Button tone="ghost" size="sm" iconLabel="סגירה" onClick={props.onClose}>
          <Icon name="x" size={14} />
        </Button>
      </div>
      {body}
      {uploadError === null ? null : <p className={styles.error} role="alert">{uploadError}</p>}
      <input
        ref={input}
        type="file"
        className={styles.file}
        accept="image/png,image/jpeg,image/webp"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) props.onFile(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}

function Invitation({ onChoose }: { onChoose: () => void }): ReactElement {
  return (
    <>
      <p className={chrome.invite}>{INVITATION}</p>
      <div className={styles.actions}>
        <Button size="sm" tone="primary" onClick={onChoose}>
          <Icon name="upload" size={14} />
          העלאת תמונה
        </Button>
      </div>
      <p className={chrome.meta}>{UNDERLAY_RULES_HE}</p>
    </>
  );
}

function Picture(props: UnderlayCardProps & { underlay: EditorUnderlay; onChoose: () => void }): ReactElement {
  const { underlay, status, view } = props;
  const ready = status.state === 'ready';
  const percent = Math.round(view.opacity * 100);
  const { calibration } = underlay;
  const cover = status.state === 'ready' ? coverSize(underlay, status.aspect) : null;

  return (
    <>
      <p className={styles.filename}><bdi>{underlay.filename}</bdi></p>
      {status.state === 'loading' ? <p className={chrome.hint} role="status">טוען…</p> : null}
      {status.state === 'failed' ? (
        <div className={styles.row}>
          <p className={styles.error} role="alert">לא הצלחנו להציג את התמונה. אפשר לנסות שוב, או להעלות אותה מחדש.</p>
          <Button size="sm" onClick={props.onRetry}>ניסיון נוסף</Button>
        </div>
      ) : null}
      {status.state === 'missing' ? (
        <p className={styles.error} role="alert">קובץ התמונה לא נמצא. אפשר להעלות אותו מחדש.</p>
      ) : null}

      {calibration === null ? (
        <div className={styles.row}>
          <span className={styles.badge}>לא כוילה</span>
          <span className={chrome.hint}>קנה המידה זמני עד הכיול.</span>
          <Button size="sm" tone="primary" disabled={!ready} onClick={props.onCalibrate}>כיול</Button>
        </div>
      ) : (
        <p className={chrome.meta}>
          <span>{`כויל לפי ${isolate(formatMetres(calibration.distanceCm))} שסומנו על התמונה`}</span>
          {' · '}
          <button type="button" className={chrome.link} disabled={!ready} onClick={props.onCalibrate}>כיול מחדש</button>
        </p>
      )}
      {cover === null ? null : (
        <p className={chrome.meta}>
          <button type="button" className={chrome.link} onClick={props.onCalibrate}>
            {`מכסה על המפה ${isolate(formatSize(cover.widthCm, cover.depthCm))}`}
          </button>
        </p>
      )}

      <label className={styles.opacity}>
        <span>{`שקיפות ${isolate(`${percent}%`)}`}</span>
        <input
          type="range"
          min={10}
          max={100}
          step={10}
          value={percent}
          aria-label="שקיפות"
          aria-valuetext={`${percent}%`}
          onChange={(event) => { props.onOpacity(Number(event.target.value) / 100); }}
        />
      </label>

      <div className={styles.actions}>
        <Button size="sm" disabled={!ready} onClick={props.onAlign}>הזזה</Button>
        <Button size="sm" onClick={props.onChoose}>החלפת תמונה</Button>
        <Button size="sm" tone="danger" onClick={props.onRemove}>הסרת התמונה</Button>
      </div>
      {calibration === null ? null : <p className={chrome.meta}>הכיול יתחיל מחדש</p>}
      <p className={chrome.meta}>כשהתמונה מוצגת, היא נכללת גם בייצוא התמונה של המפה.</p>
    </>
  );
}

function Calibration({ draft, onApply, onCancel }: {
  draft: CalibrationDraft;
  onApply: (distanceText: string, parallel: boolean) => void;
  onCancel: () => void;
}): ReactElement {
  const [distance, setDistance] = useState('');
  const [parallel, setParallel] = useState(false);
  const distanceId = useId();
  const refusalId = useId();
  const step = draft.points.length === 0 ? 'סימון הנקודה הראשונה על התמונה'
    : draft.points.length === 1 ? 'סימון הנקודה השנייה' : null;

  return (
    <>
      {step !== null ? (
        <>
          <p className={chrome.hint} role="status">{step}</p>
          <div className={styles.actions}>
            <Button size="sm" tone="ghost" onClick={onCancel}>ביטול</Button>
          </div>
        </>
      ) : (
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); onApply(distance, parallel); }}>
          <label htmlFor={distanceId} className={styles.label}>המרחק בין שתי הנקודות, במטרים</label>
          <input
            id={distanceId}
            className={cx(styles.input, styles.number)}
            inputMode="decimal"
            autoComplete="off"
            value={distance}
            aria-invalid={draft.refusal !== null}
            aria-describedby={draft.refusal === null ? undefined : refusalId}
            onChange={(event) => { setDistance(event.target.value); }}
          />
          <label className={styles.check}>
            <input type="checkbox" checked={parallel} onChange={(event) => { setParallel(event.target.checked); }} />
            הקו הזה מקביל לגדר
          </label>
          <div className={styles.actions}>
            <Button size="sm" tone="primary" type="submit">כיול</Button>
            <Button size="sm" tone="ghost" onClick={onCancel}>ביטול</Button>
          </div>
        </form>
      )}
      <p className={chrome.meta}>הכיול נעשה בתצוגת תוכנית.</p>
      {draft.refusal === null ? null : <p id={refusalId} className={styles.error} role="alert">{draft.refusal}</p>}
    </>
  );
}

function Alignment({ onTurn, onFinish }: { onTurn: (direction: 1 | -1) => void; onFinish: () => void }): ReactElement {
  return (
    <>
      <p className={chrome.hint}>גרירה מזיזה את התמונה · החצים — 10 ס״מ, עם Shift — מטר · Esc — סיום</p>
      <div className={styles.actions}>
        <Button size="sm" onClick={() => { onTurn(1); }}>
          <EditorIcon name="rotateRight" size={14} />
          סיבוב רבע ימינה
        </Button>
        <Button size="sm" onClick={() => { onTurn(-1); }}>
          <EditorIcon name="rotateLeft" size={14} />
          סיבוב רבע שמאלה
        </Button>
        <Button size="sm" tone="primary" onClick={onFinish}>סיום</Button>
      </div>
    </>
  );
}
```

- [ ] **Step 8: Run the card test, and the repo's copy and accessibility sweeps**

Run: `npx vitest run "src/app/(admin)/site/editor/panels/underlay-card.test.tsx" "src/app/(admin)/copy-sweep.test.tsx" "src/app/(admin)/a11y-sweep.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: exit 0, 0 failed. `underlay-card.test.tsx` gives 13 passed. The copy sweep finds no English sentence in the new files: every string that names a format or a key also carries Hebrew.

If the test reports a text it cannot find because the accessible name of a button drops the isolate characters, match that one button by a regular expression on its visible words, for example `/מכסה על המפה/`. Do not remove the isolates from the component: spec §20 asks for them.

- [ ] **Step 9: Typecheck, lint, commit**

Run: `npx tsc --noEmit`. Expected: exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor/underlay-upload.ts" "src/app/(admin)/site/editor/underlay-upload.test.ts" "src/app/(admin)/site/editor/panels/underlay-card.tsx" "src/app/(admin)/site/editor/panels/underlay-card.test.tsx"`. Expected: no problems.

```bash
git add "src/app/(admin)/site/editor/underlay-upload.ts" "src/app/(admin)/site/editor/underlay-upload.test.ts" "src/app/(admin)/site/editor/panels/underlay-card.tsx" "src/app/(admin)/site/editor/panels/underlay-card.module.css" "src/app/(admin)/site/editor/panels/underlay-card.test.tsx"
git commit -m "feat(site): the picture's card, and its upload — checked first, never a sign-in page taken for a file

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The picture in the editor — its row, its toggle, its card, its keys

**Files:**
- Create: `src/app/(admin)/site/editor/use-underlay.ts`
- Modify: `src/app/(admin)/site/editor/site-editor.tsx`
- Modify: `src/app/(admin)/site/editor/panels/toolbar.tsx`, `src/app/(admin)/site/editor/panels/inspector-plot.tsx`
- Modify: `src/app/(admin)/site/editor/editor.module.css` (one comment; no rule changes)
- Create: `src/app/(admin)/site/editor/site-editor.underlay.test.tsx`, `src/app/(admin)/site/editor/panels/toolbar.test.tsx`, `src/app/(admin)/site/editor/panels/inspector-plot.underlay.test.tsx`

The tests go in new files: `site-editor.test.tsx` and `inspector-plot.test.tsx` are #23's files. `toolbar.tsx` has no test yet.

**Interfaces:**
- Consumes:
  - `UnderlayCard`, `CalibrationDraft` (Task 8); `uploadUnderlay`, `UploadOutcome` (Task 8);
  - `uploadOps`, `placeOps`, `calibrateOps`, `removeUnderlayOps` (Task 3); `underlayOf`, `EditorUnderlay` (Task 3);
  - `moveBy`, `quarterTurn`, `ImagePoint` (Task 2);
  - `EditorUi`, `SceneHandle.retryUnderlay`, `SceneViewProps.underlayMarks` / `onUnderlay` (Task 7); `UnderlayEvent`, `UnderlayStatus` (Task 6);
  - `readMetres`, `SIDE_RANGE`, `NOT_A_LENGTH` (`metres.ts`); `screenArrowToMap` (`camera.ts`); `Arrow`, `Shortcut` (`keyboard.ts`, unchanged).
- Produces:
  - `use-underlay.ts`:
    - sentences: `OFF_IMAGE`, `TOO_CLOSE`, `SCALE_OUT_OF_RANGE`, `REMOVED`, `REPLACED`;
    - `interface UnderlayDeps { doc; ui; yaw; patchUi; runEdit; saidWithUndo; select; retry; upload? }`;
    - `interface UnderlayController { open; status; sending; uploadError; draft; marks; setOpen; close; onSceneEvent; sendFile; startCalibration; applyCalibration; cancelCalibration; startAlign; finishAlign; turn; nudge; setOpacity; toggleShown; remove; retry; escape }`;
    - `useUnderlay(deps): UnderlayController`.
  - `Toolbar` gains `hasUnderlay?: boolean` and the toggle "תמונת רקע".
  - `PlotInspector` gains `onUnderlay?: () => void` and a row "תמונת רקע".

- [ ] **Step 1: Write the failing plot-row and toolbar tests**

Create `src/app/(admin)/site/editor/panels/inspector-plot.underlay.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EditorDoc, EditorUnderlay } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { PlotInspector } from './inspector-plot';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const IMAGE: EditorUnderlay = {
  storageKey: `site-underlays/${PLAN}/${'a'.repeat(64)}.png`, contentType: 'image/png', sizeBytes: 1000, filename: 'שרטוט.png',
  centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0, calibration: null,
};
const FLAGS: EditorFlags = { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: [] };

function renderPlot(underlay: EditorUnderlay | null, onUnderlay?: () => void) {
  const doc: EditorDoc = { plot: { id: PLAN, widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items: [], defaults: {}, underlay };
  render(<PlotInspector doc={doc} flags={FLAGS} plotHref="/site?act=plot" onPickIds={() => {}} onUnderlay={onUnderlay} />);
}

describe('the plot’s row for the picture under the map', () => {
  it('invites an upload, and opens the picture’s card', () => {
    const onUnderlay = vi.fn();
    renderPlot(null, onUnderlay);
    expect(screen.getByText('תמונת רקע')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'העלאת תמונה' }));
    expect(onUnderlay).toHaveBeenCalled();
  });

  it('says a picture is not calibrated yet, and opens its card', () => {
    const onUnderlay = vi.fn();
    renderPlot(IMAGE, onUnderlay);
    fireEvent.click(screen.getByRole('button', { name: 'לא כוילה' }));
    expect(onUnderlay).toHaveBeenCalledTimes(1);
  });

  it('says what a calibrated picture was calibrated from', () => {
    renderPlot({ ...IMAGE, calibration: { from: [0.1, 0.5], to: [0.9, 0.5], distanceCm: 2600 } }, vi.fn());
    expect(screen.getByRole('button', { name: /כויל לפי/ }).textContent).toBe('כויל לפי ⁦26 מ׳⁩');
  });

  it('has no row when the editor gives it nowhere to open', () => {
    renderPlot(null);
    expect(screen.queryByText('תמונת רקע')).toBeNull();
  });
});
```

Create `src/app/(admin)/site/editor/panels/toolbar.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EditorUi } from '../scene/scene-view';
import { Toolbar } from './toolbar';

const UI: EditorUi = {
  tool: 'select', mode: '3d', labels: true, sun: false, netsHidden: false, snap: true,
  hiddenGroups: [], hour: 14, theme: 'light', underlay: { shown: true, opacity: 0.5 },
};

function renderToolbar(ui: EditorUi, hasUnderlay?: boolean) {
  const onUi = vi.fn();
  render(<Toolbar ui={ui} onUi={onUi} canUndo={false} canRedo={false} onUndo={() => {}} onRedo={() => {}} hasUnderlay={hasUnderlay} />);
  return { onUi };
}

describe('the tool row’s switch for the picture', () => {
  it('is not there until the map has a picture', () => {
    renderToolbar(UI, false);
    expect(screen.queryByRole('button', { name: 'תמונת רקע' })).toBeNull();
  });

  it('shows and hides the picture for this viewer, with a label that does not change', () => {
    const { onUi } = renderToolbar(UI, true);
    const toggle = screen.getByRole('button', { name: 'תמונת רקע' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(onUi).toHaveBeenCalledWith({ underlay: { shown: false, opacity: 0.5 } });
  });

  it('presses neither tool while the picture is being calibrated or aligned', () => {
    renderToolbar({ ...UI, tool: 'calibrate' }, true);
    expect(screen.getByRole('button', { name: /בחירה/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /מדידה/ }).getAttribute('aria-pressed')).toBe('false');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run "src/app/(admin)/site/editor/panels/inspector-plot.underlay.test.tsx" "src/app/(admin)/site/editor/panels/toolbar.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL. The row "תמונת רקע" and the toggle do not exist. The toolbar's third test already passes.

- [ ] **Step 3: Add the row and the toggle**

In `src/app/(admin)/site/editor/panels/inspector-plot.tsx`:

1. Replace `import type { EditorDoc } from '@/lib/site/editor/model';` with:

```ts
import { underlayOf, type EditorDoc, type EditorUnderlay } from '@/lib/site/editor/model';
```

2. Before `export function PlotInspector`, add:

```ts
/**
 * The picture's row (spec §18.1): an invitation when there is none, its
 * missing scale, or what it was calibrated from. Each opens the picture's
 * card, since a figure links to what changes it.
 */
function underlayText(underlay: EditorUnderlay | null): string {
  if (underlay === null) return 'העלאת תמונה';
  if (underlay.calibration === null) return 'לא כוילה';
  return `כויל לפי ⁦${formatMetres(underlay.calibration.distanceCm)}⁩`;
}
```

3. Replace the signature:

```ts
export function PlotInspector({ doc, flags, plotHref, onPickIds }: {
  doc: EditorDoc;
  flags: EditorFlags;
  plotHref: string;
  onPickIds: (ids: string[]) => void;
}): ReactElement {
```

with:

```ts
export function PlotInspector({ doc, flags, plotHref, onPickIds, onUnderlay }: {
  doc: EditorDoc;
  flags: EditorFlags;
  plotHref: string;
  onPickIds: (ids: string[]) => void;
  /** Opens the picture's card (spec §18.1). Without it, no row. */
  onUnderlay?: () => void;
}): ReactElement {
```

4. In the `<dl className={styles.kv}>`, after the "צפון" pair (its `</dd>`), add:

```tsx
          {onUnderlay === undefined ? null : (
            <>
              <dt>תמונת רקע</dt>
              <dd>
                <button type="button" className={chrome.link} onClick={onUnderlay}>
                  <bdi>{underlayText(underlayOf(doc))}</bdi>
                </button>
              </dd>
            </>
          )}
```

In `src/app/(admin)/site/editor/panels/toolbar.tsx`:

1. Replace the signature:

```ts
export function Toolbar({ ui, onUi, canUndo, canRedo, onUndo, onRedo }: {
  ui: EditorUi;
  onUi: (patch: Partial<EditorUi>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}): ReactElement {
```

with:

```ts
export function Toolbar({ ui, onUi, canUndo, canRedo, onUndo, onRedo, hasUnderlay }: {
  ui: EditorUi;
  onUi: (patch: Partial<EditorUi>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** The map has a picture under it: the switch that shows and hides it appears (spec §18.6). */
  hasUnderlay?: boolean;
}): ReactElement {
```

2. After the "הסתרת רשתות צל" toggle's `</button>`, add:

```tsx
      {hasUnderlay === true ? (
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={ui.underlay.shown}
          onClick={() => { onUi({ underlay: { ...ui.underlay, shown: !ui.underlay.shown } }); }}
        >
          <Icon name="layers" size={14} />
          תמונת רקע
        </button>
      ) : null}
```

3. In the file's docblock, change "and the four switches — labels, shade by hour, hiding the nets, snapping." to "and the switches — labels, shade by hour, hiding the nets, the picture under the map (once there is one), snapping."

- [ ] **Step 4: Run the two tests**

Run the Step 2 command. Expected: 7 passed (4 + 3), exit 0.

- [ ] **Step 5: Write the failing editor test**

Create `src/app/(admin)/site/editor/site-editor.underlay.test.tsx`. It uses the real store and save queue, as `site-editor.saving.test.tsx` does. The server actions and the scene are stood in for. The scene stand-in records its props, so the test can play the scene's part: it reports the picture ready, and it reports the lead's clicks while calibrating.

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { EditorDoc, EditorPlot, EditorUnderlay } from '@/lib/site/editor/model';
import type { SceneHandle, SceneViewProps } from './scene/scene-view';
import type { UnderlayEvent } from './scene/underlay-mesh';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const KEY = `site-underlays/${PLAN}/${'a'.repeat(64)}.png`;
const IMAGE: EditorUnderlay = {
  storageKey: KEY, contentType: 'image/png', sizeBytes: 64, filename: 'שרטוט.png',
  centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0, calibration: null,
};
const LRI = '⁦';
const PDI = '⁩';

function siteDoc(underlay: EditorUnderlay | null, plot: Partial<EditorPlot> = {}): EditorDoc {
  return { plot: { id: PLAN, widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0, ...plot }, items: [], defaults: {}, underlay };
}

const { saveSiteChangesAction, loadSiteDocAction } = vi.hoisted(() => ({
  saveSiteChangesAction: vi.fn(), loadSiteDocAction: vi.fn(),
}));
vi.mock('../actions', () => ({ saveSiteChangesAction, loadSiteDocAction }));

/* `next/dynamic` as the app router builds it — see `site-editor.test.tsx`. */
vi.mock('next/dynamic', async () => ({
  default: (await import('next/dist/shared/lib/app-dynamic')).default,
}));

const scene = vi.hoisted(() => ({
  props: vi.fn(),
  handle: {
    fitAll: vi.fn(), fitIds: vi.fn(), zoomBy: vi.fn(), rotateView: vi.fn(), northUp: vi.fn(),
    centreGround: vi.fn(() => null), groundAtClient: vi.fn(() => null), setGhost: vi.fn(), jumpTo: vi.fn(),
    exportPng: vi.fn(() => null), retryUnderlay: vi.fn(),
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

const WAIT = { timeout: 3000 };

/** The PNG header of a 1600 × 1200 picture, padded: all the checks read. */
function png(): Uint8Array {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0x06, 0x40, 0, 0, 0x04, 0xb0, 8, 6, 0, 0, 0];
  const out = new Uint8Array(64);
  out.set(header);
  return out;
}

const route = vi.fn();

beforeAll(() => {
  // jsdom draws nothing; a context object is enough for the editor's one-time WebGL question.
  HTMLCanvasElement.prototype.getContext = (() => ({ getExtension: () => null })) as unknown as HTMLCanvasElement['getContext'];
});

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width'), media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  saveSiteChangesAction.mockResolvedValue({ ok: true, version: 1 });
  loadSiteDocAction.mockResolvedValue({ ok: false, error: 'המפה לא נטענה' });
  route.mockImplementation(async () => new Response(
    JSON.stringify({ storageKey: KEY, contentType: 'image/png', sizeBytes: 64, filename: 'שרטוט.png' }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', route);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 64, height: 48, close: () => {} })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderEditor(underlay: EditorUnderlay | null) {
  const props: SiteEditorProps = {
    initial: { doc: siteDoc(underlay), version: 0 },
    initialSelection: null,
    seasonName: 'ברן 26',
    sunDate: '2026-06-04',
    buildTasks: [],
    plotHref: '/site?season=s26&act=plot',
    seasonDateHref: '/site?season=s26&act=season-date',
  };
  const view = render(<ToastProvider><SiteEditor {...props} /></ToastProvider>);
  await screen.findByTestId('scene');
  return view;
}

function lastScene(): SceneViewProps {
  const call = scene.props.mock.lastCall;
  if (call === undefined) throw new Error('the scene never rendered');
  return call[0] as SceneViewProps;
}
const picture = () => lastScene().store.doc.underlay ?? null;
const inspector = () => within(screen.getByRole('region', { name: 'מאפיינים' }));
const card = () => within(screen.getByRole('group', { name: 'תמונת רקע' }));
const stage = () => screen.getByRole('region', { name: 'מפת הקאמפ' });
/** The scene's part: what it would report. */
const sceneSays = (event: UnderlayEvent) => { act(() => { lastScene().onUnderlay?.(event); }); };
const shown = () => sceneSays({ type: 'status', status: { state: 'ready', aspect: 0.75 } });

async function calibrating() {
  fireEvent.click(inspector().getByRole('button', { name: 'לא כוילה' }));
  shown();
  fireEvent.click(card().getByRole('button', { name: 'כיול' }));
}

describe('the picture under the map, in the editor', () => {
  it('opens its card from the plot, uploads, lays the picture on the plot and goes straight on to calibration, in plan', async () => {
    await renderEditor(null);
    fireEvent.click(inspector().getByRole('button', { name: 'העלאת תמונה' }));
    const input = screen.getByRole('group', { name: 'תמונת רקע' }).querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([png()], 'שרטוט.png', { type: 'image/png' })] } });

    await waitFor(() => { expect(picture()).toEqual(IMAGE); });
    expect(route.mock.calls[0][0]).toBe(`/site/underlay/${PLAN}`);
    expect(lastScene().ui).toMatchObject({ tool: 'calibrate', mode: 'plan', underlay: { shown: true, opacity: 0.5 } });
    expect(card().getByRole('status').textContent).toBe('סימון הנקודה הראשונה על התמונה');

    await waitFor(() => { expect(saveSiteChangesAction).toHaveBeenCalled(); }, WAIT);
    expect(saveSiteChangesAction.mock.lastCall).toEqual([PLAN, 0, [{ type: 'setUnderlay', underlay: IMAGE }]]);
  });

  it('calibrates from two marked points and a typed distance, as one undo step, and goes back to the view it came from', async () => {
    await renderEditor(IMAGE);
    expect(lastScene().ui.mode).toBe('3d');
    await calibrating();
    expect(lastScene().ui).toMatchObject({ tool: 'calibrate', mode: 'plan' });

    sceneSays({ type: 'point', uv: [0.1, 0.5] });
    expect(card().getByRole('status').textContent).toBe('סימון הנקודה השנייה');
    expect(lastScene().underlayMarks).toEqual([[0.1, 0.5]]);
    sceneSays({ type: 'point', uv: [0.9, 0.5] });
    fireEvent.change(card().getByLabelText('המרחק בין שתי הנקודות, במטרים'), { target: { value: '26' } });
    fireEvent.click(card().getByRole('button', { name: 'כיול' }));

    expect(picture()).toEqual({
      ...IMAGE, centreXCm: 1560, widthCm: 3250, calibration: { from: [0.1, 0.5], to: [0.9, 0.5], distanceCm: 2600 },
    });
    expect(lastScene().ui).toMatchObject({ tool: 'select', mode: '3d' });
    expect(card().getByText(`כויל לפי ${LRI}26 מ׳${PDI} שסומנו על התמונה`)).toBeTruthy();
    // The saved pair is drawn while the card is open.
    expect(lastScene().underlayMarks).toEqual([[0.1, 0.5], [0.9, 0.5]]);

    fireEvent.keyDown(stage(), { code: 'KeyZ', metaKey: true });
    expect(picture()).toEqual(IMAGE);
  });

  it('refuses in Hebrew a point beside the picture, a point too near the first, and a distance that is not one', async () => {
    await renderEditor(IMAGE);
    await calibrating();
    sceneSays({ type: 'offImage' });
    expect(card().getByRole('alert').textContent).toBe('הנקודה מחוץ לתמונה.');
    sceneSays({ type: 'point', uv: [0.5, 0.5] });
    sceneSays({ type: 'tooClose' });
    expect(card().getByRole('alert').textContent)
      .toBe('שתי הנקודות קרובות מדי זו לזו. מרחק ארוך, כמו צלע של הגדר, נותן כיול מדויק יותר.');
    sceneSays({ type: 'point', uv: [0.51, 0.5] });
    const distance = card().getByLabelText('המרחק בין שתי הנקודות, במטרים');
    fireEvent.change(distance, { target: { value: 'abc' } });
    fireEvent.click(card().getByRole('button', { name: 'כיול' }));
    expect(card().getByRole('alert').textContent).toBe('צריך מספר במטרים, עם עד שתי ספרות אחרי הנקודה — למשל 2.5');
    // 26 cm of picture typed as 500 m would make it 5 km wide.
    fireEvent.change(distance, { target: { value: '500' } });
    fireEvent.click(card().getByRole('button', { name: 'כיול' }));
    expect(card().getByRole('alert').textContent)
      .toBe('בקנה המידה הזה התמונה הייתה מכסה פחות מ־10 ס״מ או יותר מ־500 מטר. כדאי לבדוק את המרחק שהוקלד.');
    expect(picture()).toEqual(IMAGE);
  });

  it('aligns the picture with the arrows and quarter turns, each one step, and Esc ends it', async () => {
    await renderEditor(IMAGE);
    fireEvent.click(inspector().getByRole('button', { name: 'לא כוילה' }));
    shown();
    fireEvent.click(card().getByRole('button', { name: 'הזזה' }));
    expect(lastScene().ui.tool).toBe('align');

    fireEvent.keyDown(stage(), { code: 'ArrowRight' });
    expect(picture()?.centreXCm).toBe(1310);
    fireEvent.keyDown(stage(), { code: 'ArrowUp', shiftKey: true });
    expect(picture()?.centreYCm).toBe(1100);
    fireEvent.click(card().getByRole('button', { name: 'סיבוב רבע ימינה' }));
    expect(picture()?.rotationTenths).toBe(900);
    fireEvent.keyDown(stage(), { code: 'KeyZ', metaKey: true });
    expect(picture()?.rotationTenths).toBe(0);

    fireEvent.keyDown(stage(), { code: 'Escape' });
    expect(lastScene().ui.tool).toBe('select');
    fireEvent.keyDown(stage(), { code: 'ArrowRight' });
    expect(picture()?.centreXCm).toBe(1310);
  });

  it('hides the picture and sets how see-through it is for this viewer only — nothing is saved', async () => {
    await renderEditor(IMAGE);
    fireEvent.click(screen.getByRole('button', { name: 'תמונת רקע' }));
    expect(lastScene().ui.underlay).toEqual({ shown: false, opacity: 0.5 });
    fireEvent.click(inspector().getByRole('button', { name: 'לא כוילה' }));
    fireEvent.change(card().getByRole('slider', { name: 'שקיפות' }), { target: { value: '30' } });
    expect(lastScene().ui.underlay).toEqual({ shown: false, opacity: 0.3 });
    await new Promise((done) => { setTimeout(done, 700); });
    expect(saveSiteChangesAction).not.toHaveBeenCalled();
  });

  it('takes the picture off with a toast that says the file is kept, and ביטול brings it back', async () => {
    await renderEditor(IMAGE);
    fireEvent.click(inspector().getByRole('button', { name: 'לא כוילה' }));
    fireEvent.click(card().getByRole('button', { name: 'הסרת התמונה' }));
    expect(picture()).toBeNull();
    expect(await screen.findByText('תמונת הרקע הוסרה מהמפה. הקובץ עצמו נשמר, כדי שאפשר יהיה לבטל.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    await waitFor(() => { expect(picture()).toEqual(IMAGE); });
  });

  it('says in Hebrew why a file was refused, and sends nothing', async () => {
    await renderEditor(null);
    fireEvent.click(inspector().getByRole('button', { name: 'העלאת תמונה' }));
    const input = screen.getByRole('group', { name: 'תמונת רקע' }).querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.7\n'], 'plan.pdf', { type: 'application/pdf' })] } });
    expect(await card().findByRole('alert')).toBeTruthy();
    expect(card().getByRole('alert').textContent).toBe('קובץ PDF אי אפשר להעלות כרקע. צילום מסך של העמוד יעבוד.');
    expect(route).not.toHaveBeenCalled();
    expect(picture()).toBeNull();
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run "src/app/(admin)/site/editor/site-editor.underlay.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL. The plot inspector has no "תמונת רקע" row yet, because `SiteEditor` does not pass `onUnderlay`, so `getByRole('button', { name: 'העלאת תמונה' })` finds nothing.

- [ ] **Step 7: Write `use-underlay.ts`**

Create `src/app/(admin)/site/editor/use-underlay.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { screenArrowToMap } from '@/lib/site/editor/camera';
import { NOT_A_LENGTH, SIDE_RANGE, readMetres } from '@/lib/site/editor/metres';
import { underlayOf, type EditorDoc } from '@/lib/site/editor/model';
import type { SiteOp } from '@/lib/site/editor/ops';
import { calibrateOps, placeOps, removeUnderlayOps, uploadOps } from '@/lib/site/editor/underlay-commands';
import { moveBy, quarterTurn, type ImagePoint } from '@/lib/site/underlay';
import type { Arrow } from './keyboard';
import type { CalibrationDraft } from './panels/underlay-card';
import type { EditorUi } from './scene/scene-view';
import type { UnderlayEvent, UnderlayStatus } from './scene/underlay-mesh';
import { uploadUnderlay, type UploadOutcome } from './underlay-upload';

/**
 * The picture under the map, as the editor runs it (spec §16–19): its card,
 * its two tools and the keys they take. It sits beside `SiteEditor` so the
 * editor, which other lanes edit too, changes by a few lines.
 *
 * - Every change of where the picture lies goes through `runEdit`, the
 *   editor's one door. So it is one undo step, saved in the batch against the
 *   map's version, and it takes an older undo toast away (P6).
 * - How this viewer sees it — shown or hidden, how see-through — only ever
 *   changes `EditorUi.underlay`, which is never saved (D19).
 * - Calibrating switches the view to plan, and back afterwards (spec §18.3).
 */

/** What the editor says about the picture (spec §20). */
export const OFF_IMAGE = 'הנקודה מחוץ לתמונה.';
export const TOO_CLOSE = 'שתי הנקודות קרובות מדי זו לזו. מרחק ארוך, כמו צלע של הגדר, נותן כיול מדויק יותר.';
/**
 * A typed distance that would make the picture narrower than 10 cm or wider
 * than 500 m. Spec §20 has no sentence for it; without one, the server would
 * refuse the whole batch instead ("מיקום תמונת הרקע…"), which is the wrong
 * reason, and the refused batch would halt every edit queued with it.
 */
export const SCALE_OUT_OF_RANGE = 'בקנה המידה הזה התמונה הייתה מכסה פחות מ־10 ס״מ או יותר מ־500 מטר. כדאי לבדוק את המרחק שהוקלד.';
export const REMOVED = 'תמונת הרקע הוסרה מהמפה. הקובץ עצמו נשמר, כדי שאפשר יהיה לבטל.';
export const REPLACED = 'תמונת הרקע הוחלפה';

const NO_DRAFT: CalibrationDraft = { points: [], refusal: null };
/** An arrow moves the picture 10 cm, or a metre with Shift (spec §18.4). */
const NUDGE_CM = 10;
const BIG_NUDGE_CM = 100;

export interface UnderlayDeps {
  doc: EditorDoc;
  ui: EditorUi;
  /** The view's turn, so an arrow moves the picture the way it points on screen, as it moves items. */
  yaw: number;
  patchUi: (patch: Partial<EditorUi>) => void;
  /** `SiteEditor`'s one door for edits. */
  runEdit: (label: string, ops: SiteOp[]) => void;
  saidWithUndo: (message: string) => void;
  select: (ids: string[]) => void;
  /** `SceneHandle.retryUnderlay`. */
  retry: () => void;
  /** The browser's `uploadUnderlay` unless a test hands in another. */
  upload?: (file: File, planId: string) => Promise<UploadOutcome>;
}

export interface UnderlayController {
  open: boolean;
  status: UnderlayStatus;
  sending: boolean;
  uploadError: string | null;
  draft: CalibrationDraft;
  /** For the scene to draw: the points marked so far while calibrating, or the saved pair while the card is open. */
  marks: ImagePoint[];
  setOpen: (open: boolean) => void;
  close: () => void;
  onSceneEvent: (event: UnderlayEvent) => void;
  sendFile: (file: File) => void;
  startCalibration: () => void;
  applyCalibration: (distanceText: string, parallel: boolean) => void;
  cancelCalibration: () => void;
  startAlign: () => void;
  finishAlign: () => void;
  turn: (direction: 1 | -1) => void;
  nudge: (arrow: Arrow, big: boolean) => void;
  setOpacity: (opacity: number) => void;
  toggleShown: () => void;
  remove: () => void;
  retry: () => void;
  /** Esc: ends calibrating or aligning. True when it did. */
  escape: () => boolean;
}

export function useUnderlay(deps: UnderlayDeps): UnderlayController {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<UnderlayStatus>({ state: 'none' });
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CalibrationDraft>(NO_DRAFT);
  /** The view before calibration switched to plan. Read and written in handlers only. */
  const modeBefore = useRef<EditorUi['mode'] | null>(null);
  /** The latest deps, for an upload that finishes after the lead has done other things meanwhile. */
  const latest = useRef(deps);
  useEffect(() => { latest.current = deps; });

  const underlay = underlayOf(deps.doc);
  const aspect = status.state === 'ready' ? status.aspect : null;
  const { tool } = deps.ui;
  const marks: ImagePoint[] = tool === 'calibrate'
    ? draft.points
    : open && underlay !== null && underlay.calibration !== null
      ? [underlay.calibration.from, underlay.calibration.to]
      : [];

  function beginCalibration(from: UnderlayDeps): void {
    if (from.ui.tool !== 'calibrate') modeBefore.current = from.ui.mode;
    from.select([]);
    from.patchUi({ tool: 'calibrate', mode: 'plan', underlay: { ...from.ui.underlay, shown: true } });
    setDraft(NO_DRAFT);
    setOpen(true);
  }

  function leaveTool(): void {
    const mode = modeBefore.current;
    modeBefore.current = null;
    deps.patchUi(mode === null ? { tool: 'select' } : { tool: 'select', mode });
    setDraft(NO_DRAFT);
  }

  function edit(label: string, ops: SiteOp[]): void {
    if (ops.length > 0) deps.runEdit(label, ops);
  }

  async function send(file: File): Promise<void> {
    setUploadError(null);
    setSending(true);
    let outcome: UploadOutcome;
    try {
      outcome = await (deps.upload ?? uploadUnderlay)(file, deps.doc.plot.id);
    } finally {
      setSending(false);
    }
    if (!outcome.ok) {
      setUploadError(outcome.error);
      return;
    }
    const now = latest.current;
    const replacing = underlayOf(now.doc) !== null;
    const ops = uploadOps(now.doc, outcome.file);
    if (ops.length === 0) return; // the same picture again: nothing changes
    now.runEdit(replacing ? 'החלפת תמונת הרקע' : 'העלאת תמונת רקע', ops);
    if (replacing) {
      now.patchUi({ underlay: { ...now.ui.underlay, shown: true } });
      now.saidWithUndo(REPLACED);
    } else {
      beginCalibration(now); // a new picture goes straight on to calibration (§18.2)
    }
  }

  function applyCalibration(distanceText: string, parallel: boolean): void {
    const reading = readMetres(distanceText, SIDE_RANGE);
    if (!reading.ok) {
      setDraft({ ...draft, refusal: reading.error });
      return;
    }
    if (reading.cm === null) {
      setDraft({ ...draft, refusal: NOT_A_LENGTH });
      return;
    }
    if (aspect === null || draft.points.length < 2) return;
    const ops = calibrateOps(deps.doc, aspect, draft.points[0], draft.points[1], reading.cm, parallel);
    if (ops === null) {
      setDraft({ ...draft, refusal: SCALE_OUT_OF_RANGE });
      return;
    }
    edit('כיול תמונת הרקע', ops);
    leaveTool();
  }

  function startAlign(): void {
    if (underlay === null) return;
    if (tool === 'calibrate') leaveTool();
    deps.select([]);
    deps.patchUi({ tool: 'align', underlay: { ...deps.ui.underlay, shown: true } });
    setOpen(true);
  }

  function finishAlign(): void {
    deps.patchUi({ tool: 'select' });
  }

  function escape(): boolean {
    if (tool === 'calibrate') {
      leaveTool();
      return true;
    }
    if (tool === 'align') {
      finishAlign();
      return true;
    }
    return false;
  }

  function remove(): void {
    const ops = removeUnderlayOps(deps.doc);
    if (ops.length === 0) return;
    escape();
    deps.runEdit('הסרת תמונת הרקע', ops);
    deps.saidWithUndo(REMOVED);
  }

  function onSceneEvent(event: UnderlayEvent): void {
    switch (event.type) {
      case 'status':
        setStatus(event.status);
        break;
      case 'point':
        setDraft((current) => (current.points.length >= 2 ? current : { points: [...current.points, event.uv], refusal: null }));
        break;
      case 'offImage':
        setDraft((current) => ({ ...current, refusal: OFF_IMAGE }));
        break;
      case 'tooClose':
        setDraft((current) => ({ ...current, refusal: TOO_CLOSE }));
        break;
    }
  }

  return {
    open,
    status,
    sending,
    uploadError,
    draft,
    marks,
    setOpen,
    close: () => {
      escape();
      setOpen(false);
    },
    onSceneEvent,
    sendFile: (file) => { void send(file); },
    startCalibration: () => {
      if (underlay !== null) beginCalibration(deps);
    },
    applyCalibration,
    cancelCalibration: leaveTool,
    startAlign,
    finishAlign,
    turn: (direction) => {
      if (underlay !== null) edit('סיבוב תמונת הרקע', placeOps(deps.doc, quarterTurn(underlay, direction)));
    },
    nudge: (arrow, big) => {
      if (underlay === null) return;
      const [ux, uy] = screenArrowToMap(deps.yaw, arrow);
      const step = big ? BIG_NUDGE_CM : NUDGE_CM;
      edit('הזזת תמונת הרקע', placeOps(deps.doc, moveBy(underlay, ux * step, uy * step)));
    },
    setOpacity: (opacity) => { deps.patchUi({ underlay: { ...deps.ui.underlay, opacity } }); },
    toggleShown: () => { deps.patchUi({ underlay: { ...deps.ui.underlay, shown: !deps.ui.underlay.shown } }); },
    remove,
    retry: () => { deps.retry(); },
    escape,
  };
}
```

- [ ] **Step 8: Wire it into `SiteEditor`**

Read `src/app/(admin)/site/editor/site-editor.tsx` with the Read tool.

1. Replace `import { findItem, type EditorDoc, type EditorItem } from '@/lib/site/editor/model';` with:

```ts
import { findItem, underlayOf, type EditorDoc, type EditorItem } from '@/lib/site/editor/model';
```

After `import { SunCard } from './panels/sun-card';` add:

```ts
import { UnderlayCard } from './panels/underlay-card';
import { useUnderlay } from './use-underlay';
```

2. After the `addAt` function, and before `  // ── end of edits ──…`, add:

```ts
  /* The picture under the map (spec §16–19): its card, its two tools and
     their keys. Its edits go through `runEdit`, like every other edit, so
     each is one undo step and takes older undo toasts away (P6). */
  const picture = useUnderlay({
    doc: store.doc,
    ui,
    yaw: view.yaw,
    patchUi,
    runEdit,
    saidWithUndo,
    select: store.select,
    retry: () => { sceneRef.current?.retryUnderlay(); },
  });
```

3. Replace the start of `runShortcut`:

```ts
  function runShortcut(shortcut: Shortcut): void {
    if (typeof shortcut === 'object') {
```

with:

```ts
  /**
   * While the picture is calibrated or aligned (spec §18), the keys are its
   * own. Esc ends the tool. Aligning, the arrows move the picture (10 cm, a
   * metre with Shift), and undo, redo and the view's keys work as ever.
   * Calibrating, only the view's keys do: the lead is marking two points in
   * plan. A key that acts on items does nothing, since nothing is selected.
   * Answers whether it took the key.
   */
  function runPictureShortcut(shortcut: Shortcut): boolean {
    if (typeof shortcut === 'object') {
      if (ui.tool === 'align') picture.nudge(shortcut.arrow, shortcut.big);
      return true;
    }
    if (shortcut === 'escape') return picture.escape();
    const viewKeys: ReadonlyArray<Shortcut> = ['fit', 'viewLeft', 'viewRight', 'zoomIn', 'zoomOut', 'keys'];
    const alignKeys: ReadonlyArray<Shortcut> = ['undo', 'redo', 'plan', '3d'];
    if (viewKeys.includes(shortcut)) return false;
    if (ui.tool === 'align' && alignKeys.includes(shortcut)) return false;
    return true;
  }

  function runShortcut(shortcut: Shortcut): void {
    if ((ui.tool === 'calibrate' || ui.tool === 'align') && runPictureShortcut(shortcut)) return;
    if (typeof shortcut === 'object') {
```

4. In `renderInspector`, replace:

```tsx
      return <PlotInspector doc={store.doc} flags={store.flags} plotHref={plotHref} onPickIds={pickIds} />;
```

with:

```tsx
      return (
        <PlotInspector
          doc={store.doc}
          flags={store.flags}
          plotHref={plotHref}
          onPickIds={pickIds}
          onUnderlay={() => { picture.setOpen(true); }}
        />
      );
```

5. In the `<SceneView … />` element, after `onNotice={onNotice}` add:

```tsx
      underlayMarks={picture.marks}
      onUnderlay={picture.onSceneEvent}
```

6. In the `<Toolbar … />` element, after `onRedo={redo}` add `hasUnderlay={underlayOf(store.doc) !== null}`.

7. As the first child of `<div className={styles.cards}>`, before `{ui.sun ? (`, add:

```tsx
          {picture.open ? (
            <UnderlayCard
              underlay={underlayOf(store.doc)}
              status={picture.status}
              view={ui.underlay}
              tool={ui.tool}
              sending={picture.sending}
              uploadError={picture.uploadError}
              draft={picture.draft}
              onFile={picture.sendFile}
              onCalibrate={picture.startCalibration}
              onApplyCalibration={picture.applyCalibration}
              onCancelCalibration={picture.cancelCalibration}
              onAlign={picture.startAlign}
              onFinishAlign={picture.finishAlign}
              onTurn={picture.turn}
              onOpacity={picture.setOpacity}
              onRemove={picture.remove}
              onRetry={picture.retry}
              onClose={picture.close}
            />
          ) : null}
```

Also change the comment above `.cards` in `editor.module.css` from "The cards (the shortcuts, the sun)" to "The cards (the picture under the map, the shortcuts, the sun)". This is a comment only; no rule changes.

- [ ] **Step 9: Run this task's tests, and the editor's own**

Run: `npx vitest run "src/app/(admin)/site/editor/site-editor.underlay.test.tsx" "src/app/(admin)/site/editor/panels/toolbar.test.tsx" "src/app/(admin)/site/editor/panels/inspector-plot.underlay.test.tsx" "src/app/(admin)/site/editor/site-editor.test.tsx" "src/app/(admin)/site/editor/site-editor.saving.test.tsx" "src/app/(admin)/site/editor/site-editor.no-webgl.test.tsx" "src/app/(admin)/site/editor/panels/inspector-plot.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`

Expected: exit 0, 0 failed.
- `site-editor.underlay.test.tsx`: 7 passed.
- `toolbar.test.tsx`: 3 passed.
- `inspector-plot.underlay.test.tsx`: 4 passed.
- The editor's existing tests pass unchanged. Their scene stand-ins ignore the two new props, and their docs have no picture.

Then prove "nothing is saved" can fail. In `use-underlay.ts`, temporarily make `setOpacity` also call `edit('x', placeOps(deps.doc, moveBy(underlayOf(deps.doc)!, 1, 0)))`, which saves a move with every change of opacity. Re-run `site-editor.underlay.test.tsx`. Expected: "hides the picture … nothing is saved" fails, because `saveSiteChangesAction` was called. Restore it: 7 passed.

- [ ] **Step 10: Typecheck, lint, commit**

Run: `npx tsc --noEmit`. Expected: exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor/use-underlay.ts" "src/app/(admin)/site/editor/site-editor.tsx" "src/app/(admin)/site/editor/panels/toolbar.tsx" "src/app/(admin)/site/editor/panels/inspector-plot.tsx" "src/app/(admin)/site/editor/site-editor.underlay.test.tsx" "src/app/(admin)/site/editor/panels/toolbar.test.tsx" "src/app/(admin)/site/editor/panels/inspector-plot.underlay.test.tsx"`. Expected: no problems. The React compiler's rules are errors here. `use-underlay.ts` reads `latest.current` and `modeBefore.current` only in handlers, and writes `latest` only in an effect. If a rule still fires, fix the code, not the rule.

```bash
git add "src/app/(admin)/site/editor/use-underlay.ts" "src/app/(admin)/site/editor/site-editor.tsx" "src/app/(admin)/site/editor/editor.module.css" "src/app/(admin)/site/editor/panels/toolbar.tsx" "src/app/(admin)/site/editor/panels/inspector-plot.tsx" "src/app/(admin)/site/editor/site-editor.underlay.test.tsx" "src/app/(admin)/site/editor/panels/toolbar.test.tsx" "src/app/(admin)/site/editor/panels/inspector-plot.underlay.test.tsx"
git commit -m "feat(site): the picture under the map in the editor — its row, its switch, its card, its keys

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Hand-off — the tests, the migration number at merge, a browser, the deploy record, the PR body

**Files:**
- Modify: `docs/deploy.md` (§6: the record for `0015`)
- Modify: `docs/collab/claims.md` (§3: this lane's row)
- Modify, only if the number moved: `drizzle/00NN_site_underlays.sql`, `drizzle/meta/00NN_snapshot.json` and `drizzle/meta/_journal.json`, regenerated
- Modify, only if #23 has merged: the `EditorDoc` literals in C's own test files (`lines: []`)
- Modify, only if `next dev` rewrote it: `AGENTS.md`
- Create, **not committed** (`/.superpowers/` is gitignored): `.superpowers/site-underlay/pr-body.md` and the screenshots beside it

**Interfaces:**
- Consumes: everything Tasks 1–9 built.
- Produces: a branch whose migration number matches what is on `main`, a browser check of spec §18 with the camp lead's own sketch, the §6 record the camp lead follows to apply `0015`, and a PR body on disk. The PR itself is not opened here.

- [ ] **Step 1: Make sure nobody else is mid-run**

```bash
pgrep -fl vitest
pgrep -fl "next build"
```

Expected: no output from either. If a run is going, wait for it to end, with Monitor and an until-loop on `pgrep -fl vitest`. A mass red while another run is going is not evidence of anything.

- [ ] **Step 2: Run this plan's tests and the repo-wide nets, capped**

```bash
OUT=".vitest/json/run-$$-underlay.json"
npx vitest run src/lib/site/underlay-limits.test.ts src/lib/site/image-facts.test.ts src/lib/site/underlay-file.test.ts \
  src/lib/site/underlay.test.ts src/lib/site/editor/ops.underlay.test.ts src/lib/site/editor/underlay-commands.test.ts \
  src/lib/site/editor/ops.test.ts src/lib/site/plan.underlay.test.ts src/lib/site/plan.test.ts \
  "src/app/(admin)/site/underlay" "src/app/(admin)/site/editor" "src/app/(admin)/site/failure-messages.test.ts" \
  src/app/admin-guard.test.ts "src/app/(admin)/route-modules.test.ts" "src/app/(admin)/copy-sweep.test.tsx" \
  "src/app/(admin)/a11y-sweep.test.tsx" src/proxy.test.ts \
  --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile "$OUT"
echo "exit=$? report=$OUT"
node -e "const r=require(require('path').resolve(process.argv[1]));console.log(JSON.stringify({total:r.numTotalTests,passed:r.numPassedTests,failed:r.numFailedTests,pending:r.numPendingTests,files:r.numTotalTestSuites}))" "$OUT"
```

(Pass `timeout` 600000 on the Bash call.) Green means all three of these:
- `exit=0` **and** `failed: 0`. A non-zero exit with `failed: 0` means workers died. Read the `Unhandled Errors` block, check `pgrep -fl vitest`, and rerun once when the box is quiet.
- `pending: 0`. Nothing in these files is skipped on purpose, so a pending test is one a killed worker never ran.
- `files` equals the number of test files the paths name. Count them with `node` from the paths above, not with a hooked `grep | wc -l`.

The **full suite is the coordinator's** (`CLAUDE.md`: a lane runs only its own scope). If you are the one coordinating this merge, run it once as plan 04 Task 27 Steps 2–3 do, with the same three checks. Otherwise, hand that step to the coordinator and say so in the PR body.

- [ ] **Step 3: Typecheck, lint, build**

Run: `npx tsc --noEmit`. Expected: exit 0.
Run: `rtk proxy npm run lint`. Expected: no errors, as CI runs it.
Run: `npx next build`, after `pgrep -fl vitest` shows nothing. Expected: exit 0. The route table lists `ƒ /site/underlay/[planId]` and `ƒ /site/underlay/[planId]/[file]` (dynamic) beside `ƒ /site`. A route handler whose second argument has the wrong shape is only caught here.

- [ ] **Step 4: The migration number — re-checked against what has actually merged**

Migration numbers follow the order parts merge in (spec §24; `ownership.md`, the `drizzle/` row). This step runs **again, right before merging**, whatever it found the first time. The migration is only ever made by `npx drizzle-kit generate`, **never** `drizzle-kit push` or `drizzle-kit migrate` (`docs/deploy.md` §6 forbids both), and it is applied to Railway only by the camp lead, by hand, following `docs/deploy.md` §6.

```bash
/usr/bin/git fetch origin
node -e "const {execSync}=require('child_process');const onMain=execSync('/usr/bin/git ls-tree --name-only origin/main drizzle/').toString().split('\n').filter(f=>f.endsWith('.sql'));const mine=require('fs').readdirSync('drizzle').filter(f=>f.endsWith('_site_underlays.sql'));console.log('last on main:',onMain[onMain.length-1],'| this branch:',mine.join(' '))"
```

Run it twice (`CLAUDE.md`: counts here have come back wrong once and right the next time). Read `docs/collab/claims.md` for any other lane holding a migration it has not merged.

- **Mine is the last on `main` plus one** (`0015_site_underlays.sql` after `0014_…`): nothing to do.
- **Anything else**: regenerate. Never rename the file by hand, and never hand-merge `_journal.json` or a snapshot.

```bash
git rm drizzle/*_site_underlays.sql
git rm "drizzle/meta/$(node -e "console.log(require('./drizzle/meta/_journal.json').entries.find(e=>e.tag.endsWith('_site_underlays')).tag.slice(0,4))")_snapshot.json"
git checkout origin/main -- drizzle/meta/_journal.json
git commit -m "chore(site): take the image migration out, to generate it again on top of main

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
/usr/bin/git merge origin/main
```

Resolve the merge by the table in "Order, Part B, and the files shared with #23": keep both sides. Then:

```bash
npx drizzle-kit generate --name site_underlays
```

Read the new SQL: exactly Task 4 Step 5's two statements. Count as in Task 4 Step 5. If #23 has merged, `tsc` now names the `EditorDoc` literals in C's own test files. Add `lines: []` to each one; the list is in "Order, Part B, and the files shared with #23". Rerun Step 2's command and `npx tsc --noEmit`. Then:

```bash
git add drizzle/*_site_underlays.sql drizzle/meta/_journal.json drizzle/meta/*_snapshot.json
/usr/bin/git status --short drizzle/
git commit -m "chore(site): the image migration, regenerated after main's

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Stage the test files you touched by path, in their own commit. The migration is never applied from here, not locally and not to Railway. Applying it to Railway is the camp lead's step, by hand, with the `psql -f` procedure in `docs/deploy.md` §6 (Step 10 writes its record).

- [ ] **Step 5: The browser check's preconditions — stop if any fails**

Each failure below is a **STOP and ask the camp lead**, never a fix:

1. `docker ps -a --filter name=shliff`: `shliff-pg` must be `Up` and publishing **5433**. If it is stopped or missing, stop. It is stopped on purpose to relieve memory pressure; do not start it.
2. Migration `0015` in the local database (read-only):
   `docker exec shliff-pg psql -U shliff -d shliff -tAc "select count(*) from information_schema.tables where table_name='site_underlays'"`. Expected `1`. `0` means `/site` cannot load with this branch at all, because `loadDoc` reads the table. Applying it writes to the shared development database, so stop and ask. Also ask whether `0013` and `0014` are applied there.
3. A season with a map (read-only), as plan 04 Task 27 Step 5.3. Call its id `<season>`.
4. `.env.local` in the worktree says `STORAGE_DRIVER="local"`, and `git check-ignore -v .uploads/x` names `.gitignore`. The picture is written under `.uploads/site-underlays/`, never anywhere git can see.
5. **The sketch.** Ask the camp lead for the path of their own sketch, the one with the 26 m arrow. It is kept outside git; never copy it into the worktree. Ask as well for a phone photo taken upright (portrait) of anything, for Review Focus #1. If there is none, say so in the PR body.
6. A free port: `lsof -nP -iTCP:3000 -sTCP:LISTEN`, then 3001 and upwards. Start `npm run dev -- --port <port>` with the Bash tool's `run_in_background`. Poll `curl -s -o /dev/null -w '%{http_code}' http://localhost:<port>/signin` until it prints `200`.

- [ ] **Step 6: Load the browser tools, have the camp lead sign in, block writes**

Load the Playwright MCP tools in one call. ToolSearch `select:mcp__plugin_playwright_playwright__browser_navigate,mcp__plugin_playwright_playwright__browser_snapshot,mcp__plugin_playwright_playwright__browser_click,mcp__plugin_playwright_playwright__browser_drag,mcp__plugin_playwright_playwright__browser_press_key,mcp__plugin_playwright_playwright__browser_take_screenshot,mcp__plugin_playwright_playwright__browser_console_messages,mcp__plugin_playwright_playwright__browser_run_code_unsafe,mcp__plugin_playwright_playwright__browser_evaluate,mcp__plugin_playwright_playwright__browser_file_upload,mcp__plugin_playwright_playwright__browser_type,mcp__plugin_playwright_playwright__browser_tabs`.

`browser_navigate` to `http://localhost:<port>/signin`, then **stop and ask the camp lead** to sign in in that window, as plan 04 Task 27 Step 6 does.

Then block every **server action** that writes, with plan 04 Task 27 Step 7's `page.route` code, unchanged, and its positive control (a turned item shows "לא נשמר —"). This check never saves to the shared development database without the camp lead's approval.

The upload is not a server action: it is `POST /site/underlay/<planId>`, which the block lets through. It writes only to this worktree's gitignored `.uploads/`. Saving where the picture lies is a server action, so it is blocked, and the top bar says "לא נשמר" from the first upload on. That is the block working. The picture still shows, because the editor draws its own state and the image route reads the local file.

- [ ] **Step 7: Walk spec §18 with the camp lead's sketch — in plan and in 3D, light and dark**

Take a screenshot (`browser_take_screenshot`, named `site-underlay-<n>-<what>.png`) wherever the expectation is visual.

| # | Do | Expected |
|---|---|---|
| 1 | In the plot inspector ("המגרש"), click the row "תמונת רקע" ("העלאת תמונה") | The card "תמונת רקע" with the invitation text, "העלאת תמונה", and "PNG, JPEG או WebP, עד 4 מגה־בייט" |
| 2 | Click "העלאת תמונה", then `browser_file_upload` with the sketch's path | "מעלה…", then the sketch under the map at 50%, as wide as the plot and centred on it. The view goes to plan, and the card reads "סימון הנקודה הראשונה על התמונה". **Draw order:** the grid lines and the dashed fence are drawn *over* the picture, and every item stands over it. |
| 3 | Click the picture beside the plot (off the image), then two points 10 px apart | "הנקודה מחוץ לתמונה.", then "שתי הנקודות קרובות מדי זו לזו…" |
| 4 | Click the two ends of the sketch's 26 m arrow. Type `26`. Tick "הקו הזה מקביל לגדר" if the arrow runs along the fence. Press "כיול". | The view returns to 3D. The card reads "כויל לפי 26 מ׳ שסומנו על התמונה" and "מכסה על המפה … מ׳", and the two points and their line are drawn while the card is open. |
| 5 | Plan view (`2`). With the measure tool (`m`), measure from each of the sketch's fence corners to the drawn fence's corner | Each is within one grid step (0.5 m). This is spec §22's browser check for C: say the four numbers in the PR body. |
| 6 | Press "הזזה". Drag the picture 1 m, press `ArrowRight`, `Shift+ArrowUp`, "סיבוב רבע ימינה", "סיבוב רבע שמאלה", then `Escape` | It moves with the drag, 10 cm, then a metre, turns about its middle both ways, and the tool ends. `Meta+z` five times undoes each step, one at a time. |
| 7 | The slider "שקיפות" to 10%, then 100%; the tool-row switch "תמונת רקע" off and on | The picture fades, then covers, then hides and returns. The top bar does not change for any of these: nothing is sent. |
| 8 | Drag a tent from the library onto the picture; click bare picture | The tent lands where it was dropped. The click clears the selection: the picture never takes a click. |
| 9 | "ייצוא תמונה" with the picture shown, then with it hidden. Open both PNGs (the Read tool reads an image) | The first shows the sketch under the map; the second does not |
| 10 | "החלפת תמונה" with the phone photo (if there is one) | The toast "תמונת הרקע הוחלפה" with "ביטול". The photo stands upright (Review Focus #1). It keeps the old middle and width, unturned, and reads "לא כוילה". "ביטול" brings the sketch back, calibrated as before. |
| 11 | "העלאת תמונה" with a PDF (any), and a `.heic` if there is one | "קובץ PDF אי אפשר להעלות כרקע…", and "הדפדפן לא מציג תמונות HEIC…" |
| 12 | "הסרת התמונה" | "תמונת הרקע הוסרה מהמפה. הקובץ עצמו נשמר, כדי שאפשר יהיה לבטל." with "ביטול", which brings it back |
| 13 | Repeat rows 2, 6, 7 and 8 in dark (`browser_evaluate`: `() => { document.documentElement.dataset.theme = 'dark'; }`) | The picture's colours are the same in both themes: it is unlit. The card reads in dark. |
| 14 | `browser_console_messages` with `level: "error"` | None |

In every row the picture is never mirrored: Hebrew written on the sketch reads right to left, as on paper.

- [ ] **Step 8: Only admins can see the picture (Review Focus #4, in the real app)**

With `browser_run_code_unsafe`, pass as `code` (fill in the URL the card's picture is served from; `browser_network_requests` names it):

```js
async (page) => {
  const url = 'http://localhost:<port>/site/underlay/<planId>/<sha256>.<ext>';
  const signedIn = await page.request.get(url);
  const stranger = await page.context().browser().newContext();
  const anonymous = await stranger.request.get(url);
  await stranger.close();
  return {
    signedIn: signedIn.status(), cache: signedIn.headers()['cache-control'], sniff: signedIn.headers()['x-content-type-options'],
    anonymous: anonymous.status(),
  };
}
```

Expected: `{ signedIn: 200, cache: 'private, max-age=31536000, immutable', sniff: 'nosniff', anonymous: 401 }`. If `anonymous` is 200, **stop**: the picture is public. Report it before anything else.

- [ ] **Step 9: Leave everything as it was found**

1. Press "טעינת הגרסה העדכנית" in the save-error banner. It is a read, which the block lets through, so every unsaved edit of the walk is dropped and the map is the database's again.
2. Close the browser. Stop the dev server: the background task's stop, or `kill` the pid that `lsof -nP -iTCP:<port> -sTCP:LISTEN` names.
3. The uploaded files are in `.uploads/site-underlays/<planId>/` in this worktree. They are gitignored and the camp lead's own. Tell the camp lead where they are, and delete nothing without their word.
4. Copy the screenshots the MCP saved into `.superpowers/site-underlay/`.
5. Run `git status --short`. If `AGENTS.md` is modified, it is the Next.js block `next dev` regenerates. Commit it (`git add AGENTS.md`, message "chore: AGENTS.md's Next.js block as next dev writes it"). Nothing else may be uncommitted.

- [ ] **Step 10: The record the camp lead applies `0015` from — `docs/deploy.md` §6**

Read `docs/deploy.md` §6 with the Read tool. After the last "### Migration …" subsection (after `0012`'s, or after #23's and B's records if they are there), add this subsection. Put in the number Step 4 settled on:

````markdown
### Migration `0015` — not yet applied to Railway

`0015_site_underlays` is Part C of the camp map's extensions, the image to trace (spec `docs/superpowers/specs/2026-09-25-site-map-pipes-ropes-underlay-design.md` §16–19). It adds one new, empty table, `site_underlays`: one row per map, with a foreign key to `site_plans` that cascades. It is additive, and no existing row is touched. It must be on Railway **before** the code that reads it deploys, because every `/site` load reads the table (`loadDoc` → `readUnderlay`). Applying it is the camp lead's decision. Apply `0013` and `0014` first, if their records above say they are not applied yet.

The pictures are not in the database. They go to the same private Vercel Blob store as the workbooks (`STORAGE_DRIVER=blob`, written with `access: 'private'`), under `site-underlays/<planId>/<sha256>.<ext>`. Only `GET /site/underlay/<planId>/<file>` reads them back, and only for admins: the proxy does not gate image paths, and the route's own `requireAdmin` does. There is no new environment variable and no new service. Removing a picture from a map keeps its file, so that an undo can bring it back; erasing files waits for a storage delete.

Read-only check (before: nothing; after: `site_underlays`):

```sh
docker run --rm -e R="$RAILWAY_URL" postgres:18-alpine sh -c '
  psql "$R" -tAc "select table_name from information_schema.tables
    where table_schema='"'"'public'"'"' and table_name='"'"'site_underlays'"'"'"'
```

Then:

```sh
docker run --rm -e R="$RAILWAY_URL" -v "$PWD/drizzle:/m:ro" postgres:18-alpine sh -euc '
  psql "$R" -v ON_ERROR_STOP=1 -1 -f /m/0015_site_underlays.sql
'
```

Afterwards the query above prints `site_underlays`. The parity check at the top of this section must come back empty against a local database that also carries `0015`.
````

```bash
git add docs/deploy.md
git commit -m "docs(deploy): the record for migration 0015 — the image to trace; not applied to Railway

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 11: Say what is in flight — `docs/collab/claims.md`**

Read `docs/collab/claims.md`, §1 first, since it is built to be checked. In §3, add a row for this lane. If a row for the camp map's extensions exists, replace it instead. Put in Step 2's numbers and today's date:

```
| @Yarin-Shitrit | Camp map — Part C, the image to trace (תמונת רקע) | `feat/site-underlay` | **ready for review** — spec `docs/superpowers/specs/2026-09-25-site-map-pipes-ropes-underlay-design.md` §16–19, plan `docs/superpowers/plans/2026-09-25-site-underlay.md`. <total> tests in <files> files, 0 failed (this lane's scope). Touches shared surfaces: migration **`0015_site_underlays`** (generated, **not applied to Railway** — the camp lead's step, `docs/deploy.md` §6), `docs/deploy.md`, this file, and the site-3d overview's contract. Shares 12 files with #23 (the PR body lists them) | <today> |
```

Bump the `**updated: …**` stamp at the top to today, then:

```bash
git add docs/collab/claims.md
git commit -m "docs(collab): the image to trace is ready for review

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 12: Write the PR body to a file**

Create `.superpowers/site-underlay/pr-body.md`. It is gitignored; the camp lead opens the PR. Fill every `<…>` from this task's own output, never from memory:

```markdown
## What this does

A lead uploads a photo or scan of the camp's sketch in the map's new card "תמונת רקע". It lies under the map, see-through, and only admins can see it. Two clicks and a typed distance set its scale, and a box straightens it. Drags, arrows and quarter turns line it up, and items are placed on it by hand as before. Where it lies is saved, versioned and undoable. How see-through it is and whether it shows belong to each viewer and are never saved.

Spec: `docs/superpowers/specs/2026-09-25-site-map-pipes-ropes-underlay-design.md` §16–19. Plan: `docs/superpowers/plans/2026-09-25-site-underlay.md`.

## Privacy

- Pictures are stored through the existing driver: private Vercel Blob in production, `.uploads/` (gitignored) in development.
- They are served only by `GET /site/underlay/<planId>/<file>`, which calls `requireAdmin` and serves only that map's own keys. The proxy exempts image paths, so this guard is the only gate. It is tested, and checked in a browser: signed out, 401.
- Nothing is sent to any other service. No picture is committed.

## Shared surfaces touched

- `drizzle/0015_site_underlays.sql`, `drizzle/meta/0015_snapshot.json`, `drizzle/meta/_journal.json`: the shared migration sequence. Generated with `drizzle-kit generate`, never `push` or `migrate`. The number was re-checked against `main` on <date>. **Not applied to Railway:** the camp lead applies it by hand (`docs/deploy.md` §6, record added here), **before** this deploys, because every `/site` load reads the new table.
- `docs/deploy.md` §6: the record for `0015`.
- `docs/collab/claims.md`: this lane's row.
- `docs/superpowers/plans/2026-09-24-site-3d-00-overview.md`: the interface contract, amended first (Part C's additions). One deviation: `EditorDoc.underlay` is optional (see Merge notes).
- Not touched: `package.json`, `next.config.ts`, `src/lib/storage/**`, `src/proxy.ts`.

## Merge notes with #23 (pipes and cables)

C shares 12 files with #23: `drizzle/meta/_journal.json` (+ the snapshot sequence), `src/db/schema/site.ts`, `src/lib/site/editor/model.ts`, `src/lib/site/editor/ops.ts`, `src/lib/site/plan.ts`, `src/app/(admin)/site/failure-messages.ts`, `src/app/(admin)/site/editor/site-editor.tsx`, `src/app/(admin)/site/editor/scene/engine.ts`, `src/app/(admin)/site/editor/scene/scene-view.test.tsx`, `src/app/(admin)/site/editor/panels/inspector-plot.tsx`, `docs/collab/claims.md`, `docs/deploy.md`.
- Every conflict is two additions in one place: keep both. `applyOps` must return `lines` and `underlay`.
- The migration is regenerated after #23's `0013`, never hand-merged.
- `EditorDoc.underlay` is optional so that the ~18 test files #23 edits for `lines` are not edited again here. After #23, C's own test fixtures gain `lines: []`.

## Tests

This lane's scope, capped (`--maxWorkers=4`): **<total> tests in <files> files, <passed> passed, 0 failed, 0 pending** (`exit=0`). `npx tsc --noEmit` clean, `npm run lint` clean, `next build` green, with both image routes dynamic. Full suite: <run by the coordinator on <date>: … / handed to the coordinator>.

## Checked in a browser

On the local dev server with the camp lead's own sketch, with every server-action write blocked, signed in by the camp lead:
- upload, draw order (the grid and the fence over the picture, items over it), calibration on the 26 m arrow;
- the fence corners within a grid step: <four measured numbers>;
- alignment by drag, arrows and quarter turns, each undone one step at a time;
- opacity and the switch, with nothing sent; tracing a tent onto it;
- PNG export with the picture shown (in it) and hidden (not in it);
- replace <with a phone photo, upright / not checked: no photo>, PDF <and HEIC> refusals, remove with ביטול;
- light and dark, plan and 3D.
The image route answered 200 signed in and 401 to a fresh context. Console: <no errors / list>. Screenshots: `.superpowers/site-underlay/` (not committed; ask for them).

## Before merging

- Re-check the migration number against `main` (plan Task 10 Step 4).
- Apply `0015` to Railway (`docs/deploy.md` §6), before the deploy.
- Review from @josefcohen96 (the shared surfaces above).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Read the file back once with the Read tool: every `<…>` must be gone.

---

## When Task 10 is done

A lead can put the camp's sketch under the map, scale it from one distance, straighten and line it up, and trace over it. Only admins can ever see it. Its file is stored privately and its placement is saved in the map's own versioned batches. The migration number matches `main`, the §6 record says how the camp lead applies it, `claims.md` says the work is ready, and the PR body is on disk.

---

## Self-review

Run against the spec with fresh eyes after the plan was written.

**1. Spec coverage** (Part C, §16–19, plus §1–4 and §20–26 where they concern C):

| Spec | Where |
|---|---|
| §1 C.1 upload, see-through; C.2 two points + distance; moves and quarter turns; C.3 items by hand; C.4 admins only | Tasks 5, 8, 9 (upload); 6 (plane at 50%); 2, 3, 9 (calibration); 7, 9 (moves, turns); 7 (click-through, tested); 5 (the guard), 10 Step 8 |
| D10 no recognition, no new service; D19 placement saved, view not; D20 types, 4 MB, private | Global Constraints; Tasks 3–4 (op, table); 7 and 9 (`EditorUi.underlay`, "nothing is saved" test); Tasks 1, 5 |
| D21 / binding change: migration `0015`, generated, re-checked at merge, applied by hand | Task 4 Steps 1 and 5; Task 10 Steps 4 and 10 |
| §4's C files: `underlay.ts`, `image-facts.ts`, `underlay-limits.ts`, both routes, `underlay-mesh.ts`, `underlay-card.tsx` | Tasks 2, 1, 1, 5, 6, 8. Added: `underlay-file.ts`, the shared check; `underlay-commands.ts`; `underlay-tool.ts`, so `gestures.ts` is untouched; `underlay-upload.ts`; `use-underlay.ts`. |
| §16: one image per plan; `copyPlan` does not copy; key by hash; the same file writes nothing new; `access: 'private'`; GET admin-only, prefix-only; export includes it when shown, and the card says so; remove keeps the file and the toast says so; the POST's order and codes; the GET's pattern, headers and size | Task 4 (PK, copy test); Tasks 1, 5 (key, dedupe incl. Blob); Task 5 (both routes, every code, 4 MB ± 1, headers); Task 6 (hidden → `visible = false`); Task 8 (export note); Task 9 (remove toast) |
| §17: the table's columns; calibration as fractions; rotation in tenths; `EditorDoc.underlay`; `setUnderlay` apply, invert and coalesce; server shape check + this plan's prefix; upsert or delete; `uploaded_*` on key change; `EditorUi.underlay`, shown at 50% | Tasks 3, 4, 7 |
| §18.1 invitation, button, drop, client checks + one decode; §18.2 centred, plot-wide, 50%, "קנה המידה זמני", straight to calibration, "לא כוילה"; §18.3 the tool, plan and back, A then B, the form, `readMetres`/`SIDE_RANGE`, the parallel box, one history entry, 20 px and off-image refusals; §18.4 drag, arrows 10 cm / 1 m, quarter turns, Esc/סיום, one undo step each; §18.5 tracing unchanged; §18.6 opacity 10–100 by 10, the toggle only with an image; §18.7 replace keeps centre and width, clears calibration; §18.8 remove with ביטול; the card's report lines and the calibration segment | Tasks 8 (card, upload), 9 (flows, keys, toggle, row), 2–3 (maths, one op each), 7 (marks drawn, the tools) |
| §19: y = 1 mm; `MeshBasicMaterial`, unlit; opacity; no depth; render order −3.5, the same in plan and 3D; fetched from the GET route; `createImageBitmap` with `imageOrientation: 'from-image'` and resize to ≤ 4096 or the GPU's limit; sRGB; aspect from the decoded image; never mirrored; click-through except in the two tools; rebuilt on context restore; freed on replace or remove; "טוען…", failure + retry | Task 6 (all of the plane), Task 7 (engine: URL, tools, context restore, `maxTextureSize`), Task 8 (card states) |
| §20 the image's copy, word for word; upload codes and the fallback; the three server prefixes | Tasks 1, 3, 8, 9 |
| §21 the product's rules | "Temporary scale" (Task 8). Every scale figure opens the calibration (Task 8). The calibration line's source (Task 8). Invitations (Tasks 8, 9). Codes to Hebrew (Tasks 1, 8). Never mirrored (Tasks 2, 6). |
| §22 C's tests | `underlay.ts`'s four (Task 2). `image-facts.ts` with every header named (Task 1). DB: migration, another plan's key, copy, `loadDoc` (Task 4). Routes (Task 5). Scene without a GPU (Tasks 6, 7). Panels (Tasks 8, 9). Browser with the camp lead's sketch (Task 10). Spec review focus #5 is this plan's #1. |
| §23 contract amended first; shared surfaces; not touched | Task 1 Step 1; Task 10 PR body; Global Constraints |
| §24 C after B, standing alone; A's ties (`EditorUi.tool`, `SiteOp`, `loadDoc`, `applySiteOps`) | "Order, Part B, and the files shared with #23"; `GestureWorld.tool()` kept unchanged |
| §25 out of scope (one image, no PDF/HEIC/SVG/GIF, no perspective, no erase, no recognition) | Nothing built for any of them; the refusals say so |
| §26 risks: 4.5 MB limits, phone photos, unused Blob files, a sensitive upload, two leads calibrating | Tasks 1, 5; Review Focus #1; the remove toast and §6 record; the version check (Task 4 conflict test) |

No spec requirement is left without a task.

**2. Placeholder scan.** Searched for "TBD", "TODO", "implement later", "appropriate", "similar to Task", and steps without code. The only `<…>` are in Task 10's PR body and claims row, which that task fills from its own output and then re-reads. `00NN` is the migration number drizzle-kit assigns, and Task 4 Step 1 and Task 10 Step 4 say how it is read and checked.

**3. Type consistency.**
- Names checked across tasks: `UnderlayPlacement`, `ImagePoint`, `MapPoint`, `UnderlayCalibration`, `EditorUnderlay`, `underlayOf`, `sameUnderlay`, `copyUnderlay`, `setUnderlay`, `underlayRefusal`, `UploadedUnderlay`, `uploadOps`, `placeOps`, `calibrateOps`, `removeUnderlayOps`, `readUnderlay`, `UnderlayStatus`, `UnderlayEvent`, `DecodedUnderlay`, `UnderlayLoader`, `UnderlayLayer`, `UNDERLAY_RENDER_ORDER`, `UNDERLAY_LIFT_CM`, `UnderlayGestures`, `UnderlayIntent`, `classifyPick`, `CALIBRATION_MIN_PX`, `CalibrationDraft`, `UnderlayCardProps`, `UploadOutcome`, `UploadDeps`, `uploadUnderlay`, `UnderlayDeps`, `UnderlayController`, `useUnderlay`, `retryUnderlay`, `underlayMarks`, `onUnderlay`, `hasUnderlay`.
- The refusal texts match between `ops.ts` (Task 3), `plan.ts` (Task 4) and the Hebrew test (Task 3):
  - `an underlay file must be a png, jpeg or webp image uploaded to a map`;
  - `an underlay file must be one uploaded to this map`;
  - `an underlay placement must be whole centimetres and tenths of a degree`;
  - `an underlay calibration must be two points on the image and a distance of 10 cm to 500 m`.
- The mesh is named `underlayPlane` and its group `underlay`, in Tasks 6 and 7.
- The label `'הזזת תמונת הרקע'` is the same in the engine (Task 7), the hook (Task 9) and the test (Task 7).

**4. Review Focus.**
- Checked against the spec's inputs that no feature test hits.
- The five chosen each have a named test in their owning task:
  - #1: Tasks 1, 2, 6;
  - #2: Task 5;
  - #3: Task 8;
  - #4: Task 5, and Task 10 Step 8 in the real app;
  - #5: Task 6.
- Each of those tasks carries a step proving the test can fail. The spec's own review focus #5 (the EXIF photo) is this plan's #1.
- Considered and covered by ordinary tests instead:
  - an out-of-range calibration (Tasks 2, 9);
  - the same picture uploaded as a replacement, which changes nothing (Task 3);
  - uppercase extensions (Task 1);
  - 100 and 8192 px exactly (Task 1);
  - a drop where the drag started (Task 7, through `placeOps`' `[]`).

**Decisions this plan makes that the spec does not, for the reviewer:**
1. **`EditorDoc.underlay` is optional**, where §17 writes `EditorUnderlay | null`. Absent and null both mean none, `loadDoc` always sets it, and every reader goes through `underlayOf`. The reason is the merge cost with #23. It is recorded in the contract (Task 1).
2. **One Hebrew sentence §20 does not have:** `SCALE_OUT_OF_RANGE` ("בקנה המידה הזה התמונה הייתה מכסה פחות מ־10 ס״מ או יותר מ־500 מטר. כדאי לבדוק את המרחק שהוקלד."). Without it, the server would refuse the whole batch with the placement sentence, which is the wrong reason and halts every edit queued with it.
3. **A replacement also resets the turn to 0.** §18.7 says it keeps the centre and the width and clears the calibration, and is silent on the turn. A turn set by the parallel box belonged to the old picture.
4. **The DB tests live in `plan.underlay.test.ts`, not `plan.test.ts`** (§22), and the op tests in `ops.underlay.test.ts`, because both originals are #23's files.
5. **The GET route answers 404 for any storage failure**, as §16 says. A Blob outage therefore reads as "קובץ התמונה לא נמצא" rather than as a retryable failure. This is kept to the spec and noted here.
6. **A copy question for the camp lead:** the slider is labelled "שקיפות" (§20) but moves the picture's *opacity* (§18.6). At 50% they agree; at 10% "שקיפות 10%" would read as nearly opaque while the picture is nearly invisible.
