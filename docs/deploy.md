# Deploying, and operating what is deployed

The platform runs at **<https://shliff-platform.vercel.app>**.

The design and the reasoning are in
[`superpowers/specs/2026-09-19-deployment-vercel-railway-design.md`](superpowers/specs/2026-09-19-deployment-vercel-railway-design.md).
This file is the operational half: what to run, what breaks, and what not to touch.

---

## 1. The shape of it

```
Browser (Israel)
      │  HTTPS
      ▼
Vercel — fra1 (Frankfurt), Node 22.x
  Next.js 16, src/proxy.ts gates every route
      │  TCP + TLS 1.3, Railway's public proxy
      ▼
Railway — europe-west4 (Amsterdam)
  Postgres 18.6

Vercel Blob (private, store `shliff-workbooks`)  ← workbook bytes
```

Railway runs **only** Postgres. Regions are paired on purpose: every admin page
issues several sequential queries, so keeping the app and the database both in
Europe is what stops each page load crossing the Atlantic repeatedly.

## 2. The rule that outranks convenience

**The Vercel project is not connected to GitHub, and must never be.**

Connecting it would clone the whole repository into Vercel's build
infrastructure — including `docs/reference-data/`, which holds real camp
members' names and the real amounts they owe. That cannot be undone after the
fact.

Instead, `.github/workflows/deploy.yml` builds on a GitHub runner and uploads
only `.vercel/output` via `vercel deploy --prebuilt`. Verify the project is
still unconnected with:

```sh
curl -s "https://api.vercel.com/v9/projects/<projectId>?teamId=<orgId>" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Accept: application/json" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).link))"
```

Expected: `null`. A connected project prints `{type:'github',repo:...}` — that
is what a *different* project of this account prints, which is how we know the
field is real and not merely always empty.

`vercel project inspect` does **not** report Git connection at all. Its silence
is not evidence.

## 3. Deploying

Normally: **merge to `main`**. CI runs the suite; when it goes green, the deploy
workflow fires on `workflow_run` and ships production.

A merge that touches only `docs/` or `*.md` files runs no CI at all — `ci.yml`
skips those paths, because nothing under `docs/` is read by a test or shipped,
and a private repository's runner minutes are paid for. So it fires no deploy
either, and production stays on the build it had. If you do need a deploy
after such a merge, use the manual path below.

Manually, without a commit:

