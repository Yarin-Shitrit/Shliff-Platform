# What is in flight

**updated: 2026-09-24** · if that date is more than a day or two old, **this file
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
| @josefcohen96 | Logistics | merged to `main` (#8, #9, #11) | **done** — the three screens (מחסן, רכש, הקמה), the rail entry and the two exports are on `main`. **Migrations `0009` and `0010` were applied to Railway by hand on 2026-09-24** (`docs/deploy.md` §6 has the record and the procedure), which unblocked every `/logistics/*` page and `/site` in production. Verified signed-in on a local database carrying both: all four screens render in Hebrew. #11 also added one shared error boundary at `src/app/(admin)/error.tsx`. Not yet verified by a human in the production browser. **In flight on this laptop (2026-09-24): camp-wide רכש rows** — `acquisition_items.season_id` becomes nullable, migration **`0011`** (generated with `drizzle-kit generate`, one `ALTER … DROP NOT NULL`, **not yet applied to Railway**; `docs/deploy.md` §6 has the procedure). Touches the shared `drizzle/` sequence; nothing else outside logistics | 2026-09-24 |
| @Yarin-Shitrit | Collaboration harness + CI | merged to `main` | done | 2026-09-19 |
| @Yarin-Shitrit | Camp map (מפת הקאמפ) | `feat/site-map-3d` | **active** — the 3D editor (spec `docs/superpowers/specs/2026-09-24-site-map-3d-editor-design.md`). The first map merged as `ad81bb2`. Touches shared surfaces: `package.json` (`three`, the R1 exception recorded in `ownership.md`), migration **`0012`** (generated, not applied to Railway), this file and `ownership.md` | 2026-09-24 |
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
  903 tests in 11m20s on `main`; Phase 4 roughly doubles that.
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
