# Shliff Platform

A digital platform for organizing MidBurn camp data — replacing the ad-hoc Excel/CSV
workflow used to track camp finances, events, budgets and members.

Status: **in build**. Phases 1-3 (ingestion, members and fees, the money ledger and
block promotion) have landed; Phase 4, a full UI redesign, is in progress. The specs
are in [`docs/superpowers/specs/`](docs/superpowers/specs/) — start with
[the Phase 1 design spec](docs/superpowers/specs/2026-09-09-camp-data-platform-design.md)
for what the platform is for.

## Working here with someone else

Two developers share this repository. Start at
[`docs/collab/onboarding.md`](docs/collab/onboarding.md) — setup, the toolchain,
and the skills this project runs on. Then
[`docs/collab/protocol.md`](docs/collab/protocol.md) for how changes are shared,
[`docs/collab/ownership.md`](docs/collab/ownership.md) for who owns what, and
[`docs/collab/claims.md`](docs/collab/claims.md) for what is in flight right now.

## Repository layout

| Path | Purpose |
| --- | --- |
| `docs/superpowers/specs/` | Design specifications |
| `docs/reference-data/` | Real historical workbooks used to derive the ingestion schema |
| `docs/collab/` | How two people share this repo without colliding |

## Reference data

`docs/reference-data/` contains the actual camp financial workbooks (2023-24, 2026).
They include real names and amounts — this repository is **private** and must stay private.
They are excluded from every deployed function's trace (`next.config.ts`'s
`outputFileTracingExcludes`), so a production build cannot ship them, and loading them
into the database (`seedReferenceWorkbooks`, the "טען את קבצי העבר" button on the
upload page) is a development-only tool that refuses to run in production.

## Creating an admin user

```sh
ADMIN_PASSWORD="..." npx tsx scripts/create-admin.ts <email>
```

The password is read from the `ADMIN_PASSWORD` environment variable, never from a
command-line argument — an argv password would linger in shell history and in
`ps` output. The script refuses with a usage message if `ADMIN_PASSWORD` (or the
email) is missing.