```sh
gh workflow run deploy.yml --ref main
gh run watch --exit-status $(gh run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

**A deploy only runs when CI passed.** The job's `if:` gates on
`github.event.workflow_run.conclusion == 'success'`, because a red `main` is
exactly when a deploy costs most.

**Never build for production on a Mac.** `argon2` is a native module and its
binding is chosen by platform *and* Node ABI. A bundle built on Apple silicon,
or on Node 24 against a Node 22 runtime, fails to load at request time — every
sign-in 500s while the build stays green. This is why the runner builds and why
the Vercel project is pinned to Node 22.x.

## 4. Environment

Production variables live on the Vercel project, not in this repository.

| Variable | What it is | Symptom when wrong |
|---|---|---|
| `DATABASE_URL` | Railway's **public proxy** URL | The internal `postgres.railway.internal` host resolves only inside Railway; from Vercel it fails with DNS errors that read like an outage |
| `AUTH_SECRET` | 32 random bytes, production's own | next-auth `MissingSecret` at request time, not at build |
| `STORAGE_DRIVER` | exactly `blob` | Anything else throws (`src/lib/storage/index.ts`) rather than silently writing uploads to an ephemeral disk |
| `BLOB_READ_WRITE_TOKEN` | from the Blob store | `@vercel/blob` throws on the first upload |

`LOCAL_STORAGE_DIR` is deliberately **not** set in production.

There is **no `DATABASE_PUBLIC_URL`** — Railway does not supply one. A TCP proxy
must exist (it is not created by default), after which Railway injects
`RAILWAY_TCP_PROXY_DOMAIN` and `RAILWAY_TCP_PROXY_PORT`; compose the URL from
those plus `PGUSER`/`PGPASSWORD`/`PGDATABASE`, and **strip the trailing dot** the
domain arrives with.

Before setting `DATABASE_URL` anywhere, check it classifies as remote under
`src/db/index.ts`'s own regex — that regex is the only thing switching TLS on:

```sh
node -e "console.log(/@(localhost|127\.0\.0\.1|\[::1\])[:\/]/.test(process.argv[1]))" "<url>"
```

`false` is required.

## 5. Things that will surprise you

**`vercel link`, `vercel env pull` and `vercel blob create-store --yes` rewrite
`.env.local`.** One of them deleted all four local development variables —
`DATABASE_URL`, `AUTH_SECRET`, `STORAGE_DRIVER`, `LOCAL_STORAGE_DIR` — replacing
them with the Vercel project's own. Recovery was possible only because a stale
`.env.local.bak-5432` happened to exist. **Copy `.env.local` aside before
running any `vercel` command**, and never keep the only copy of `AUTH_SECRET`
there: losing it invalidates every session.

**The Vercel CLI also appends `.vercel` and `.env*` to `.gitignore`** each time.
Both are already covered, and `.env*` is harmful: it lands *after*
`!.env.example` and gitignore lets the last matching pattern win, so it silently
re-ignores the one env file this repo deliberately tracks. Delete the appended
lines. To see the problem at all you need `--no-index`, because plain
`git check-ignore` skips tracked paths and reports a reassuring nothing:

```sh
git check-ignore -v --no-index .env.example     # must print nothing
```

**`vercel build` run locally deletes ~512 lines from `package-lock.json`**,
pruning every `@rolldown/binding-*` platform entry, and rewrites
`next-env.d.ts`. Check `git status` afterwards and revert both.

**Vercel's REST API returns a non-JSON schema blob** unless you send
`Accept: application/json`.

## 6. The database

`DATABASE_URL` points at Railway's public TCP proxy, so Postgres is reachable
from the internet, guarded by its password and TLS 1.3. That is inherent to this
topology — Vercel's functions cannot join Railway's private network — and is
accepted deliberately.

Measured on the live instance: `max_connections = 500`,
`superuser_reserved_connections = 3`. `src/db/index.ts` uses `max: 3` per
instance, so twenty warm instances sit at sixty sockets, well inside that.

### Schema changes: neither `migrate` nor `push`

**`drizzle-kit migrate` is forbidden.** `scripts/cutover.ts:24-31` records that
0002–0004 were applied by `push` and never journalled, so a migrate re-runs them
and collides.

**`drizzle-kit push` is forbidden too**, and this one is worse. Run against the
restored database it proposed adding `budget_lines_source_key` — a constraint
that *already exists* — and offered to **truncate `budget_lines`**, which holds
61 rows of the camp's real budget. Only the absence of a TTY prevented it. The
cause is that `drizzle-kit` 0.31.10 predates Postgres 18 and misreads its
catalog.

The reconciliation is therefore a **read-only parity check**:

```sh
Q="select table_name||'.'||column_name||' '||data_type||' null='||is_nullable||' def='||coalesce(column_default,'-')
   from information_schema.columns where table_schema='public' order by 1"

docker exec shliff-pg psql -U shliff -d shliff -tAc "$Q" > /tmp/local.txt
docker run --rm postgres:18-alpine psql "$RAILWAY_URL" -tAc "$Q" > /tmp/remote.txt
diff /tmp/local.txt /tmp/remote.txt && echo IDENTICAL
```

187 columns each side, empty diff — as measured on 2026-09-19, before
migrations `0009` and `0010` existed. Re-measure rather than trusting that
number. If the diff is ever non-empty, read the difference and apply the
specific change by hand — with the camp lead's approval, because it is real
financial data.

### Migrations `0009` and `0010` — applied to Railway on 2026-09-24

Until 2026-09-24 the production database was at `0008`. Two migrations on
`main` created tables it did not have, and every screen that reads them
threw during its server render (React #441) instead of loading:

| Migration | Creates | Screens that throw without it |
|---|---|---|
| `0009_wealthy_emma_frost` | `inventory_items`, `acquisition_items`, `task_materials` | `/logistics/warehouse`, `/logistics/acquisitions`, `/logistics/build`, both exports |
| `0010_mysterious_trish_tilby` | `site_plans`, `site_items` | `/site` (מפת הקאמפ) |

Both are purely additive — `CREATE TABLE` and foreign keys, no `ALTER`, no
`DROP`, no row touched — which is why they can be applied by hand with `psql`
instead of by either forbidden `drizzle-kit` command. Applying them is still
the camp lead's decision, because it is the camp's real database.

First confirm they are genuinely missing. Read-only:

```sh
docker run --rm -e R="$RAILWAY_URL" postgres:18-alpine sh -c '
  psql "$R" -tAc "select table_name from information_schema.tables
    where table_schema='"'"'public'"'"' and table_name in
    ('"'"'inventory_items'"'"','"'"'acquisition_items'"'"','"'"'task_materials'"'"','"'"'site_plans'"'"','"'"'site_items'"'"')"'
