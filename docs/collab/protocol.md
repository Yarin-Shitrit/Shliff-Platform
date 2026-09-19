# How two people share this repo

Two developers, two machines, each running their own Claude Code sessions.
GitHub is the only place both machines can see. Everything below exists to make
one thing true:

> **No change to a file someone else depends on happens silently.**
> Either you integrate with them, or you surface it as a decision. You never
> overwrite and hope.

That is the same rule the product itself follows — the system never guesses, and
what it cannot resolve becomes a visible decision. The team works the way the
software works.

---

## 1. The three kinds of file

Everything in `src/` is exactly one of these. `docs/collab/ownership.md` says
which.

| Kind | Rule |
|---|---|
| **Yours** | Inside your area. Edit freely. No announcement, no permission. |
| **Theirs** | Inside someone else's area. **Read it, import from it, never edit it.** If you need it changed, ask — that is a decision, not an edit. |
| **Shared surface** | Nobody owns it alone: schema, the shell and nav, seasons, tokens, the component kit, the Hebrew error map. You *may* edit it, but the change must be **surfaced** — see §3. |

A file you cannot classify is a shared surface until someone says otherwise. That
default is deliberate: guessing "probably mine" is the failure this document exists
to prevent.

## 2. Branches and pull requests

- **Branch per unit of work**, named for what it is: `feat/logistics-crew-shifts`,
  not `feat/my-work`. Branch off `main`.
- **Push early.** A branch that exists only on your laptop cannot be seen, reviewed
  or recovered. This repo lost nine days to that — 334 commits on one machine with
  no remote copy.
- **Never commit to `main` directly.** It is the integration point for both of you.
- **One PR per branch**, and the PR body states:
  - what changed, in a sentence;
  - **every shared surface it touches**, by path (see §3);
  - what you ran: `npx tsc --noEmit`, and the capped vitest command from
    `CLAUDE.md` with its real numbers.
- **A PR that touches a shared surface needs the other person's review.** A PR
  entirely inside your own area does not — merge it yourself and keep moving.

Keep your branch current with `git merge origin/main` rather than a rebase.
Rebasing a branch someone has already fetched rewrites history under them, and
with agents running on both sides that is expensive to untangle.

**Catching a local ref up is not the same as merging into a tree.** If your
local `main` is only behind — 0 ahead, N behind — move the ref without touching
any working tree:

```sh
/usr/bin/git fetch origin
/usr/bin/git branch -f main origin/main    # safe while agents are running
```

That changes no file on disk, so nothing an agent is mid-read of can shift under
it. A `checkout` or a `merge` inside a tree an agent is working in is a different
act entirely: it can swap `CLAUDE.md` and `AGENTS.md` underneath a running task,
and the resulting misbehaviour is invisible in the diff. Do that between waves.

Before merging `origin/main` into a live branch, check whether it even overlaps
you:

```sh
/usr/bin/git diff --name-only <your-branch>...origin/main
```

No overlap with the files you are touching means the merge ahead is clean and
can wait for a convenient moment rather than an urgent one.

## 3. Surfacing, concretely

"Surface it" is not "mention it in Slack". It means all four of:

1. **Say so in the PR body**, under a heading `## Shared surfaces touched`, one
   line per path and why.
2. **Request review from the other person** on that PR. Do not self-merge it.
3. **Update `docs/collab/claims.md`** in the same PR if the change shifts who is
   working where.
4. **If the change removes or renames something they consume, do not do it in that
   PR.** Add the new thing, leave the old, merge. Delete in a follow-up once they
   have moved. Two small PRs cost less than one broken branch on another machine.

**When you disagree about a shared surface, neither of you decides alone.** Put
both options in the PR thread and pick together. If you cannot reach each other and
the work is blocked, write down the decision you would make and *why* in the PR,
and take the reversible option — the one that leaves the other person able to change
their mind cheaply.

## 4. A correction goes where the wrong thing is

When you reverse something a table, a contract or a header comment states,
**change that statement in the same commit.** Appending the correction elsewhere
— a ruling further down the file, a note in the PR, a message to the other
person — only fixes it for people who read both. The ones who trust the contract
and stop reading are exactly the ones who will be wrong, and they will be wrong
confidently.

This is not hypothetical. The UI integration document's §3 ownership table gave
the Icon component's path. Ruling A1, in the same file further down, had reversed
that path long before, and the table was never updated. It stayed wrong and was
read as authoritative, because a table headed "Who owns what" does not advertise
that something below supersedes it. Fixed in `7a1e71c`.

The same applies to `docs/collab/`: if a PR changes who owns something, the table
in `ownership.md` changes in that PR — not in a comment, and not next time.

## 5. Starting and finishing

**Before you start:**

```sh
/usr/bin/git fetch origin && /usr/bin/git log --oneline -20 origin/main
cat docs/collab/claims.md          # and check its `updated:` stamp
```

If `claims.md` is more than a day or two old, do not trust it — its §1 gives the
commands to check live state, and its §2 says who to ask.

**Before you open the PR:**

```sh
npx tsc --noEmit
npx vitest run --maxWorkers=4 --hookTimeout 60000 --outputFile ".vitest/json/run-$$.json"
```

Put the real numbers in the PR body. "Tests pass" is not evidence; `1760 passed,
0 failed` is.

**After it merges:** update your entry in `claims.md` — or delete it. A claim that
outlives the work is worse than no claim, because the next person routes around a
file nobody is holding.

## 6. Agents, and why this document is strict

Both of us run multiple Claude sessions, and this repo has already produced every
one of these:

- A commit that **swept in another lane's staged deletions**, because `git add`
  stages a path but `git commit` takes the whole index.
- A `claims`-shaped list of in-flight paths that **went stale in under two hours**.
- Two sessions writing the same `worklist` module, one of them behind a dry-run
  flag that would have written to the live database on page load.
- A test suite green for months while every real workbook refused on a date format
  no test ever used.

So: **one working tree per session.** If you have more than one session running,
give each its own `git worktree` — that is what `../Shliff_Platform-lanes/*` are
for. Sessions sharing a tree share an index, and a shared index means your commit
can contain someone else's work under your message.

Before writing into a tree you did not start, check whether anyone else is in it:

```sh
pgrep -fl claude          # sessions on this machine
/usr/bin/git status       # someone else's staged work is someone else's commit
```

## 7. What never goes in a commit

- `docs/reference-data/` already holds real names and real amounts. It is in the
  repo and on the remote, and the repo is **private**. Keep it that way: no forks,
  no public mirrors, no pasting rows into an issue.
- Nothing from `.env.local`, `.uploads/`, or `.playwright-mcp/`.
- No screenshot of a real member's row in a PR. Use the mock's sample data — it is
  consistent across screens precisely so it can be shown.
