# Hosting the platform: Vercel + Railway

**Status:** approved 2026-09-19. Supersedes the hosting row of
`2026-09-09-camp-data-platform-design.md:336`, which named **Neon** for the
database. The database is Railway. Vercel and Vercel Blob are unchanged.

> The correction goes here, in the table that was wrong, per `protocol.md` §4.
> `docs/superpowers/specs/2026-09-09-camp-data-platform-design.md:336` still
> reads `| Database | Postgres (Neon) |`. That line is amended by this document
> and must be edited in the same PR that implements it — not left for a reader
> who trusts the older table and stops there.

---

## 1. What this is for

The camp's admin platform currently runs only on one laptop, against a Postgres
container that is stopped by hand to relieve memory pressure. Nobody but the
person at that keyboard can see it. This document takes it to an address the camp
lead can open from a phone.

Success is narrow and checkable:

1. `https://shliff-platform.vercel.app/signin` renders the Hebrew sign-in screen.
2. The existing admin account signs in — no new credential is created.
3. `/inbox`, `/money`, `/members` render the real data that is in the laptop's
   database today.
4. Uploading a workbook through the UI stores it in Vercel Blob and imports it.
5. `docs/reference-data/` has never been transmitted to Vercel.

Point 5 is a constraint, not a nicety. Those three files hold real camp members'
names and real amounts owed.

## 2. Topology

```
Browser (Israel)
      │  HTTPS
      ▼
Vercel — fra1 (Frankfurt)
  Next.js 16 app, Node runtime
  src/proxy.ts gates every route (edge, no DB, no argon2)
      │  TCP + TLS, Railway public proxy
      ▼
Railway — europe-west4 (Amsterdam)
  Postgres 16

Vercel Blob (private)  ← workbook bytes
```

Railway hosts **only** Postgres. There is no app service on Railway.

**The database URL must be Railway's public proxy URL, not its internal one.**
Railway injects `DATABASE_URL` as `postgres://…@postgres.railway.internal:5432/…`,
which resolves only inside Railway's private network. Vercel is outside it. The
value Vercel needs is `DATABASE_PUBLIC_URL` (`…@<host>.proxy.rlwy.net:<port>/…`).
Using the internal one produces a DNS failure that reads like an outage.

**Regions are paired deliberately.** Every admin page issues several sequential
queries, so app-to-database latency multiplies per page load. fra1 ↔
europe-west4 keeps that inside Europe (~10 ms) and puts the functions ~30 ms from
users in Israel. Vercel's default iad1 would cross the Atlantic on every query.

## 3. Deployment: built and shipped from CI, never connected to Git

Vercel's Git integration clones the whole repository into Vercel's build
infrastructure. This repository holds the camp's real workbooks. So **the Vercel
project is created by CLI and never linked to GitHub.** Deploys run from the
GitHub Actions runner:

```
vercel pull --environment=production
vercel build --prod          # on ubuntu-latest, with a dummy DATABASE_URL
vercel deploy --prebuilt --prod
```

`--prebuilt` is what makes point 5 of §1 true: the build happens on the runner,
and only `.vercel/output` is uploaded. `docs/reference-data/` never reaches
Vercel in any form, not even transiently in a build cache. GitHub already holds
the private repository, so nothing new is exposed there.

Three rules follow, and each has a failure mode attached:

- **The build runs on Linux, never on a developer's Mac.** `argon2` is a native
  module (`node-gyp-build` plus a `prebuilds/` tree). A `vercel build` on
  Apple silicon bundles `darwin-arm64` and every sign-in fails on Vercel's Linux
  runtime — at runtime, with a green build.
- **The build gets a throwaway `DATABASE_URL`.** `src/db/index.ts:7` throws at
  module load when it is absent, and `@/db` is reachable from
  `src/lib/auth/config.ts`, hence from every route — so `next build` needs the
  variable present. It must not be the real one: production credentials then
  live in the CI environment for no benefit. Nothing is rendered statically from
  the database (every admin page calls `requireAdmin()`), and there are no
  `NEXT_PUBLIC_*` variables to bake in, so a dummy value is sound.
- **`.vercelignore` ships anyway**, listing `docs/reference-data/`. Under
  `--prebuilt` it is redundant. It exists for the day somebody runs a plain
  `vercel deploy` from the laptop, when it becomes the only thing standing
  between the workbooks and a third party.

Previews are disabled: the workflow triggers on `push` to `main` only. With no
Git integration there is no other path by which a branch could deploy, and
therefore no second database to provision and no way for an unmerged branch to
write to the camp's ledger.

## 4. Code changes

No new dependencies. Ruling R1 is untouched — `@vercel/blob` is already in
`package.json`, and every change below is configuration of code that exists.