```

The `sh -c` matters: written as `psql "$R"` directly on the `docker run` line,
`$R` is expanded by *your* shell, where it is empty, and psql silently falls
back to a local socket inside the container (`connection to server on socket
"/var/run/postgresql/.s.PGSQL.5432" failed`) — an error that reads like
Railway being down.

Expected before: nothing. Then apply, one transaction per file, stopping on the
first error:

```sh
docker run --rm -e R="$RAILWAY_URL" -v "$PWD/drizzle:/m:ro" postgres:18-alpine sh -euc '
  psql "$R" -v ON_ERROR_STOP=1 -1 -f /m/0009_wealthy_emma_frost.sql
  psql "$R" -v ON_ERROR_STOP=1 -1 -f /m/0010_mysterious_trish_tilby.sql
'
```

The `--> statement-breakpoint` markers drizzle writes are SQL line comments,
so `psql -f` runs the files as they are — this is exactly how the local
container received both. Afterwards, the parity check above must come back
empty against a local database that also carries both, and the five tables
must appear in the read-only query. No deploy is needed: the code that reads
these tables has been on `main` since #8 and #10.

Nothing journals this. The database has no `drizzle.__drizzle_migrations`
table (`scripts/cutover.ts` explains why), so the parity check *is* the
record of what has been applied.

Five constraints are load-bearing and must exist:
`{budget_lines,ledger_entries,obligations,ticket_rounds,funding_targets}_source_key`,
each `UNIQUE (source_block_id, source_row)`. `promote.ts` upserts with
`onConflictDoUpdate` on exactly those columns, so without them Postgres raises
`42P10` and block promotion fails outright.

### Migration `0011` — applied to Railway on 2026-09-25

`0011_faithful_starjammers` is one statement:
`ALTER TABLE "acquisition_items" ALTER COLUMN "season_id" DROP NOT NULL;`
It lets a רכש row belong to no season (camp-wide, listed under every year).
Not additive like `0009`/`0010` — it is an `ALTER` — but it touches no row and
loosens a constraint rather than adding one, so the same `psql -f` procedure
applies. Before it was applied, saving a row with «לא שייך לברן מסוים» ticked
failed in production with a `23502` not-null violation. The camp lead approved
it on 2026-09-25 and it went in together with `0012` (below).

Read-only check (before: `NO`; after: `YES`):

```sh
docker run --rm -e R="$RAILWAY_URL" postgres:18-alpine sh -c '
  psql "$R" -tAc "select is_nullable from information_schema.columns
    where table_name='"'"'acquisition_items'"'"' and column_name='"'"'season_id'"'"'"'
```

Then:

```sh
docker run --rm -e R="$RAILWAY_URL" -v "$PWD/drizzle:/m:ro" postgres:18-alpine sh -euc '
  psql "$R" -v ON_ERROR_STOP=1 -1 -f /m/0011_faithful_starjammers.sql
'
```

Afterwards the query above prints `YES`, and the parity check comes back empty
against a local database that also carries `0011`.

### Migration `0012` — applied to Railway on 2026-09-25

`0012_site_3d_editor` is the camp map's 3D editor: a new, empty
`site_kind_defaults` table, and four columns — `site_items.height_cm` (null),
`site_items.locked` (default `false`), `site_plans.version` (default `0`) and
`site_plans.north_deg` (default `0`). Additive: every existing row takes the
default, nothing is dropped or rewritten. It must be on Railway **before** the
code that reads it deploys, because every `/site` query selects the new
columns. The camp lead approved it on 2026-09-25; it was applied right after
`0011`, with the same procedure:

```sh
docker run --rm -e R="$RAILWAY_URL" -v "$PWD/drizzle:/m:ro" postgres:18-alpine sh -euc '
  psql "$R" -v ON_ERROR_STOP=1 -1 -f /m/0011_faithful_starjammers.sql
  psql "$R" -v ON_ERROR_STOP=1 -1 -f /m/0012_site_3d_editor.sql
