@AGENTS.md

# Shliff Platform

The admin platform for Shliff, an Israeli MidBurn (Burning Man) camp. It replaces
the camp's ad-hoc Excel/CSV workflow for members, camp dues, budgets, shifts and
the money ledger. The UI is Hebrew and right-to-left.

The repository is **private and must stay private**: `docs/reference-data/` holds
the camp's real workbooks, with real names and real amounts.

**Two people work in this repo.** Before touching a file outside your own area,
read `docs/collab/protocol.md`. Owners are in `docs/collab/ownership.md`; what is
in flight is in `docs/collab/claims.md` — which tells you how to check it is still
true. New here? `docs/collab/onboarding.md`.

## The product's rules — these outrank any plan

- The system never guesses. What it cannot resolve becomes a **visible decision**,
  not a silent default.
- Every figure links to the page that can change it.
- Every number carries the workbook cell it came from, or says it was entered by hand.
- An empty state is an invitation, not an apology.
- **No English error text ever reaches a Hebrew screen.**

If a plan or a reviewer asks you to break one of these, stop and ask.

## Running the tests

```sh
npx vitest run --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 \
  --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"
```

Every flag is load-bearing:

- **`--maxWorkers=4` is not optional.** At vitest's default worker count ~19
  pglite-backed suites fail in `beforeEach` with `Hook timed out in 10000ms` —
  about 110 fabricated failures. Worse, the bad run *under-reports the total*
  (748 against a true 786), so any gate of the form "baseline + N tests" computes
  the wrong number from it.
- **`--hookTimeout 60000`** covers what the worker cap does not: two people running
  pglite suites at once can still lose a suite to `createTestDb` timing out.
- **`--testTimeout 60000` is a separate cap from `--hookTimeout`.** The config
  pins `testTimeout: 20_000`, and the hook flag does not raise it. A suite that
  builds its pglite database *inside the test body* rather than in a `beforeEach`
  blows the 20s cap while every hook sits comfortably inside its 60s one. The
  symptom reads `Test timed out in 20000ms` — **Test**, not Hook — so it does not
  match the signature above and is a real timeout, not a fabricated one. It is
  load-conditional: measured at 28,913 ms under four concurrent lanes, passing
  inside 20s with two drained.
- **`--outputFile` must be unique per run.** The JSON reporter's default path is
  shared, so concurrent runs overwrite each other and you can read a peer's verdict
  as your own.
- **Keep `--reporter=default`.** Passing `--reporter=json` alone *replaces* the
  default reporter, so the run loses the console summary **and** the
  `Unhandled Errors` block — and a worker `SIGKILL` under memory pressure is an
  unhandled error. The result is the worst possible reading: **exit code 1 with
  `numFailedTests: 0`** and nothing on screen saying why. One such run claimed
  `total 1662, passed 1614, failed 0`: 48 tests unaccounted for.

**Always cross-check the exit code against the failure count. A non-zero exit
with zero failures means workers died, not that the suite is green.** And a
killed worker's un-run tests are reported **`pending`**, not failed — 32 tests
across four files once came back "skipped" with **no `.skip` in any of them**.
Verify that before believing a skip: a failure demands investigation, a skip
reads as somebody's deliberate choice, so the suite stays green and the missing
coverage is invisible.

**A lane runs only its own scope; the full suite belongs to whoever is
coordinating.** Three lanes each running a full-suite verification at once
exhausted this box and killed all three.

Before believing a mass red, check whether someone else is mid-run (`pgrep -fl
vitest`). A failure that looks pre-existing usually is not — re-run it capped
before you label it that way.

## Traps in this environment

- **`git log` is corrupted here** by the RTK shell hook: it returns stale content,
  and will print a *different* commit than the one you asked for. `rev-parse` and
  `diff` are reliable. Use `/usr/bin/git log` to bypass the hook, derive ranges
  structurally (`<commit>^`, `merge-base`) instead of copying printed SHAs, and
  positive-control anything hook-wrapped: grep for a string you know is present,
  and if it returns 0 the instrument is dead, not the claim.