| # | File | Change | Failure it prevents |
|---|---|---|---|
| 1 | `src/db/index.ts:9` | `postgres(url, { ssl: 'require', max: 1, idle_timeout: 20, connect_timeout: 10 })` | Called today with **no options at all**. postgres.js then defaults to `max: 10` *per isolate*; a handful of concurrent Vercel functions exhausts Railway's connection limit. No `idle_timeout` leaves sockets open across a serverless freeze, so the next thaw uses a dead one. No `ssl` means the connection depends entirely on `sslmode` being present in the URL string. |
| 2 | `next.config.ts` | add `serverExternalPackages: ['argon2']` | Bundling `node-gyp-build`'s dynamic `require` is the standard way native modules break on Vercel. Symptom: every sign-in 500s; build is green. |
| 3 | `src/lib/storage/index.ts:88` | in production, throw unless `STORAGE_DRIVER` is explicitly `'blob'` or `'local'` | Today only the exact string `'blob'` selects Blob and **anything else silently selects the disk driver**, which `mkdir`s and `writeFile`s (`:46-47`). On Vercel that means a workbook upload reports success and then evaporates. A typo must not be resolvable by guessing — the product does not guess. |
| 4 | `src/lib/import/upload-limits.ts:14` | `MAX_UPLOAD_BYTES` 25 MB → 4 MB | **A product-rule fix, not tuning.** Vercel rejects request bodies over 4.5 MB itself, with its own English error page. At 4 MB the app's Hebrew message fires first. "No English error text ever reaches a Hebrew screen." Measured headroom: the largest real workbook is **0.07 MB**, so the new cap is ~57× larger than anything the camp actually uploads. |
| 5 | *new* `.vercelignore` | `docs/reference-data/`, `docs/`, `.uploads/`, `.vitest/` | §3 |
| 6 | *new* `.github/workflows/deploy.yml` | pull → build → deploy, `push` to `main` only | §3 |
| 7 | *new* `docs/deploy.md` | runbook: env vars, rotating a token, restoring the DB | No deployment runbook exists |
| 8 | `docs/superpowers/specs/2026-09-09-camp-data-platform-design.md:336` | Neon → Railway in the stack table | `protocol.md` §4: the correction goes where the wrong statement is |

**Deliberately not changed:**

- **`trustHost`** — not needed. Vercel sets the `VERCEL` environment variable and
  next-auth v5 infers a trusted host from it. It would be required on Railway,
  Fly, or behind any other reverse proxy; noting that here so the next person
  moving the app does not have to rediscover it.
- **`prepare: false`** on the postgres client — not needed, and adding it would
  cost performance for nothing. It is required against a *transaction-mode
  pooler* (PgBouncer, Supabase's Supavisor, Neon's pooled endpoint), which
  rejects named prepared statements. Railway's public proxy is a plain TCP
  passthrough to Postgres, not a pooler. **If the database is ever moved behind
  a pooler, this becomes mandatory** and the symptom is every query failing with
  a prepared-statement error.
- **The upload route's inline import.** `/api/uploads` buffers, hashes, stores
  and imports the whole workbook in the request
  (`src/app/api/uploads/route.ts:37-86`). At 0.07 MB per file this finishes far
  inside Vercel's default timeout. Splitting it into a background job is real
  work with no present symptom.
- **`@auth/drizzle-adapter`** — in `dependencies` with zero import sites;
  sessions are pure JWT. Removing it is unrelated cleanup.

### Shared surfaces touched

Changes 1–4 and 8 are shared surfaces. `next.config.ts` is named outright in
`ownership.md`'s table; `src/db/index.ts`, `src/lib/storage/index.ts` and
`src/lib/import/upload-limits.ts` are classified shared by `protocol.md` §1's
default ("a file you cannot classify is a shared surface"). So this goes up as a
PR with a `## Shared surfaces touched` section and a review request to
@josefcohen96 — not a self-merge — and `claims.md` gains a row in the same PR.

None of the four is on the collision path named in `claims.md` for logistics
(`src/lib/money/**` and the import surface), and all four are additive: no
export is renamed or removed, so nothing @josefcohen96 consumes can break.

## 5. The database

The laptop's database is the source of truth and is copied up whole.

```
docker exec shliff-pg pg_dump -U shliff -Fc shliff   →   pg_restore   →   Railway
```

9 MB, 25 persons, 1 user, 1 admin. The dump carries the `users` row, so **the
existing admin account works in production and no new credential is ever
minted** — nothing for this document to leak and nothing for the camp lead to
rotate.