'
```

Measured before: the four columns and the table absent, 1 plan and 29 items.
After: all present, still 1 plan and 29 items.

### Migration `0013` — applied to Railway on 2026-09-25

`0013_site_lines` is the camp map's pipes and cables: one new, empty table,
`site_lines`, with three foreign keys (to `site_plans` and twice to
`site_items`, all `ON DELETE cascade`). Additive: no existing table or row
changes. It must be on Railway **before** the code that reads it deploys,
because every `/site` load selects from it — and it was not: PR #23 merged
at 10:35, the deploy went out at 10:38, and `/site` showed the error boundary
(digest `1186279597`) until the camp lead applied the migration by hand a few
minutes later, with the same procedure as `0012`. The order for a schema
change is migration first, merge second; this one got it backwards.

```sh
docker run --rm -e R="$RAILWAY_URL" -v "$PWD/drizzle:/m:ro" postgres:18-alpine sh -euc '
  psql "$R" -v ON_ERROR_STOP=1 -1 -f /m/0013_site_lines.sql
'
```

Measured before: `to_regclass('site_lines')` null, 1 plan and 63 items.
After: `CREATE TABLE` plus three `ALTER TABLE`, `select count(*) from
site_lines` = 0, still 1 plan and 63 items. The map page recovered on reload
with no redeploy.

Right after, the 2026 sketch was landed again with `--replace` from the merged
tree (`scripts/land-camp-layout.ts`, actor `yarin`): 68 items — the sink at
1.5 × 0.6 m, the fridge and four lights among them — 0 outside the fence, 0
overlapping pairs. The map it replaced was at version 2, so one editor save
made since the morning's landing went with it.

### Migration `0014` — applied to Railway by 2026-09-26

`0014_site_rope_angles` is the shade nets' rope angle (spec
`2026-09-25-site-map-pipes-ropes-underlay-design.md` §13): two nullable
columns, `site_items.rope_angle_deg` and `site_kind_defaults.rope_angle_deg`.
Additive: every existing row takes null, which means "no angle", so no net's
checks change until the camp sets one (D16). It must be on Railway **after
`0013` and before this merges** — `main` deploys itself on merge — because
every `/site` query selects the new columns. Applying it is the camp lead's step, by the
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

Measured on 2026-09-26, before the `0016`–`0019` batch below: the count was
already `2`. It was applied to Railway between 2026-09-25 and then, and the
step was not recorded here at the time. The local `shliff-pg` also carries it.

### Migration `0015` — applied to Railway by 2026-09-26

`0015_site_underlays` is Part C of the camp map's extensions, the image to
trace (spec
`docs/superpowers/specs/2026-09-25-site-map-pipes-ropes-underlay-design.md`
§16–19). It adds one new, empty table, `site_underlays`: one row per map, with
a foreign key to `site_plans` that cascades. It is additive, and no existing
row is touched. It must be on Railway **before** the code that reads it
deploys, because every `/site` load reads the table (`loadDoc` →
`readUnderlay`). Applying it is the camp lead's decision. Part B's `0014` (the
ropes) goes first, if its record says it is not applied yet. As `0013` taught,
the order is migration first, merge second.

The pictures are not in the database. They go to the same private Vercel Blob
store as the workbooks (`STORAGE_DRIVER=blob`, written with
`access: 'private'`), under `site-underlays/<planId>/<sha256>.<ext>`. Only
`GET /site/underlay/<planId>/<file>` reads them back, and only for admins:
the proxy does not gate image paths, and the route's own `requireAdmin` does.
There is no new environment variable and no new service. Removing a picture
from a map keeps its file, so that an undo can bring it back; erasing files
waits for a storage delete.

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

Afterwards the query above prints `site_underlays`. The parity check at the
top of this section must come back empty against a local database that also
carries `0015`.

Measured on 2026-09-26, before the `0016`–`0019` batch below: the table was
already there. As with `0014`, the step itself was not recorded here when it
happened. The local `shliff-pg` also carries it.

### Migration `0016` — applied to Railway on 2026-09-26

`0016_warehouse_boxes` is the warehouse's boxes: a new, empty table
`inventory_boxes` (a name, a place, a note) and one nullable column
`inventory_items.box_id` pointing at it, `set null` on delete. Additive:
every existing item takes null, which means "located by its own text", so no
row changes meaning. It must be on Railway **before** the code that reads it
deploys, because every `/logistics/warehouse` load joins the new table and
the acquisitions and build pages read the items through the same join.
Applying it is the camp lead's step, by the same procedure as the site
migrations, after whichever of `0014`/`0015` are still pending — the order is
migration first, merge second.

Read-only check (before: nothing; after: `inventory_boxes`):

```sh
docker run --rm -e R="$RAILWAY_URL" postgres:18-alpine sh -c '
  psql "$R" -tAc "select table_name from information_schema.tables
    where table_schema='"'"'public'"'"' and table_name='"'"'inventory_boxes'"'"'"'
