# Who owns what

Ownership here is by **area**, not by file list. File lists rot — an earlier draft
of this harness listed in-flight paths and was wrong within two hours. Areas
change every few weeks, so this document is worth trusting.

For *who is working where right now*, see `claims.md`. For the rules that follow
from this table, see `protocol.md`.

---

## Areas

| Area | Owner | Owns outright |
|---|---|---|
| **Phase 4 — UI redesign** | @Yarin-Shitrit | `src/app/(admin)/{members,fees,money,tasks,imports,upload,data}/**`, `src/components/**`, `src/lib/{members,fees,money,work,import,inbox,blocks}/**`, `docs/superpowers/**` |
| **Logistics** | `@<teammate-handle>` | `src/app/(admin)/logistics/**`, `src/lib/logistics/**`, `src/db/schema/logistics.ts` |
| **Collaboration harness** | @Yarin-Shitrit | `docs/collab/**`, `CLAUDE.md` |

> **Fill in the teammate's GitHub handle before sharing this file.** A placeholder
> owner is an unowned area, and an unowned area is where the silent overwrite
> happens.

Logistics is new, so almost all of it is new files — which is the good case. The
cost is concentrated in the handful of places a new feature has to reach into to
exist at all. Those are below.

## Shared surfaces

Nobody owns these alone. Editing one is allowed; editing one **silently** is not.
See `protocol.md` §3 for what surfacing means.

**Paths are qualified by branch, because the two branches disagree about what
exists.** A *(ui)* marker attaches to the path immediately before it, and means
that path lives only on `feat/ui-01-foundation`: Phase 4 has not merged to `main`.
So `layout.tsx`, `globals.css` and `money.ts` are on `main` today, while
`shell/**`, `tokens.css` and `dates.ts` are not. Finding one of them absent from
`main` means "not merged yet" — never "free to create". Verified 2026-09-18
against `main` (`45fa275`) and `origin/feat/ui-01-foundation`.

| Surface | Why it is shared | The usual collision |
|---|---|---|
| `src/db/schema/{source,auth,camp,money}.ts`, `drizzle/` | One migration sequence for the whole app | Two branches generate migrations with the same number, and whichever merges second is silently skipped |
| `src/app/(admin)/layout.tsx` · `src/app/(admin)/shell/**` *(ui)* | Every screen's nav and season switcher | Logistics adds a nav entry exactly where UI plan 02/12 is rewriting the shell |
| `src/lib/seasons/**` *(ui)* | `resolveSeason` / `pickSeason` scope every page | A second season resolver that disagrees with the first at the year boundary |
| `src/app/globals.css` · `src/app/tokens.css` *(ui)* | Owned by UI plan 01; plan 12 **deletes** the old aliases | New code written against an alias that is about to be removed |
| `src/components/ui/**` *(ui)*, including `ui/icon.tsx` | The component kit (UI plan 03) | A second button/drawer/table, slightly different, which then has to be reconciled by hand |
| `src/lib/errors/hebrew.ts` *(ui)* | The single Hebrew error map | English text reaching a Hebrew screen — a product-rule violation, not a style nit |
| `src/lib/money.ts` · `src/lib/dates.ts` *(ui)* | Formatting every screen shares | Two money formatters that round differently |
| `package.json` | **Ruling R1: no new dependencies.** Not a component library, not icons, not charts, not a test helper | Ask the camp lead first; it is not negotiable by PR |
| `vitest.config.ts`, `next.config.ts`, `tsconfig.json` | Build and test for everyone | A config change that only fixes your lane |
| `CLAUDE.md`, `AGENTS.md` | Injected into every session and subagent | Instructions changing under a running agent — invisible in the diff |

> **A correction, and the reason it matters.** Until `7a1e71c` (2026-09-18), §3
> named the Icon component `src/components/icon.tsx`. Ruling A1, in the same
> file further down, had reversed that long before — the spec's §C puts every
> kit component under `src/components/ui/` — but **the table itself was never
> updated**. A reader who trusted the contract and did not scroll to the addenda
> got the wrong path with complete confidence. §3 now names
> `src/components/ui/icon.tsx` and points at A1.
>
> The general form is in `protocol.md` §4: an addendum does not fix a wrong
> contract, it only fixes it for whoever reads both.

## Inside Phase 4

The twelve UI plans have their own finer-grained ownership, and it overrides
nothing here — it *refines* the UI area for whoever is executing those plans. It
lives in `docs/superpowers/plans/2026-09-17-ui-00-integration.md` §3, with one
owner per shared file and thirteen rulings that override the individual plans.

**Read the integration document before any UI plan.** Working from a plan alone
means duplicating a function another plan owns — that is why §3 exists.

## When the areas need to change

Areas are renegotiated between people, not claimed in a commit. If logistics turns
out to need real ownership of something on the shared list — say it grows its own
season logic — change this table in a PR, tag the other person, and say what moved
and why. That PR *is* the negotiation.