**`drizzle-kit migrate` must not be run against it.** `scripts/cutover.ts:24-31`
records that migrations 0002–0004 were applied to the live database by
`drizzle-kit push`, so the journal does not record them, and 0005–0006 were never
applied at all. A `migrate` would try to re-run 0002–0004 and collide. The dump
reproduces that exact divergence, journal included.

The reconciliation is `drizzle-kit push` against Railway, which diffs the schema
files against the live database and applies the difference. That is already how
this repository applies schema (`docs/collab/onboarding.md:107`). It brings
0005, 0006 and the pending 0008 in together.

> **Restarting or resetting the database is always the camp lead's call**
> (`claims.md` §2), and so is anything touching real camp data. Copying the
> workbook-derived data to a third-party host is that kind of act: it is
> approved for Railway specifically, and this approval does not extend to any
> other host.

## 6. Environment variables

Set on the Vercel project, Production scope only.

| Variable | Value | If wrong |
|---|---|---|
| `DATABASE_URL` | Railway's **`DATABASE_PUBLIC_URL`**, with `?sslmode=require` | Internal host → DNS failure that reads like an outage |
| `AUTH_SECRET` | **new** 32-byte value, `openssl rand -base64 32` — not the laptop's | next-auth `MissingSecret` at request time, not at build |
| `STORAGE_DRIVER` | `blob` | Any other value silently writes to an ephemeral disk (change 3 turns this into a throw) |
| `BLOB_READ_WRITE_TOKEN` | from the Vercel Blob store | Throws inside `@vercel/blob` on first upload |

`LOCAL_STORAGE_DIR` is deliberately **not** set in production. `ADMIN_PASSWORD`
is never set on the server; it is read only by `scripts/create-admin.ts`.

GitHub Actions secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

`NODE_ENV` is `production` on Vercel automatically, which is what disables the
reference-workbook seed button (`src/app/(admin)/upload/actions.ts:24-26`) — the
button would fail anyway, since `next.config.ts` excludes those files from every
traced route, but the guard means it refuses in Hebrew instead of throwing ENOENT.

### The token now at the repository root

`VERCEL_TOKEN` was left as an untracked plaintext file in the working tree,
matched by no `.gitignore` rule. The git index is shared between sessions
(`CLAUDE.md`), so a single `git add -A` in any lane would have published a live
deploy token to the remote. `.gitignore` now covers `/VERCEL_TOKEN`,
`/RAILWAY_TOKEN` and `.vercel/`. It should still be moved out of the repository
and, once it is in GitHub Actions secrets, deleted from disk.

## 7. Verification

Claims about a deployment are worthless without the response that produced them.
In order, each step gated on the previous:

1. **Build on Linux before touching infrastructure.** `next build` has never run
   in this repository's CI (`ci.yml` is typecheck + lint + vitest only), so it is
   unproven on a non-Mac host. Run it first; a native-module or tracing failure
   found here costs nothing.
2. `psql` against Railway: `select count(*) from persons` returns **25**.
3. `curl -sI https://shliff-platform.vercel.app/signin` returns **200** and Hebrew
   `<html dir="rtl" lang="he">`.
4. Sign in as the existing admin in a browser. `/inbox`, `/money`, `/members`
   render real rows. **A rendered page, not reasoning about one** — the
   `'use server'` bug in `claims.md` passed `tsc`, `eslint`, `next build` and 868
   unit tests while 500ing every route.
5. Upload a workbook through the UI; confirm the object in the Blob store.
6. `git log --all --full-history -- VERCEL_TOKEN` is empty.

The unit suite is not re-run here. CI has already verified `main` at 2640 tests
in 203 files, 0 failed, 0 pending — an oracle this work did not produce. Nothing
in §4 changes application logic that those tests cover, and the `--maxWorkers=4`
run belongs to whoever is coordinating, not to this lane.

## 8. Risks

| Risk | Handling |
|---|---|
| `next build` fails on Linux for a reason not yet seen | It is step 1, before any infrastructure exists. Nothing to unwind. |
| Vercel Hobby restricts fra1 | Fall back to the nearest permitted European region and move Railway to match. Recorded, not silently absorbed. |
| Hobby cannot add @josefcohen96 to the Vercel project | Real limitation, accepted for now. Deploys go through CI, which they can trigger via GitHub, so it does not block them. |
| Railway's proxy adds a hop that a pooler would later remove | Noted in §4 under `prepare: false`. Revisit only if connection counts become a problem. |
| Rolldown's missing lockfile bindings break the deploy build | `next build` uses Turbopack, not rolldown; rolldown is vitest's. The deploy workflow does not run vitest. Verified by step 1 either way. |
| The camp's real data now lives on a third-party host | Explicitly approved for Railway. Access is admin-gated by `src/proxy.ts` on every route. |