```

Then:

```sh
docker run --rm -e R="$RAILWAY_URL" -v "$PWD/drizzle:/m:ro" postgres:18-alpine sh -euc '
  psql "$R" -v ON_ERROR_STOP=1 -1 -f /m/0016_warehouse_boxes.sql
'
```

Afterwards the query above prints `inventory_boxes`, and
`select count(*) from inventory_items` is what it was before.

Applied on 2026-09-26 as the first of the `0016`–`0019` batch (see the record
after `0019`): `CREATE TABLE`, `ALTER TABLE`, `ALTER TABLE`; `inventory_items`
was 16 rows before and 16 after. The local `shliff-pg` carries it too.

### Migration `0017` — applied to Railway on 2026-09-26

`0017_site_item_groups` is the camp map's item groups: one nullable column,
`site_items.group_id uuid`, and nothing else — no table, no foreign key.
Items a lead groups in the editor share an id the editor mints; null is the
ordinary item. Additive: every existing item takes null, so no row changes
meaning. It must be on Railway **before** the code that reads it deploys,
because every load of `/site` selects the column (`plan.ts` `listItems`) and
a save that groups items writes it. Applying it is the camp lead's step, by
the same procedure as `0016`, after whichever earlier migrations are still
pending — the order is migration first, merge second.

Read-only check (before: nothing; after: `group_id`):

```sh
docker run --rm -e R="$RAILWAY_URL" postgres:18-alpine sh -c '
  psql "$R" -tAc "select column_name from information_schema.columns
    where table_name='"'"'site_items'"'"' and column_name='"'"'group_id'"'"'"'
```

Then:

```sh
docker run --rm -e R="$RAILWAY_URL" -v "$PWD/drizzle:/m:ro" postgres:18-alpine sh -euc '
  psql "$R" -v ON_ERROR_STOP=1 -1 -f /m/0017_site_item_groups.sql
'
```

Afterwards the query above prints `group_id`, and
`select count(*) from site_items` is what it was before.

Applied on 2026-09-26 in the `0016`–`0019` batch: `ALTER TABLE`; `site_items`
was 69 rows before and 69 after. The local `shliff-pg` carries it too.

### Migration `0018` — applied to Railway on 2026-09-26

`0018_site_item_facing` is the camp map's fourth bit of a turn: one column,
`site_items.facing integer not null default 0`, quarter turns clockwise from
the kind's drawn orientation, 0 to 3. A turn in the editor swaps the sides
*and* adds one, so a sofa's back walks north, east, south, west and home. The
migration also **updates rows**: a sofa or armchair already taller than it is
wide is set to facing 3 (back on the west edge), which is how the scene drew
it before there was a facing — so no picture changes when the column arrives.
Every other item takes 0. It must be on Railway **before** the code that reads
it deploys, because every load of `/site` selects the column (`plan.ts`
`listItems`) and every turn writes it. Applying it is the camp lead's step, by
the same procedure as `0016`, after whichever earlier migrations are still
pending — the order is migration first, merge second.

It was generated on top of `0017_site_item_groups` and must be applied after it.

Read-only check (before: nothing; after: `facing`):

```sh
docker run --rm -e R="$RAILWAY_URL" postgres:18-alpine sh -c '
  psql "$R" -tAc "select column_name from information_schema.columns
    where table_name='"'"'site_items'"'"' and column_name='"'"'facing'"'"'"'
