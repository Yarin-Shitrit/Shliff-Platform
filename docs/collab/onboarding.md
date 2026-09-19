# Getting set up

From nothing to a running Hebrew admin platform with a green test suite. Budget
about an hour, most of it waiting on `npm install`.

Read `protocol.md` and `ownership.md` before you write code. This file only gets
the machine working.

---

## 1. Prerequisites

| Tool | Version here | Notes |
|---|---|---|
| Node | **22.14.0** | Anything 22.x should work; 20 will not — the app is Next 16 / React 19 |
| npm | 11.5.2 | ships with Node 22 |
| Docker | any recent | for Postgres |
| git | any recent | |
| `gh` | any recent | PRs from the terminal, and you will want it |

## 2. Clone and install

```sh
git clone https://github.com/Yarin-Shitrit/Shliff-Platform.git
cd Shliff-Platform
npm install
```

> **This whole section is due for deletion.** The lockfile was regenerated and
> verified green on `feat/ui-01-foundation` at `724106e` — 203 files, 2606
> tests, zero failed — so a fresh clone of that branch runs its own tests. It
> is still true of `main` until Phase 4 merges. **When it does, delete this
> section and the binding-install step in `.github/workflows/ci.yml`**; a
> warning about a fixed problem costs the next person a search.

**If `npm install` leaves vitest unable to start**, with `Cannot find native
binding` and `Cannot find module '@rolldown/binding-...'`, the lockfile is at
fault, not your machine. `package-lock.json` declares rolldown's fifteen
platform bindings but records a resolved entry for none of them
([npm/cli#4828](https://github.com/npm/cli/issues/4828)), so a clean `npm ci`
installs no native binding. It is invisible on an Apple-silicon Mac, where an
earlier `npm install` left the darwin binding in `node_modules` without writing
it to the lock. Until the lockfile is regenerated, install the one your platform
needs at the version the lock pins:

```sh
V=$(node -p "require('./package-lock.json').packages['node_modules/rolldown'].version")
npm install --no-save "@rolldown/binding-<your-platform>@$V"   # e.g. linux-x64-gnu
```

CI does exactly this, in `.github/workflows/ci.yml`.

**Regenerating the lockfile in place does nothing** — `npm install
--package-lock-only` over the existing file returns it byte-identical, same md5,
still zero resolved bindings. The lockfile has to be **deleted** first:
`rm package-lock.json && npm install --package-lock-only` produces all fifteen,
resolved. That is the real fix, and it also moves about forty other versions
(vitest 5.0.0→5.0.1, vite 8.2.2→8.3.0, rolldown→1.2.9), so it needs its own
change and its own full test run. Measured 2026-09-19; do not conclude from an
in-place regeneration that no fix exists.

**The repository is private and contains the camp's real financial records** —
`docs/reference-data/` holds three workbooks with real names and real amounts.
Do not fork it, mirror it, or paste rows from it into an issue.

## 3. Postgres

The app expects Postgres 16. Matching the setup on the lead's machine:

```sh
docker run -d --name shliff-pg \
  -e POSTGRES_USER=shliff \
  -e POSTGRES_PASSWORD=<pick-one> \
  -e POSTGRES_DB=shliff \
  -p 5433:5432 \
  -v shliff-pgdata:/var/lib/postgresql/data \
  postgres:16-alpine
```

**Port 5433, not 5432.** `.env.example` still says 5432 and is wrong; the container
publishes 5433 to avoid colliding with a system Postgres. If you change it, change
`DATABASE_URL` to match.

The container gets **stopped deliberately** from time to time to relieve memory
pressure. When a page suddenly throws connection errors, run
`docker ps -a --filter name=shliff` before you go looking for a code defect — this
has cost real time. On a shared box, ask the camp lead before restarting it.

## 4. Environment

```sh
cp .env.example .env.local
```

Then edit `.env.local`:

- `DATABASE_URL="postgres://shliff:<the-password>@localhost:5433/shliff"`
- `AUTH_SECRET="$(openssl rand -base64 32)"`
- leave `STORAGE_DRIVER="local"` and `LOCAL_STORAGE_DIR="./.uploads"`
- leave `BLOB_READ_WRITE_TOKEN` empty

`.env.local` is gitignored. Keep it that way.

## 5. Schema, an admin user, and data

```sh
npx drizzle-kit push          # create the schema
ADMIN_PASSWORD="..." npx tsx scripts/create-admin.ts you@example.com
npx tsx scripts/seed-camp.ts  # a season to hang data on
```

The password goes in the **environment, never in argv** — an argv password lingers
in shell history and in `ps` output. The script refuses without it.

To load the real historical workbooks there is a "טען את קבצי העבר" button on the
upload page. It is a development-only tool and refuses to run in production.

## 6. Run it, and prove it works

```sh
npm run dev                   # http://localhost:3000
npx tsc --noEmit
npx vitest run --maxWorkers=4 --hookTimeout 60000 --outputFile ".vitest/json/run-$$.json"
```

**Use that exact vitest command.** With vitest's default worker count about 19
pglite-backed suites fail in `beforeEach` with `Hook timed out in 10000ms` — around
110 failures that are not real — and the failing run also *under-reports the total*,
so you cannot even compare counts. `CLAUDE.md` has the full explanation. If you see
a mass red on a clean checkout, you almost certainly dropped a flag.

## 7. Claude Code, and the skills this project runs on

The workflow here is skill-driven. Without these installed you will get a
different process than everyone else is following.

```sh
npm install -g @anthropic-ai/claude-code    # if you do not have it
```

Then inside a Claude Code session:

```
/plugin marketplace add anthropics/claude-plugins-official
/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill

/plugin install superpowers@claude-plugins-official
/plugin install frontend-design@claude-plugins-official
/plugin install claude-md-management@claude-plugins-official
/plugin install github@claude-plugins-official
/plugin install chrome-devtools-mcp@claude-plugins-official
/plugin install playwright@claude-plugins-official
/plugin install browser-use@claude-plugins-official
/plugin install skill-creator@claude-plugins-official
/plugin install vercel@claude-plugins-official
/plugin install ui-ux-pro-max@ui-ux-pro-max-skill
```

Verify with `/plugin` — the versions in use are **superpowers 6.3.0** and
**ui-ux-pro-max 2.13.0**.

**`superpowers` is the one that matters.** The whole way this repo is built comes
out of it:

| Skill | When it runs |
|---|---|
| `brainstorming` | before any new feature — design first, approval before code |
| `writing-plans` | turns an approved design into a TDD plan |
| `subagent-driven-development` | executes a plan, one fresh subagent per task |
| `test-driven-development` | write the failing test, **watch it fail**, then the code |
| `systematic-debugging` | before proposing a fix for any bug |
| `verification-before-completion` | evidence before you claim anything passes |
| `requesting-code-review` / `receiving-code-review` | before merging |
| `using-git-worktrees` | isolating parallel work |

The "watch it fail" step is not ceremony. This repo has shipped two tests that
could not fail, written by the same author as the code they tested, agreeing with
each other about the wrong thing.

`frontend-design` is for UI work. The rest are situational.

### RTK (optional, and read this before installing)

The lead's machine runs `rtk`, a CLI proxy that filters command output to save
tokens, wired in as a `PreToolUse` hook:

```sh
brew install rtk       # the one at rtk-ai.app — NOT reachingforthejack/rtk
rtk --version          # 0.31.0 here; 0.49.0 is current
rtk gain               # fails on the wrong rtk — that is the collision test
```

**It corrupts `git log` in this repo** — stale content, and it will print a
different commit than the one you asked for. If you install it, use `/usr/bin/git
log` whenever identity or content matters, and positive-control anything
hook-wrapped. You do not need rtk to work on this project. Skipping it is a
reasonable choice.

## 8. What to read, in order

1. **`CLAUDE.md`** — the product's rules and this environment's traps. Short.
2. **`docs/collab/protocol.md`** — how not to collide with the other developer.
3. **`docs/collab/ownership.md`** — what you own and what you must surface.
4. **`docs/collab/claims.md`** — what is in flight, and how to check it is current.
5. **`docs/superpowers/specs/2026-09-09-camp-data-platform-design.md`** — what the
   platform is for, and the reasoning behind the data model.
6. **`docs/superpowers/specs/2026-09-17-ui-redesign-design.md`** — the current UI.

Only if you touch the UI redesign:
`docs/superpowers/plans/2026-09-17-ui-00-integration.md` first, then the plan.

## 9. See the design

The clickable mock is 13 artboards in light and dark, in Hebrew, with sample data
that is consistent across screens:

**<https://claude.ai/artifact/EssRZT3aDPRqMfiWad9tKe>**

Ask the camp lead for access if it does not open. Do not use
`docs/superpowers/mock/` instead — that copy does not work standalone, its pages
cross-link to filenames that are not on disk.

To **add** a screen to the canvas rather than just look at it, the sources are in
`docs/superpowers/mock/` and the build is `node build.mjs`. It will not run
against the directory as committed — the files were copied in flat, and the
script expects them under `src/`. In a scratch copy, not in the repo:

```sh
cp -R docs/superpowers/mock /tmp/mock && cd /tmp/mock
mkdir -p src/pages && cp shared.css layout.json src/ && cp *.html src/pages/
node build.mjs      # → built 13 boards
```

The canvas is a **shared surface** — adding boards is fine, changing existing
ones or `shared.css` needs surfacing. `kickoff-logistics.md` §4 has the detail.

Three things the mock gets wrong, where the plans are right: gendered Hebrew
(`טרם שילמה`) the schema cannot express; a phone and email on the person page,
which `persons` does not have; and an event task filed inside the shifts group.

## 10. Your first session, and your first change

There is a kickoff prompt for the first session in
[`kickoff-logistics.md`](kickoff-logistics.md) — paste it into a fresh Claude
Code session started in the repository root. It walks setup, the reading order,
checking what is actually in flight, and designing logistics before building it.

After that: something small, end to end, so the loop is proven before it matters: branch off
`main`, make the change, run the two commands from §6, push, open a PR, get it
reviewed. Then read `protocol.md` again — it will mean more once you have been
through the loop once.
