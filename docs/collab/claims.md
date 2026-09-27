# What is in flight

**updated: 2026-09-27** · if that date is more than a day or two old, **this file
is fiction**. Read §1 before you act on §3.

This is the only document in `docs/collab/` that goes stale, and it goes stale
fast — the first version of it was wrong within two hours of being written. So it
is built to be checked, not believed. §1 is how you check. §2 is who to ask when
checking is not enough.

---

## 1. Check before you trust

```sh
# What has actually landed, and when — /usr/bin/git because the RTK hook
# corrupts `git log` in this repo.
/usr/bin/git fetch origin
/usr/bin/git log --oneline -20 origin/main
/usr/bin/git ls-remote --heads origin        # every branch anyone has pushed

# Is someone in this tree right now?
/usr/bin/git status                          # their staged work becomes your commit
pgrep -fl claude                             # sessions on this machine
pgrep -fl vitest                             # a run in progress explains a mass red
```

Inside a Claude session, `ListAgents` shows live sessions by name, and you can
message one directly to ask what it is holding. That is a better answer than this
file, because it is generated at the moment you ask.

**A branch's last commit tells you more than this table does.** If
`origin/feat/logistics-*` moved an hour ago, logistics is active regardless of
what is written below.

## 2. Who to ask

| Area | Ask | Reach them at |
|---|---|---|
| Phase 4 UI redesign, the money model, anything about the camp's real data | @Yarin-Shitrit (camp lead) | — |
| Logistics | @josefcohen96 | — |

> Both handles are real; the contact columns are not. A GitHub handle is enough
> to tag someone on a PR, which is the path this harness actually depends on.
> Add a faster channel if you have one — "ask Yarin" is not actionable at 23:00
> on a Saturday unless it says how.

Decisions that are **always** the camp lead's, never settled between sessions:
adding a dependency (ruling R1), restarting or resetting the database, anything
touching `docs/reference-data/`, and pushing or force-pushing shared branches.

## 3. Current claims

