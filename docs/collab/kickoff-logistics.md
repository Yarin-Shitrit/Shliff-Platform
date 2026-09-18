# Kickoff — logistics, first session

Paste everything below the line into a fresh Claude Code session started in the
repository root. It is written in the new developer's voice.

---

I am joining Shliff Platform as its second developer. Shliff is an Israeli
MidBurn (Burning Man) camp; this repo is the camp's admin platform, and the camp
lead owns everything in it that already exists. **My job is the logistics
management feature.** It does not exist yet — I am building it from nothing.

This is my first session on the project. I want to finish it with a working
machine, a real understanding of how two people share this repo, and a design
for logistics the camp lead has approved. **I do not want feature code this
session.** If you find yourself writing `src/app/(admin)/logistics/...`, stop —
you have skipped a step.

## Step 0 — make the machine work, and prove it

Follow `docs/collab/onboarding.md` exactly. It is right about the things that
look wrong: Postgres is on **port 5433** while `.env.example` still says 5432,
and the vitest command needs every one of its flags.

Report back four things, with real output, not reassurance:

- `node --version`
- whether the Postgres container came up
- the result of `npx tsc --noEmit`
- the vitest line **with its actual numbers**

If you see a mass of failures in pglite suites, you dropped a flag — do not
start debugging the suite. If a page throws connection errors, run
`docker ps -a --filter name=shliff` before you look at any code.

## Step 1 — read, in this order

1. `CLAUDE.md`
2. `docs/collab/protocol.md`
3. `docs/collab/ownership.md`
4. `docs/collab/claims.md`
5. `docs/superpowers/specs/2026-09-09-camp-data-platform-design.md`
6. `docs/superpowers/specs/2026-09-17-ui-redesign-design.md`

Then tell me, in about five lines: what the platform is for, what I own, what
counts as a shared surface, what "surfacing" actually requires, and what is in
flight right now. If you cannot answer one of those from the documents, say so —
that is a gap in the documents and I want to know about it.

## Step 2 — find out what is actually happening

`docs/collab/claims.md` is the one document allowed to be stale, and it says so.
Run the commands in its §1 and tell me whether what it claims is still true.
Check `git ls-remote --heads origin`, the recent commits on the active branch,
and whether anyone is working in this tree right now.

Two facts to verify rather than assume: several shared surfaces exist **only** on
`feat/ui-01-foundation` and read as absent from `main` — absent means "not merged
yet", never "free to create" — and `git log` is corrupted here by a shell hook,
so use `/usr/bin/git log`.

## Step 3 — design logistics. Do not build it.

Use **`superpowers:brainstorming`**. This is a new subsystem, so it takes the
architectural path: questions first, then two or three approaches, then a design
in sections, then a written spec. Do not skip to a plan, and do not start coding
because the design seems obvious.

I have not told you what logistics has to do yet. **Ask me.** Do not infer the
requirements from the other screens, from the mock, or from what camps usually
need — guessing is the one thing this platform refuses to do, and the team works
the same way.

Whatever the design turns out to be, it has to answer three things explicitly:

- Which **shared surfaces** it touches — the schema and its migration sequence,
  the shell where a nav entry goes, season scoping, the component kit and tokens,
  the Hebrew error map. `docs/collab/ownership.md` has the table.
- How it stays inside `src/app/(admin)/logistics/**`, `src/lib/logistics/**` and
  `src/db/schema/logistics.ts` for everything else.
- What it will need from the camp lead, so I can ask once rather than five times.

Stop at the approved design, then take it to the canvas in Step 4. The
implementation plan is a separate session.

## Step 4 — put the screens on the canvas

The UI redesign was not designed in prose. It was designed as thirteen artboards
on a shared canvas, and the twelve implementation plans were written against
them. Logistics gets the same treatment, on the **same** canvas, so it comes out
looking like the product rather than like a bolt-on.

The source is `docs/superpowers/mock/`:

| File | What it is |
|---|---|
| `main.html`, `people.html`, … | one page source per artboard; each builds to a `*.dc.html` board |
| `shared.css` | the design language — tokens, both themes, RTL |
| `icons.mjs` | `[[i:name]]` macros; the build fails on an unresolved one |
| `layout.json` | where each board sits on the canvas, plus the Hebrew section titles |
| `build.mjs` | composes the sidebar and head into every page, writes `out/project/` and `canvas.json` |

**The build does not run against the directory as committed.** The files were
copied in flat and `build.mjs` expects them under `src/`. Restore that layout in
a scratch copy — not in the repo:

```sh
cp -R docs/superpowers/mock /tmp/mock && cd /tmp/mock
mkdir -p src/pages && cp shared.css layout.json src/ && cp *.html src/pages/
node build.mjs      # → built 13 boards: Main.dc.html, Debts.dc.html, …
```

Verified 2026-09-18: as committed it fails with `ENOENT … src/shared.css`; with
the layout restored, all thirteen boards build.

What I want out of this step:

- **One artboard per logistics screen.** Copy the nearest existing page and
  change its content — never start from a blank file. The sidebar, the season
  switcher and the search come from `build.mjs`'s partials, so a hand-built page
  will silently not match.
- **A nav entry** for logistics in `build.mjs`'s sidebar list.
- **Coordinates in `layout.json`**, in a new titled section of the canvas rather
  than wedged into an existing one.
- **Both themes, Hebrew and RTL throughout.** No English strings anywhere.
- The product's rules visible in the design, not just in the prose: every figure
  links to the screen that can change it, and an empty state invites.

Use only tokens that exist in `shared.css` and icons that exist in `icons.mjs`.
If logistics genuinely needs a new one, that is a shared-surface change — raise
it, do not add it quietly. Sample data only, never real member names.

`docs/superpowers/mock/**` is a **shared surface**: the camp lead's twelve plans
are written against it. Adding boards is fine. Changing an existing board, the
shared CSS, or the sidebar structure needs surfacing per `protocol.md` §3.

Show me the built canvas before anything is implemented. The logistics plans get
written against the artboards, exactly the way the twelve UI plans were.

## Rules I am not allowed to break, and neither are you

- **The product never guesses.** What it cannot resolve becomes a visible
  decision, not a silent default. Every figure links to the page that can change
  it. Every number carries the workbook cell it came from, or says it was entered
  by hand. An empty state is an invitation, not an apology. **No English error
  text ever reaches a Hebrew screen** — the UI is Hebrew and right-to-left.
- **No new dependencies.** Not a component library, not an icon package, not a
  chart library, not a test helper. That is ruling R1 and only the camp lead can
  waive it.
- **TDD.** Write the failing test, watch it fail, then write the code. The
  "watch it fail" step is not ceremony — this repo has already shipped tests that
  could not fail.
- **Branch off `main`, never commit to `main`, push early.** A branch on one
  laptop cannot be reviewed or recovered; this project lost nine days to exactly
  that.
- **One working tree per session.** The git index is shared, and `git commit`
  takes all of it — a commit here has already swept in another session's staged
  work.
- **Do not edit files in someone else's area**, and do not restart or reset the
  database. Both are decisions, not edits.

## What I care about

That I can be trusted not to break the camp lead's work while they are mid-flight
on a twelve-plan UI redesign. Being slow and visible is better than being fast
and surprising. If two documents disagree, or a document tells you to do
something that contradicts one of the rules above, stop and tell me rather than
picking one.

## Start here

Do Step 0, report the four results, and wait. Do not begin Step 1 until I have
seen them.