```

Then:

```sh
docker run --rm -e R="$RAILWAY_URL" -v "$PWD/drizzle:/m:ro" postgres:18-alpine sh -euc '
  psql "$R" -v ON_ERROR_STOP=1 -1 -f /m/0018_site_item_facing.sql
'
```

Afterwards the query above prints `facing`, `select count(*) from site_items`
is what it was before, and `select count(*) from site_items where facing = 3`
is the number of sofas and armchairs standing taller than wide.

Applied on 2026-09-26 in the `0016`–`0019` batch: `ALTER TABLE`, then
`UPDATE 12` — twelve sofas or armchairs took `facing = 3`; `site_items` was 69
rows before and 69 after. The local `shliff-pg` carries it too.

### Migration `0019` — applied to Railway on 2026-09-26

`0019_site_plan_snapshots` is the camp map's saved plans (תוכניות שמורות): one
new, empty table, `site_plan_snapshots`, with a foreign key to `site_plans`
that cascades on delete, and nothing else — no column on any existing table.
A row is a map kept under a name, as one jsonb, and the editor loads it back
as ordinary edits (`src/lib/site/snapshots.ts`, `src/lib/site/editor/restore.ts`).
Additive and touched by nothing but the card that saves and lists plans: until
it is on Railway, opening that card on `/site` answers a Hebrew error and every
other part of the map keeps working. Applying it is the camp lead's step, by
the same procedure as `0018`, after whichever earlier migrations are still
pending — the order is migration first, merge second.

It was generated on top of `0018_site_item_facing` and must be applied after it.

Read-only check (before: no row; after: `site_plan_snapshots`):

```sh
docker run --rm -e R="$RAILWAY_URL" postgres:18-alpine sh -c '
  psql "$R" -tAc "select table_name from information_schema.tables
    where table_schema='"'"'public'"'"' and table_name='"'"'site_plan_snapshots'"'"'"'
```

Then:

```sh
docker run --rm -e R="$RAILWAY_URL" -v "$PWD/drizzle:/m:ro" postgres:18-alpine sh -euc '
  psql "$R" -v ON_ERROR_STOP=1 -1 -f /m/0019_site_plan_snapshots.sql