| Who | Area | Branch | State | As of |
|---|---|---|---|---|
| @Yarin-Shitrit | Phase 4 UI redesign | merged to `main` | **done** — all twelve plans landed; CI green on `main` at 2640 tests in 203 files, 17m21s | 2026-09-19 |
| @Yarin-Shitrit | Promotion gate + sheet retirement | merged to `main`; migration `0008` pending | **active** | 2026-09-19 |
| @josefcohen96 | Logistics | merged to `main` (#8, #9, #11, #12) | **done** — the three screens (מחסן, רכש, הקמה), the rail entry and the two exports are on `main`. **Migrations `0009` and `0010` were applied to Railway by hand on 2026-09-24** (`docs/deploy.md` §6 has the record and the procedure), which unblocked every `/logistics/*` page and `/site` in production. Verified signed-in on a local database carrying both: all four screens render in Hebrew. #11 also added one shared error boundary at `src/app/(admin)/error.tsx`. Not yet verified by a human in the production browser. **#12 (merged 2026-09-24): camp-wide רכש rows** — `acquisition_items.season_id` is nullable; migration **`0011`** is on `main` and **not yet applied to Railway** (`docs/deploy.md` §6 has the read-only check and the `psql -f` command; applying it is the camp lead's step, like `0009`/`0010`). Until then, ticking «לא שייך לברן מסוים» fails in production and every other רכש path works | 2026-09-24 |
| @josefcohen96 | Logistics — boxes in the warehouse | `claude/shliff-warehouse-csv-download-da0z0f` | **active** — a box is a named place; an item in a box needs no location of its own; a box drawer lists its contents and edits it. Touches shared surfaces: migration **`0016_warehouse_boxes`** (generated, **applied to Railway on 2026-09-26** — `docs/deploy.md` §6 has the measured record), `drizzle/meta/*`, and one earlier commit on the same branch in `src/components/ui/button.tsx` (a download link opens in its own browsing context, for the home-screen app). Scoped run: 22 files, 313 tests, 0 failed. Review goes to @Yarin-Shitrit | 2026-09-26 |
| @josefcohen96 | Camp map — item groups and Ctrl free-move | merged to `main` (#41, 2026-09-26) | **done** — migration **`0017_site_item_groups`** is on `main` and **applied to Railway on 2026-09-26** (`docs/deploy.md` §6 has the measured record); it must be applied before the code deploys, since every load of `/site` selects the column | 2026-09-26 |
| @josefcohen96 | Camp map — a turn keeps which way a sofa faces | `fix/site-turn-four-ways` | **active** — the whole area is @Yarin-Shitrit's (`ownership.md`), so this is a change *proposed into* it: `site_items.facing` (0–3 quarter turns) rides along with the width/depth swap, so a square turns too and four turns bring anything home; the scene draws a sofa's back on the edge the facing names. Touches shared surfaces: migration **`0018_site_item_facing`** (one not-null column plus a row update for tall sofas; generated on top of `0017_site_item_groups`, **applied to Railway on 2026-09-26** — `docs/deploy.md` §6 has the measured record), `drizzle/meta/*`, `docs/deploy.md`. Review goes to @Yarin-Shitrit; not self-merged | 2026-09-26 |
| @josefcohen96 | Camp map — saved plans (תוכניות שמורות) | `feat/site-saved-plans` | **active** — the same standing as the rows above: proposed into @Yarin-Shitrit's area. A lead keeps the map under a name from a card in the editor's top bar, and loads any kept plan back as one ordinary edit — one undo step, saved through the queue against the version; a locked item stays as it is and is named. New files under `src/lib/site/` (`snapshots.ts`, `editor/restore.ts`) and `site/editor/` (`use-saved-plans.ts`, `panels/plans-card.*`); `actions.ts`, `failure-messages.ts`, `site-editor.tsx` and `src/db/schema/site.ts` edited. Touches shared surfaces: migration **`0019_site_plan_snapshots`** (one new empty table, generated on top of `0018_site_item_facing`, **applied to Railway on 2026-09-26** — `docs/deploy.md` §6 has the measured record), `drizzle/meta/*`, `docs/deploy.md`, this file. Review goes to @Yarin-Shitrit; not self-merged | 2026-09-26 |
| @josefcohen96 | Camp map — a square tent’s turn is seen | `fix/site-turn-every-item` | **ready for review** — proposed into @Yarin-Shitrit’s area like #41/#42: a square tent’s gable ridge now follows its facing (east–west at 0 and 2, north–south at 1 and 3), so a turn of the default 3 × 3 tent is visible and four turns are four pictures; sofas and armchairs already turned four ways on `main` (#42). Two files under `site/editor/scene/`, no migration, no shared surface. Scoped run (`src/app/(admin)/site`, `src/lib/site`): 84 files, 1250 tests, 0 failed, 0 pending, exit 0; browser walk done against a throwaway copy of the local database. Review goes to @Yarin-Shitrit; not self-merged | 2026-09-26 |
| @josefcohen96 | Camp map — the floating labels' look | `feat/site-floating-labels-look` | **ready for review** — proposed into @Yarin-Shitrit's area like #41/#42/#45/#49, after the camp lead found the label-modes mock's floating names nicer than the shipped cards: a name is now bold ink with a halo in the canvas colour and no box, at three sizes by footprint (under 1.5 m² small, from 12 m² large); an item outside the plot or overlapping is named in the problem colour; the selected item's card and a group's count keep their box. Spec §9 gains a rule 8. Layout, engine and layer changed in `src/lib/site/editor/label-layout.ts` (two fields carried through), `scene/engine.ts`, `scene/labels-layer.tsx`, `scene/scene.module.css`; no migration, no dependency, no shared surface. Scoped run (`src/lib/site/editor`, `src/app/(admin)/site/editor`): 70 files, 1038 tests, 0 failed, 0 pending, exit 0; `tsc` clean; screenshots in both themes and both views against a throwaway copy of the local database. Known and left alone: the selection toolbar can sit over the selected card (the layout is not told where the toolbar is; spec §9.3 says it should be) — it predates this branch. Review goes to @Yarin-Shitrit; not self-merged | 2026-09-27 |
| @josefcohen96 | Camp map — three label styles (מרחפות · בלי · מודפסות) | merged to `main` (#49, 2026-09-26) | **done** — proposed into @Yarin-Shitrit's area like #41/#42/#45 (plan `docs/superpowers/plans/2026-09-26-site-label-modes.md`): the tool row's labels switch has three positions; *printed* draws each item's name on its roof, lid, cloth, seat or wall as a decal lit and shadowed with the scene, recoloured by the theme, and in the exported PNG; the choice is remembered per browser. The camp lead answered the plan's three questions on 2026-09-26: opens floating, remembered, no key. New modules `src/lib/site/editor/prints.ts`, `scene/print-texture.ts`, `scene/prints.ts`, `editor/label-mode-memory.ts`; no migration, no dependency, no shared surface; the site-3d overview's contract and spec §9/§10 amended. Scoped run (`src/app/(admin)/site`, `src/lib/site`, `src/test`): 93 files, 1358 tests, 0 failed, 0 pending, exit 0; browser walk done against a throwaway copy of the local database. Review goes to @Yarin-Shitrit; not self-merged | 2026-09-26 |
| @Yarin-Shitrit | Collaboration harness + CI | merged to `main` | done | 2026-09-19 |
| @josefcohen96 | CI — no run for a docs-only change | `claude/billing-issue-drfpfw` | **ready for review** — proposed into @Yarin-Shitrit's harness: `ci.yml` gains `paths-ignore` for `docs/**` and `**.md` on both triggers, so a prose-only PR or merge runs no jobs and fires no deploy. Cause: GitHub Actions has refused every run since ~10:30 UTC on 2026-09-26 — each fails in seconds with no runner and no steps, which is the block for a private repository whose included minutes are spent — and six of the day's last eight runs were docs-only commits. Nothing under `docs/` is read by a test or a build, so no coverage moves. Touches shared surfaces: `.github/workflows/ci.yml`, `docs/deploy.md` §3, this file. Review goes to @Yarin-Shitrit; not self-merged | 2026-09-26 |
| @Yarin-Shitrit | Camp map (מפת הקאמפ) | `feat/site-map-3d` | **active** — the 3D editor (spec `docs/superpowers/specs/2026-09-24-site-map-3d-editor-design.md`). The first map merged as `ad81bb2`. Touches shared surfaces: `package.json` (`three`, the R1 exception recorded in `ownership.md`), migration **`0012`** (generated, not applied to Railway), this file and `ownership.md` | 2026-09-24 |
| @Yarin-Shitrit | Camp map — shade-net ropes (spec Part B) | `feat/site-ropes` | **ready for review** — a net's ropes drawn to their stakes; once the camp sets an angle, the rope footprint is what the fence check, the new rope-band check, the gaps while dragging and "שטח תפוס" measure; shade stays the cloth's (spec `docs/superpowers/specs/2026-09-25-site-map-pipes-ropes-underlay-design.md` §§12–15, plan `docs/superpowers/plans/2026-09-25-site-ropes.md`). Scoped run (site, `src/lib/site`, `src/db`, the sweeps) 1595 tests in 77 files, 0 failed; the full suite is the coordinator's. **Browser walk (plan Task 11 Steps 6–9) not done**: `shliff-pg` was stopped on purpose. Touches shared surfaces: migration **`0014_site_rope_angles`** (generated, **not applied to Railway** — the camp lead's step after `0013`, `docs/deploy.md` §6; not yet applied to the local `shliff-pg` either), `drizzle/meta/*`, the overview plan's interface contract, this file. Review goes to @josefcohen96 | 2026-09-25 |
| @Yarin-Shitrit | Camp map — Part C, the image to trace (תמונת רקע) | `feat/site-underlay` | **review approved; lands after the ropes; browser check pending** (`shliff-pg` stopped) — spec `docs/superpowers/specs/2026-09-25-site-map-pipes-ropes-underlay-design.md` §16–19, plan `docs/superpowers/plans/2026-09-25-site-underlay.md`. With the ropes merged in: 1736 tests in 93 files, 0 failed, 0 pending (this lane's scope: `src/app/(admin)/site`, `src/lib/site`, `src/lib/storage`, `src/db` and the sweeps). Touches shared surfaces: migration **`0015_site_underlays`** (generated on top of Part B's `0014_site_rope_angles`, which this branch has merged; **not applied to Railway** — the camp lead's step, `docs/deploy.md` §6), `docs/deploy.md`, this file, and the site-3d overview's contract | 2026-09-25 |
| @Yarin-Shitrit | Hosting on Vercel + Railway | merged to `main` | **live** at <https://shliff-platform.vercel.app>. Vercel project is deliberately **not** Git-connected — do not connect it. Railway Postgres 18 in `europe-west4` holds the real data. Runbook: `docs/deploy.md`. **`drizzle-kit push` is now forbidden alongside `migrate`** — see the runbook §6. Signed-in pages not yet verified by a human | 2026-09-19 |

### Phase 4, in more detail

Reported by the session executing it on 2026-09-18, **not independently verified
— confirm with §1 before relying on it**:

- **Wave 2 complete and merged** — plans 06 (אנשים), 07 (דמי קאמפ), 08 (כספים),
  10 (משימות). Gate reported at 150 files, 1760 tests, 0 failures.
- **Merged to `main` on 2026-09-19** and verified there by CI: 203 files, 2640
  tests, zero failed, zero pending, 17m21s. Every surface marked *(ui)* in
  `ownership.md` is now on `main`, so that branch qualifier is history rather
  than a live caveat.
- One class of bug got through the whole gate and was caught in a browser: a
  `'use server'` file exporting a string constant beside its server actions
  makes Next reject the entire module, returning 500 on **every** route
  including `/signin`, while `tsc`, `eslint`, `next build` and 868 unit tests
  all passed. A static net for that rule has been added.
- Still ahead: wave 4 (plan 04 בית), wave 5 (plan 12 mobile and polish, which
  deletes wave 0's token aliases).

**If you are starting logistics while wave 3 is live**, the collision risk is
`src/lib/money/**` and the import surface. `src/lib/errors/hebrew.ts` has
settled, so Hebrew error strings are safe to add — add to that map, never start
a second one.

**Also in flight on the data side**, and easy to miss because it is not a UI
plan: `main` now carries a promotion gate that skips any workbook table already
owning rows, and a migration `0008` adding sheet retirement is coming. If your
work reads `sheets` or renders block state, both change what it sees.

### Environment, as of 2026-09-19

- **Container state is a property of right now, not of the repo.** Any document
  asserting it is stale the moment it is written — this one included. Run
  `docker ps -a --filter name=shliff` and believe that instead.
  `shliff-pg` serves port **5433**, and it is stopped deliberately from time to
  time to relieve memory pressure on the dev box, so connection errors from a
  DB-backed page are the first thing to check and the last thing to blame on
  code. Starting or stopping it is the camp lead's call. On 2026-09-18 it was
  stopped and then restarted, with the lead's approval, inside an hour — that is
  the cadence you are documenting against.
- `origin` carries `main` (`70a957c`) and `feat/ui-01-foundation`. Both were
  pushed on 2026-09-18 after nine days in which the remote held nothing newer
  than 2026-09-09. **Push early** — that gap put 334 commits on one laptop.
- **CI runs on every PR and every push to `main`**: typecheck, lint, and the
  suite with a guard that refuses a run which did not actually run. Measured at
  903 tests in 11m20s on `main`; Phase 4 roughly doubles that. **Except a
  change that touches only `docs/` or `*.md`**, which runs nothing and so
  deploys nothing (since 2026-09-26; the header of `.github/workflows/ci.yml`
  says why — the private repository's paid minutes ran out that day).
- **Fixed 2026-09-19: a fresh clone now runs its own tests.** `package-lock.json`
  used to resolve none of rolldown's fifteen platform bindings, so `npm ci`
  installed no native binding and vitest died at startup. The lockfile was
  regenerated (delete first — an in-place regeneration is a no-op) and is green
  at 2640 tests. Older plan documents under `docs/superpowers/` still say
  **"never run `npm install`"**; that warning was correct when written and its
  cause is gone. `npm ci` is still the right command, for reproducibility.
- **Several sessions share this box.** `pgrep -fl vitest` before believing a mass
  red, and before assuming a running suite is yours — attributing one by repo
  rather than by measurement has already misdirected two sessions. Resolve the
  owner from the process's own command line.

## 4. Updating this file

Add your row when you start. Change it when the branch or state changes. **Delete
it when the work merges.** Bump the `updated:` date at the top every time — it is
the only thing that tells the next reader whether to believe the rest.

A claim that outlives its work is worse than no claim at all: the next person
routes around a file nobody is holding, and pays for a conflict that no longer
exists.