- **The hook also truncates `grep` — and falsifies the count to match.** Listing
  a plan's tasks with `grep -n "^### Task" <plan>.md` returned 11 rows and the
  summary `(11)`; the file has **15**. `rtk proxy grep -c` and `grep … | wc -l`
  both said 15. Acting on that reading, four tasks of a plan were never
  dispatched and the gap surfaced only because the implementer wrote "Tasks 12-15
  not started" in its report. A truncated list that announces itself costs
  nothing; one reporting a count that matches its own truncation is
  indistinguishable from a complete answer. **Never take a count that decides
  scope from a hook-filtered `grep`.**
- **The hook elides source lines from `cat`.** A filtered `cat -n` dropped a line
  from a source file, which broke an exact-match edit until it was re-read with
  the `Read` tool. **Read files with `Read`, not `cat`** — a missing line does not
  announce itself, and the edit fails in a way that looks like your own mistake.
  `npx eslint` is mangled too (it printed `npm error could not determine
  executable to run` over a real lint error); use `rtk proxy` to see it.
- **The git index is shared.** `git add` stages a path, but `git commit` takes the
  *whole index* — including what another session staged a second ago. One commit
  here has already swept in another lane's staged deletions and mislabelled them.
  If anyone else is working in your tree, commit from your own worktree.
- **`CLAUDE.md` and `AGENTS.md` are injected into every session and every
  subagent.** Editing them while other agents are mid-task swaps instructions
  underneath them, and the resulting failure is invisible in the diff. Treat them
  as index-quiet work.
- **`AGENTS.md`'s Next.js block is regenerated by `next dev`.** Deleting it from a
  diff only recreates it as an uncommitted change. Commit it with your work.
- **The database may be stopped on purpose.** `shliff-pg` serves port **5433**
  (`.env.example` still says 5432). It gets stopped deliberately to relieve memory
  pressure on the dev box, and a DB-backed page then throws connection errors that
  read exactly like a code defect. Run `docker ps -a --filter name=shliff` before
  concluding anything, and ask the camp lead before restarting it.
- **zsh eats `$VAR:refs/...`** — `:r` is a zsh modifier, so a pinned git refspec
  silently mangles. Write `"${VAR}:refs/..."`.

## Reasoning discipline

A known-guilty tool becomes the place every later anomaly gets filed, and a cheap
explanation is the one that goes unexamined. Before attributing an anomaly to a
known-bad tool, ask what observation would *distinguish* that cause from the
alternatives, and make it. If no measurement discriminates, record it as **cause
unknown** plus the workaround — an honest unknown keeps the next person looking; a
wrong culprit stops them.

The general failure is an instrument that agrees with you: a test that cannot fail,
a suspect that cannot be exonerated, a harness that reports success for work that
never ran. **The defence in every case is an oracle the thing under test did not
produce** — the spec against the plan's own tests, a real workbook against
hand-written fixtures, `pgrep` against `ps`, a rendered page against a reviewer's
reasoning about it.

## Phase 4 — the UI redesign

Twelve plans in `docs/superpowers/plans/2026-09-17-ui-01..12-*.md`, coordinated by
`2026-09-17-ui-00-integration.md`. **Read the integration document before any
plan** — a ruling there overrides the plan it names, and its §3 table gives one
owner per shared file. The design gate is closed: these are executed, not re-argued.

The clickable mock is 13 artboards in light and dark:
<https://claude.ai/artifact/EssRZT3aDPRqMfiWad9tKe>. Use it for layout and copy.
The copy in `docs/superpowers/mock/` does not work standalone — its pages
cross-link to `*.dc.html` names that are not on disk — so link people to the
artifact, not the folder.

The mock is wrong in three known places and the plans are right: it uses gendered
Hebrew (`טרם שילמה`) that the schema cannot support; it shows a phone and email on
the person page, where `persons` has no such columns; and it puts an event task
inside the shifts group.
