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

### Migrations `0009` and `0010` have never reached Railway

As of 2026-09-24 the production database is at `0008`. Two migrations on
`main` create tables it does not have, and every screen that reads them
throws during its server render (React #441) instead of loading:

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
docker run --rm -e R="$RAILWAY_URL" postgres:18-alpine \
  psql "$R" -tAc "select table_name from information_schema.tables
    where table_schema='public' and table_name in
    ('inventory_items','acquisition_items','task_materials','site_plans','site_items')"
```

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
