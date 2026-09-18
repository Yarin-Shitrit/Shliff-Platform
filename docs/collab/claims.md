# What is in flight

**updated: 2026-09-18** · if that date is more than a day or two old, **this file
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
| Logistics | `@<teammate-handle>` | — |

> Fill in both contact columns. "Ask Yarin" is not actionable at 23:00 on a
> Saturday unless it says *how*.

Decisions that are **always** the camp lead's, never settled between sessions:
adding a dependency (ruling R1), restarting or resetting the database, anything
touching `docs/reference-data/`, and pushing or force-pushing shared branches.

## 3. Current claims

| Who | Area | Branch | State | As of |
|---|---|---|---|---|
| @Yarin-Shitrit | Phase 4 UI redesign | `feat/ui-01-foundation` | **active** — wave 3 | 2026-09-18 |
| `@<teammate-handle>` | Logistics | — | onboarding, not yet started | 2026-09-18 |
| @Yarin-Shitrit | Collaboration harness | `docs/collab-harness` | this document | 2026-09-18 |

### Phase 4, in more detail

Reported by the session executing it on 2026-09-18, **not independently verified
— confirm with §1 before relying on it**:

- **Wave 2 complete and merged** — plans 06 (אנשים), 07 (דמי קאמפ), 08 (כספים),
  10 (משימות). Gate reported at 150 files, 1760 tests, 0 failures.
- **Wave 3 in flight**, three lanes at once:
  - plan 09 → `src/app/(admin)/money/ledger`, `.../debts`, `src/lib/money/**`
  - plan 11 → `src/app/(admin)/imports/**`, `src/app/(admin)/upload/**`, `src/lib/import/**`
  - a shared-module consolidation → `src/lib/errors/hebrew.ts`,
    `src/app/(admin)/tasks/failure-messages.ts`, `src/app/(admin)/shell/actions.ts`
- Still ahead: wave 4 (plan 04 בית), wave 5 (plan 12 mobile and polish, which
  deletes wave 0's token aliases).

**If you are starting logistics while wave 3 is live**, the collision risk is
`src/lib/errors/hebrew.ts` and the shell — both are mid-consolidation. Add your
Hebrew error strings *after* that lands, or coordinate first.

### Environment, as of 2026-09-18

- `shliff-pg` is **up**, on port **5433**. It is stopped from time to time on
  purpose to relieve memory pressure on the dev box — connection errors from a
  DB-backed page mean check `docker ps -a --filter name=shliff` before you debug
  code. Ask the camp lead before restarting it.
- `origin` carries `main` (`45fa275`) and `feat/ui-01-foundation`. Both were
  pushed on 2026-09-18 after nine days during which the remote held nothing newer
  than 2026-09-09.

## 4. Updating this file

Add your row when you start. Change it when the branch or state changes. **Delete
it when the work merges.** Bump the `updated:` date at the top every time — it is
the only thing that tells the next reader whether to believe the rest.

A claim that outlives its work is worse than no claim at all: the next person
routes around a file nobody is holding, and pays for a conflict that no longer
exists.
