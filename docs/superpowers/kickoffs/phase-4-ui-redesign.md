# Phase 4 kickoff — the UI redesign

Paste everything below the line into a fresh Claude Code session started in
`/Users/yarin/GitProjects/Shliff_Platform`.

---

I lead Shliff, an Israeli Burning Man (MidBurn) camp, and this repo is the
camp's admin platform. The design work for a full UI redesign is finished:
there is a spec, twelve implementation plans, and an integration document
that fixes the execution order. **Your job is to execute it, not to redesign
it.** Do not run `superpowers:brainstorming` — the design gate is already
passed. Do not start by proposing alternatives to the plans; if you think one
is wrong, say so and wait for me.

## Step 0 — land the documents, then read them

The documents were drafted in another session's scratchpad and may not be in
the repo yet. Check:

```bash
ls docs/superpowers/plans/2026-09-17-ui-00-integration.md
```

If it is missing, copy the set in — and tell me what you copied before you
commit anything:

```bash
STAGE="/private/tmp/claude-501/-Users-yarin-GitProjects-Shliff-Platform/33f871c1-7d33-4c1a-bab5-2713784c6536/scratchpad"
cp -R "$STAGE/staging/docs/superpowers/." docs/superpowers/
mkdir -p docs/superpowers/mock
cp "$STAGE/mock/src/pages/"*.html "$STAGE/mock/src/shared.css" docs/superpowers/mock/
```

If that path no longer exists (it is a temp directory), stop and tell me —
do not reconstruct the plans from memory or from the mock. The plans
reference the artboards by their old scratchpad paths; after the copy, those
files are in `docs/superpowers/mock/`.

Then read, in this order:

1. `docs/superpowers/plans/2026-09-17-ui-00-integration.md` — the execution
   order, the thirteen integration rulings, and the file-ownership table. **A
   ruling there overrides the individual plan it names.**
2. `docs/superpowers/specs/2026-09-17-ui-redesign-design.md` — the spec all
   twelve plans argue from.
3. The plan for the wave you are about to start, in full.

The clickable mock is at https://claude.ai/artifact/EssRZT3aDPRqMfiWad9tKe —
13 artboards, light and dark. Use it for layout and copy. It is wrong in
three known places, and the plans are right: it uses gendered Hebrew
(`טרם שילמה`), which the schema cannot support; it shows a phone and email on
the person page, and `persons` has no such columns; and its task screen puts
an event task inside the shifts group.

## How to work

- **One plan at a time, in the order the integration document gives.** Wave 0
  is plan 01 alone. Do not start a wave until the previous one's gate passes:
  `npx tsc --noEmit` clean, `npx vitest run` green, every touched route
  rendering in both themes, and the keyboard path working.
- **Use `superpowers:subagent-driven-development`** — a fresh subagent per
  task, review between tasks. Every plan's header says so.
- **The plans are TDD and the steps are literal.** Write the failing test,
  watch it fail, write the minimal code, watch it pass, commit. Do not batch
  steps, and do not skip the "watch it fail" step — several plans include
  nets that are only trustworthy if you have seen them fail once.
- **Commit at each step that says commit.** Branch per plan; do not work on
  `main`.
- **No new dependencies.** Not a component library, not an icon package, not
  a chart library, not a test helper. This is ruling R1 and it is not
  negotiable without asking me.

## Other people are working in this repo right now

Up to four other sessions commit to this repo in parallel worktrees. Before
each plan:

- `git log --oneline -20` and `git status` — work may have landed after this
  prompt was written.
- Read the plan's `## Dependencies` section. Each names the files an
  in-flight lane owns and which ones you may only read.
- If a file you are about to modify has changed since the plan was written,
  re-read it and adapt the task rather than applying the plan's line numbers
  blindly.

Two hard gates on ordering, both in the integration document:

- **Plan 05 (לטיפול) must not start until Wave 2's `src/lib/data/worklist.ts`
  is merged.** If it is not there, the plan says to stop and report
  `BLOCKED`. Do that. Writing a second `worklist` risks a dry-run flag that
  writes to the live database on page load.
- **Plan 11 runs before plan 05** — 05 consumes 11's block-state projection
  (ruling I13).

## What I care about

The platform's rules come from the earlier specs and survive this redesign
intact: the system never guesses, and what it cannot resolve becomes a
visible decision rather than a silent one; every figure links to the page
that can change it; every number carries the workbook cell it came from, or
says it was entered by hand; an empty state is an invitation, not an apology;
and no English error text ever reaches a Hebrew screen.

If a plan tells you to do something that breaks one of those, stop and tell
me. If two plans disagree and the integration document has no ruling for it,
stop and tell me — do not pick one and carry on.

## Start here

Report what you found in Step 0, confirm the wave order back to me in three
lines, then begin **wave 0, plan 01 (Foundation)**: tokens, both themes,
fonts, the money and date helpers, and the `Icon` component. It is six tasks
and touches `src/app/tokens.css`, `globals.css`, `layout.tsx`,
`charts.module.css`, `src/lib/money.ts` and two new files — the least
conflict-prone work in the set. Ask me before you start wave 1.