'
```

Afterwards the query above prints `site_plan_snapshots`, and
`select count(*) from site_plan_snapshots` is 0. On the local `shliff-pg` the
table was created on 2026-09-26 from the same SQL under its earlier working
name, so the query already prints it there.

Applied on 2026-09-26 as the last of the `0016`–`0019` batch: `CREATE TABLE`,
`ALTER TABLE`; the table is empty by construction.

### The `0016`–`0019` batch — applied to Railway on 2026-09-26

All four merged to `main` on 2026-09-26 (#40, #41, #42, #43) with none of
them on Railway — the rule in §2, migration first, merge second, was broken
four times in one day. Production did **not** break, and only by accident:
GitHub Actions was billing-blocked from about 10:30 UTC that day, every CI
run failed with zero steps, and the deploy workflow gates on a green CI. So
Vercel stayed on `ead711e` (#39, deployed 09:07 UTC), whose code needs
nothing past `0015`. Had CI been healthy, the first of the four merges would
have shipped code that selects `box_id` against a database without it, and
every load of `/logistics/warehouse` would have thrown; `/site` after #41.
The database was brought up to `0019` before the deploys could resume, so
the next deploy of `main` finds every column it reads.

The read-only check found `0014` and `0015` present and the other four
absent. The four were then applied in order with the runbook's own command,
one transaction per file, `ON_ERROR_STOP=1`, from a clean checkout of
`main`. Row counts before and after, unchanged:

| Table | Before | After |
|---|---|---|
| `site_plans` | 1 | 1 |
| `site_items` | 69 | 69 |
| `inventory_items` | 16 | 16 |

The check that decides "is it on Railway?" for each of the six, read-only,
in one query — re-run it rather than trusting this section:

```sh
docker run --rm -e R="$RAILWAY_URL" postgres:18-alpine sh -c '
psql "$R" -tAc "
select '"'"'0014'"'"', count(*) from information_schema.columns where column_name='"'"'rope_angle_deg'"'"'
union all select '"'"'0015'"'"', count(*) from information_schema.tables where table_name='"'"'site_underlays'"'"'
union all select '"'"'0016'"'"', count(*) from information_schema.tables where table_name='"'"'inventory_boxes'"'"'
union all select '"'"'0017'"'"', count(*) from information_schema.columns where table_name='"'"'site_items'"'"' and column_name='"'"'group_id'"'"'
union all select '"'"'0018'"'"', count(*) from information_schema.columns where table_name='"'"'site_items'"'"' and column_name='"'"'facing'"'"'
union all select '"'"'0019'"'"', count(*) from information_schema.tables where table_name='"'"'site_plan_snapshots'"'"'"'
```

Expected now: `2, 1, 1, 1, 1, 1`. The Postgres password was pasted into a
Claude Code session to do this; rotating it in Railway, and the `DATABASE_URL`
on Vercel with it, is still to do.

### Copying the laptop's database up

The local container is Postgres **16**; Railway is **18**. Dump with the
**newer** version's tools, which is what PostgreSQL documents:

```sh
docker run --rm -e L="$LOCAL_URL" -e R="$RAILWAY_URL" postgres:18-alpine sh -euc '
  pg_dump -Fc --no-owner --no-privileges "$L" > /tmp/d.dump
  pg_restore --no-owner --no-privileges --single-transaction -d "$R" /tmp/d.dump
  rm -f /tmp/d.dump
'
```

The local database is reachable from inside a container at
`host.docker.internal:5433`. The dump stays in the container's ephemeral layer,
so it never touches the host filesystem — it holds real names and real amounts.

**Verify by row counts, not exit codes.** Alpine's `sh` runs `-c` scripts line by
line, so a pipeline can complete fully before a later parse error aborts the
script, printing `syntax error` alongside `exit 0`. That happened; the restore
had already succeeded. `select count(*) from persons` is the oracle.

## 7. Accounts

```sh
DATABASE_URL="<railway url>" ADMIN_PASSWORD="..." npx tsx scripts/create-admin.ts <email>
```

The password is read from the environment, never from a command-line argument,
so it stays out of shell history and `ps`.

`scripts/create-admin.ts:15` hardcodes `role: 'admin'`. The schema supports
`editor` and `viewer` with a default of `viewer`, but nothing in the app creates
them — so today every account made this way has full write access to members,
dues and the money ledger. Worth closing if read-only access is ever wanted.

## 8. Rotating the Vercel token

```sh
vercel tokens ls
vercel tokens add shliff-deploy
gh secret set VERCEL_TOKEN          # paste, or pipe from a file
```

The token is also kept as a git-ignored `VERCEL_TOKEN` file at the repository
root for local use. It is matched by `/VERCEL_TOKEN` in `.gitignore`; before
that rule existed it was an untracked plaintext file in a repository whose git
index is shared between sessions, one `git add -A` from the remote.

## 9. If something is wrong

```sh
vercel logs shliff-platform.vercel.app
gh run list --workflow deploy.yml --limit 5
```

**`gh run view --log` emits nothing while a run is in progress.** For a finished
job inside a running workflow:

```sh
gh api /repos/Yarin-Shitrit/Shliff-Platform/actions/jobs/<job_id>/logs
```

| Symptom | Look at |
|---|---|
| Every sign-in 500s, build was green | `argon2` — Node version or `serverExternalPackages` in `next.config.ts` |
| Upload succeeds then the file is gone | `STORAGE_DRIVER` is not `blob` |
| Every query fails on a prepared statement | Railway has been put behind a pooler; add `prepare: false` in `src/db/index.ts` |
| DNS errors from the database | `DATABASE_URL` is the internal host, not the proxy |
| Hebrew screen shows English text | A platform error escaped — the app's own Hebrew refusal did not fire first |
