# Hosting on Vercel + Railway — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the camp's admin platform on `https://shliff-platform.vercel.app`, backed by Railway Postgres holding the data that is on the camp lead's laptop today, without the camp's real workbooks ever reaching Vercel.

**Architecture:** Vercel (fra1) runs the Next.js 16 app; Railway (europe-west4) runs Postgres 16 and nothing else; Vercel Blob holds uploaded workbooks. The Vercel project is **never linked to GitHub** — GitHub Actions builds on its own Linux runner and ships `.vercel/output` with `vercel deploy --prebuilt`, so `docs/reference-data/` is never transmitted to Vercel in any form. Four small hardening changes make the existing code correct on serverless.

**Tech Stack:** Next.js 16.3.4, next-auth v5 beta, drizzle-orm 0.45 + drizzle-kit 0.31 (postgres-js), postgres.js 3.4, argon2 (native), @vercel/blob 2.8, vitest 5, Vercel CLI 54, Railway CLI 4.57, gh CLI.

**Spec:** `docs/superpowers/specs/2026-09-19-deployment-vercel-railway-design.md` — read it before Task 1. It carries the reasoning; this plan carries the steps.

## Global Constraints

Every task's requirements implicitly include all of these.

- **No new dependencies.** Ruling R1 (`docs/collab/ownership.md`): "not a component library, not icons, not charts, not a test helper". Adding one is the camp lead's call, never settled by PR. Nothing in this plan needs one.
- **No English error text ever reaches a Hebrew screen.** A platform-generated English error page counts as a violation; this is why Task 4 exists.
- **`docs/reference-data/` must never be transmitted to Vercel.** It holds real camp members' names and real amounts owed.
- **The production build runs on Linux, never on macOS.** `argon2` is a native module; a Mac-built bundle ships `darwin-arm64` and every sign-in 500s on Vercel *with a green build*.
- **`drizzle-kit push`, never `drizzle-kit migrate`.** `scripts/cutover.ts:24-31`: 0002–0004 were applied by `push` so the journal does not record them, and 0005–0006 were never applied. A `migrate` re-runs 0002–0004 and collides.
- **The database URL Vercel uses is Railway's `DATABASE_PUBLIC_URL`**, not `DATABASE_URL`. The latter is `postgres.railway.internal`, which resolves only inside Railway's network.
- **Regions are fra1 (Vercel) and europe-west4 (Railway)**, paired so app-to-database latency stays intra-Europe.
- **Never commit to `main`.** All work is on `feat/deploy-vercel-railway`. Shared surfaces are surfaced per `protocol.md` §3: a `## Shared surfaces touched` section in the PR body, review requested from @josefcohen96, and a `claims.md` row in the same PR.
- **Never write a database dump into the repository tree.** The dump holds real names and amounts. It lives inside the container's `/tmp` and is deleted in the same task.
- **Test command** — scoped to the files each task changes, never the full suite:
  ```sh
  npx vitest run --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 \
    --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json" <paths>
  ```
  **Always cross-check the exit code against the failure count.** Non-zero exit with zero failures means workers died, not that the suite is green. A killed worker's un-run tests report as `pending`, not failed.
- **Environment traps** (`CLAUDE.md`): read files with `Read`, not `cat` (the hook elides lines). `git log` is corrupted — use `/usr/bin/git log`. `grep` is truncated **and its count is falsified to match**; when a count decides something, take it twice or take it from `node` or a raw `/usr/bin` binary. `npx eslint` output is mangled — use `rtk proxy npx eslint`.

---

### Task 1: CI proves the app builds on Linux

The cheapest possible failure comes first. `.github/workflows/ci.yml` runs typecheck, lint and vitest but **never `next build`**, so the production build has only ever run on Apple silicon. If `argon2` or the output-file tracer breaks on Linux, this task finds it before any infrastructure exists to unwind.

This job is permanent, not scaffolding: it is the standing guard against a Mac-only build.

**Files:**
- Modify: `.github/workflows/ci.yml` (add a second job after `verify`)

**Interfaces:**
- Consumes: nothing.
- Produces: a green `build` job on this branch — the precondition every later task depends on.

- [ ] **Step 1: Read the existing workflow to match its conventions**

Read `.github/workflows/ci.yml` in full. Note the `env:` block at `:29-36` (the fake `DATABASE_URL` exists because `src/db/index.ts:7` throws at import), the Node pin `'22'` at `:45`, and the comment density — this repo explains *why* in its config files, and the new job must too.

- [ ] **Step 2: Add the build job**

Append to `.github/workflows/ci.yml`:

```yaml
  # `next build` had never run outside a developer's Mac. Two failure modes it
  # is here to catch, both of which pass every other check in this workflow:
  #   argon2 is a native module (node-gyp-build + a prebuilds/ tree). A bundle
  #     built on Apple silicon carries darwin-arm64 and 500s every sign-in on
  #     Vercel's Linux runtime, with a green build.
  #   the output-file tracer resolves differently on a case-sensitive
  #     filesystem, and next.config.ts leans on it to keep
  #     docs/reference-data/ out of every traced route.
  # It does not deploy. Deployment is .github/workflows/deploy.yml, which
  # builds its own copy through `vercel build`.
  build:
    name: next build (linux)
    runs-on: ubuntu-latest
    timeout-minutes: 20

    env:
      # Same reason as the verify job: src/db/index.ts reads DATABASE_URL at
      # import time and every route reaches it through src/lib/auth/config.ts,
      # so the build needs the variable to exist. Nothing connects to it --
      # every admin page is dynamic behind requireAdmin().
      DATABASE_URL: postgres://ci:ci@127.0.0.1:5432/ci
      AUTH_SECRET: ci-not-a-real-secret
      STORAGE_DRIVER: local
      LOCAL_STORAGE_DIR: ./.uploads

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm

      - run: npm ci

      - name: Build
        run: npx next build

      - name: Prove the real workbooks are not in the build output
        # next.config.ts excludes docs/reference-data/ from every traced route
        # via the global '/*' key. This asserts the exclusion actually held.
        #
        # Checking file PATHS alone would be an instrument that always agrees:
        # a non-standalone `next build` never copies traced files into .next,
        # it only LISTS them in .nft.json trace manifests. So a path check
        # passes even with outputFileTracingExcludes deleted outright. The
        # manifests' contents are the oracle that can actually fail.
        run: |
          set -euo pipefail

          manifests=$(find .next -name '*.nft.json' | wc -l | tr -d ' ')
          echo "trace manifests found: $manifests"
          if [ "$manifests" -eq 0 ]; then
            echo "no .nft.json manifests — this check cannot prove anything."
            echo "Find what this Next version names its trace files before trusting a green result."
            exit 1
          fi

          if grep -rl 'reference-data' $(find .next -name '*.nft.json') 2>/dev/null | head -1 | grep -q .; then
            echo "docs/reference-data/ is listed in a trace manifest — it would ship in a function bundle"
            grep -rl 'reference-data' $(find .next -name '*.nft.json') | head -5
            exit 1
          fi
          echo "no reference-data in any trace manifest"

          # Belt and braces: no copied file either.
          if find .next -path '*reference-data*' -print -quit | grep -q .; then
            echo "a reference-data path exists under .next"
            exit 1
          fi
          echo "no reference-data paths under .next"
```

- [ ] **Step 3: Commit and push so the runner picks it up**

```bash
/usr/bin/git add .github/workflows/ci.yml
/usr/bin/git commit -m "ci: build the app on Linux, where it will actually run

next build had never run off a developer's Mac. argon2 is native, so a
Mac-built bundle carries darwin-arm64 and 500s every sign-in on Vercel's
Linux runtime -- with a green build and a green test suite. The job also
asserts docs/reference-data/ stayed out of .next, so the tracing exclusion
in next.config.ts is verified rather than assumed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
/usr/bin/git push
```

- [ ] **Step 4: Open the PR so CI runs at all**

`ci.yml:6-9` triggers on `push` to `main` and on `pull_request` only — **a feature branch without a PR gets no signal.** Open it now, as a draft, and let it collect the evidence the later tasks cite.

```bash
gh pr create --draft \
  --title "feat(deploy): host the platform on Vercel + Railway" \
  --body "Implements \`docs/superpowers/specs/2026-09-19-deployment-vercel-railway-design.md\`. Draft until the live checks in Task 8 pass; the body gets its evidence and its \`## Shared surfaces touched\` section then."
```

- [ ] **Step 5: Watch the build job and read the actual failure if it fails**

```bash
gh run watch --exit-status $(gh run list --branch feat/deploy-vercel-railway --limit 1 --json databaseId -q '.[0].databaseId')
```

Expected: the `next build (linux)` job passes.

**If it fails, do not work around it — read the log and fix the cause.** The two likely causes and their fixes:
- `Cannot find module` / `.node` binding errors mentioning `argon2` → Task 2 Step 5 adds `serverExternalPackages`. Pull that step forward, then re-run.
- A tracer error about `docs/reference-data/` or dynamic filesystem access → re-read `next.config.ts:18-20` and `src/lib/storage/index.ts:19-29`; the fix belongs in whichever of those the message names, not in a new exclusion.

---

### Task 2: The Postgres client and the native module survive serverless

`src/db/index.ts:9` calls `postgres(connectionString)` with **no options at all**, and the module is a top-level singleton. On Vercel each function instance loads it once and gets postgres.js's default `max: 10` — ten sockets *per instance*. Sockets are also kept open across the freeze between requests, so the next thaw hands the pool a dead one.

**`ssl` must be conditional on the host.** The local container (`shliff-pg`, `postgres:16-alpine` on port 5433) does not serve TLS, so an unconditional `ssl: 'require'` would break every developer's machine and CI while looking like a production-only change.

**Files:**
- Modify: `src/db/index.ts:1-12`
- Modify: `next.config.ts`
- Test: `src/db/client-options.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: no new exports. `db` and `Db` keep their current signatures; `src/db/index.ts` continues to export exactly `db` and `type Db`.

- [ ] **Step 1: Write the failing test**

Create `src/db/client-options.test.ts`:

```ts
/**
 * `src/db/index.ts` is a module-level singleton that throws without
 * DATABASE_URL, so each case sets the env, resets the module registry, and
 * re-imports. `postgres` is mocked to capture the options object rather than
 * to fake a database — nothing here connects anywhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured: { url?: string; options?: Record<string, unknown> } = {};

vi.mock('postgres', () => ({
  default: (url: string, options?: Record<string, unknown>) => {
    captured.url = url;
    captured.options = options;
    // drizzle only stores this; it issues no query at import time.
    return {} as unknown;
  },
}));

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: () => ({}) as unknown,
}));

async function loadWith(url: string) {
  captured.url = undefined;
  captured.options = undefined;
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', url);
  await import('./index');
  return captured;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe('the postgres client the app deploys with', () => {
  it('requires TLS against a remote database', async () => {
    const { options } = await loadWith(
      'postgres://u:p@shliff.proxy.rlwy.net:41234/railway',
    );
    expect(options?.ssl).toBe('require');
  });

  it('does not require TLS against the local container, which serves none', async () => {
    // shliff-pg is postgres:16-alpine on 5433 with TLS off. An unconditional
    // ssl:'require' would break every developer's machine and CI.
    expect((await loadWith('postgres://u:p@localhost:5433/shliff')).options?.ssl).toBe(false);
    expect((await loadWith('postgres://u:p@127.0.0.1:5432/ci')).options?.ssl).toBe(false);
  });

  it('caps sockets low enough that a burst of instances cannot exhaust the server', async () => {
    const { options } = await loadWith('postgres://u:p@shliff.proxy.rlwy.net:41234/railway');
    // Each Vercel instance holds its own pool. 3 lets one page's Promise.all
    // of queries run in parallel; 20 concurrent instances then sit at 60
    // sockets, inside Railway's default limit. postgres.js would default to 10
    // per instance, i.e. 200.
    expect(options?.max).toBe(3);
  });

  it('keeps the local pool as wide as it is today', async () => {
    expect((await loadWith('postgres://u:p@localhost:5433/shliff')).options?.max).toBe(10);
  });

  it('closes idle sockets, because an instance is frozen between requests', async () => {
    const { options } = await loadWith('postgres://u:p@shliff.proxy.rlwy.net:41234/railway');
    expect(options?.idle_timeout).toBe(20);
    expect(options?.connect_timeout).toBe(10);
  });

  it('still refuses to load without a database url', async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', '');
    await expect(import('./index')).rejects.toThrow('DATABASE_URL is not set');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

```sh
npx vitest run --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 \
  --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json" \
  src/db/client-options.test.ts
```

Expected: FAIL. The TLS, `max`, `idle_timeout` and `connect_timeout` cases fail with `expected undefined to be 'require'` and similar, because no options object is passed today. The "refuses to load without a database url" case should **pass** already — it is a regression guard, and if it fails the mock setup is wrong, not the source.

- [ ] **Step 3: Implement the options**

Replace `src/db/index.ts:9` with:

```ts
/**
 * Serverless changes what a pool is for. Each Vercel instance loads this
 * module once and holds its own pool, so postgres.js's default `max: 10` is
 * ten sockets *per instance* — twenty warm instances would ask Railway for two
 * hundred. `max: 3` still lets one page's `Promise.all` of queries overlap,
 * which is the latency the fra1 ↔ europe-west4 pairing exists to protect,
 * while bounding that same burst to sixty.
 *
 * `idle_timeout` matters for the same reason: an instance is frozen between
 * requests, and a socket held across the freeze is dead on the next thaw.
 *
 * TLS is conditional on the host, not unconditional. `shliff-pg`
 * (postgres:16-alpine on 5433) serves no TLS, and neither does CI's fake
 * address, so `ssl: 'require'` everywhere would break every developer's
 * machine while reading as a production-only change. `'require'` encrypts
 * without demanding a verifiable CA chain, which is what Railway's TCP proxy
 * presents.
 *
 * NOT set: `prepare: false`. That is required against a *transaction-mode
 * pooler* — PgBouncer, Supabase's Supavisor, Neon's pooled endpoint — which
 * rejects named prepared statements. Railway's proxy is a plain passthrough,
 * and turning prepared statements off costs performance for nothing. If this
 * database is ever moved behind a pooler, `prepare: false` becomes mandatory
 * and the symptom is every query failing on a prepared statement.
 */
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);

const client = postgres(connectionString, {
  ssl: isLocal ? false : 'require',
  max: isLocal ? 10 : 3,
  idle_timeout: 20,
  connect_timeout: 10,
});
```

- [ ] **Step 4: Run the test again**

Same command as Step 2. Expected: PASS, 6 tests.

- [ ] **Step 5: Keep the native module out of the bundle**

In `next.config.ts`, add inside the `nextConfig` object, above `outputFileTracingExcludes`:

```ts
  /**
   * `argon2` is a native module: `node-gyp-build` picks a `.node` binding out
   * of its `prebuilds/` tree with a dynamic `require` that a bundler cannot
   * follow. Bundled, it resolves to nothing and every sign-in 500s — while the
   * build stays green, because nothing is missing until the call runs.
   *
   * Reached only from `src/lib/auth/password.ts`, which
   * `src/lib/auth/config.ts` imports for the Credentials provider. Never from
   * `src/lib/auth/edge-config.ts`, hence never from `src/proxy.ts` — the edge
   * half has no provider and no database, which is what keeps this a Node-only
   * concern.
   */
  serverExternalPackages: ['argon2'],
```

Then confirm the key is real in this version rather than assuming it:

```sh
rtk proxy grep -rn "serverExternalPackages" node_modules/next/dist/docs/ | head -5
```

Expected: hits in the Next 16 config docs. **If there are none, stop and read the config reference in `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/` for this version's spelling** — `AGENTS.md` warns that this is not the Next.js you know, and the option was `serverComponentsExternalPackages` under `experimental` in older majors.

- [ ] **Step 6: Typecheck, lint and commit**

```sh
npx tsc --noEmit
rtk proxy npx eslint
```

Both must be clean. Then:

```bash
/usr/bin/git add src/db/index.ts src/db/client-options.test.ts next.config.ts
/usr/bin/git commit -m "fix(db): a connection pool and a native module that survive serverless

postgres() was called with no options at all. On Vercel each instance holds
its own pool, so the default max:10 is ten sockets per instance; sockets were
also kept across the freeze between requests, so the next thaw got a dead
one. max:3 keeps a page's Promise.all overlapping while bounding twenty warm
instances to sixty sockets.

TLS is conditional on the host, deliberately: shliff-pg serves none, so an
unconditional ssl:'require' would have broken every developer's machine and
CI while reading as a production-only change.

argon2 is declared external because node-gyp-build's dynamic require cannot
be bundled -- the failure is every sign-in 500ing at runtime, with a green
build.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The storage driver refuses to guess

`src/lib/storage/index.ts:88` reads:

```ts
return process.env.STORAGE_DRIVER === 'blob' ? blobStorage() : localStorage();
```

Only the exact string `'blob'` selects Blob. `'Blob'`, `'vercel-blob'`, a trailing space, or an unset variable all select the **disk** driver, which `mkdir`s and `writeFile`s (`:46-47`). On Vercel that means a member uploads the camp's fee workbook, the UI reports success, and the file evaporates with the instance. Silent data loss is the worst failure mode in this codebase, and "the system never guesses" is the first product rule.

**Files:**
- Modify: `src/lib/storage/index.ts:87-89`
- Test: `src/lib/storage/storage.test.ts` (append a describe block)

**Interfaces:**
- Consumes: nothing.
- Produces: `getStorage(): Storage` — unchanged signature, new throwing behaviour when `STORAGE_DRIVER` is neither `'blob'` nor `'local'` and `NODE_ENV === 'production'`.

- [ ] **Step 1: Read the existing test file first**

Read `src/lib/storage/storage.test.ts` in full (122 lines). It already drives `getStorage()` by assigning `process.env.STORAGE_DRIVER` directly in `beforeEach`/`afterEach` (`:26`, `:61`, `:67`). Match that style; do not convert the existing blocks to `vi.stubEnv`.

- [ ] **Step 2: Write the failing test**

Append to `src/lib/storage/storage.test.ts`:

```ts
describe('driver selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses to pick a driver in production when STORAGE_DRIVER is unset', () => {
    // The old behaviour was to fall through to the disk driver. On Vercel that
    // writes to an ephemeral filesystem: the upload reports success and the
    // workbook is gone with the instance.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STORAGE_DRIVER', '');
    expect(() => getStorage()).toThrow(/STORAGE_DRIVER/);
  });

  it('names the value it was given, so a typo is diagnosable', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STORAGE_DRIVER', 'Blob');
    expect(() => getStorage()).toThrow(/"Blob"/);
  });

  it('accepts local in production when it is asked for explicitly', () => {
    // Explicit is the whole point: a deliberate choice is honoured, a guess is
    // not. Someone self-hosting with a persistent volume is not a mistake.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STORAGE_DRIVER', 'local');
    expect(() => getStorage()).not.toThrow();
  });

  it('accepts blob in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STORAGE_DRIVER', 'blob');
    expect(() => getStorage()).not.toThrow();
  });

  it('still falls back to disk outside production, so dev and tests need no setup', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('STORAGE_DRIVER', '');
    expect(() => getStorage()).not.toThrow();
  });
});
```

Add `afterEach` and `vi` to the file's existing `vitest` import if they are not already there.

- [ ] **Step 3: Run it and confirm it fails**

```sh
npx vitest run --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 \
  --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json" \
  src/lib/storage/storage.test.ts
```

Expected: the first two cases FAIL with "expected function to throw"; the last three PASS. Cross-check the exit code against the failure count.

- [ ] **Step 4: Implement**

Replace `src/lib/storage/index.ts:87-89` with:

```ts
/**
 * The driver is chosen explicitly or not at all.
 *
 * This used to be `=== 'blob' ? blobStorage() : localStorage()`, which meant
 * every typo and every unset variable selected the *disk* driver. On Vercel
 * the disk is ephemeral, so the camp's fee workbook would upload, report
 * success, and vanish with the instance — the system guessing, and guessing
 * wrong, about real financial records.
 *
 * Outside production the fallback stays: dev and tests should need no setup.
 * The message is English because its only audience is whoever is holding a
 * deploy log — it is an operator misconfiguration that cannot reach a Hebrew
 * screen, since a correctly configured deployment never evaluates this branch.
 */
export function getStorage(): Storage {
  const driver = process.env.STORAGE_DRIVER;
  if (driver === 'blob') return blobStorage();
  if (driver === 'local') return localStorage();

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `STORAGE_DRIVER must be "blob" or "local" in production; got ` +
        `${driver ? `"${driver}"` : 'no value'}. Uploads would otherwise be ` +
        `written to an ephemeral filesystem and silently lost.`,
    );
  }

  return localStorage();
}
```

- [ ] **Step 5: Run the storage tests again**

Same command as Step 3. Expected: PASS — the 5 new cases plus every pre-existing case in the file.

- [ ] **Step 6: Run the consumers of this module**

`src/app/api/uploads/route.test.ts` and `src/lib/import/seed.test.ts` both reach `getStorage()`.

```sh
npx vitest run --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 \
  --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json" \
  src/app/api/uploads/route.test.ts src/lib/import/seed.test.ts
```

Expected: PASS. They run under `NODE_ENV=test`, so the fallback still applies and nothing should change. If one fails because it set `STORAGE_DRIVER` to something misspelled, fix the test's value — that is the bug this task exists to expose.

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit
/usr/bin/git add src/lib/storage/index.ts src/lib/storage/storage.test.ts
/usr/bin/git commit -m "fix(storage): an unset driver is a decision, not a default

Only the exact string 'blob' selected Blob; 'Blob', a stray space and an
unset variable all selected the disk driver. On Vercel the disk is
ephemeral, so the camp's fee workbook would upload, report success, and
vanish with the instance -- the system guessing about real financial
records, which is the one thing it must never do.

Production now throws and names the value it was given. Outside production
the fallback stays, so dev and tests need no setup, and an explicit
STORAGE_DRIVER=local is still honoured in production for anyone
self-hosting with a real volume.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The upload cap fits inside Vercel's, so the Hebrew message wins

`src/lib/import/upload-limits.ts:14` sets `MAX_UPLOAD_BYTES = 25 * 1024 * 1024`. **Vercel rejects any request body over 4.5 MB itself**, before the route runs, with its own English error page. A member uploading a 10 MB file would get English text on a Hebrew screen — a product-rule violation, not a tuning question.

Measured: the largest real workbook in `docs/reference-data/` is **0.07 MB**. A 4 MB cap is ~57× larger than anything the camp actually uploads, and it keeps the refusal inside the app, in Hebrew.

`MAX_UPLOAD_MB` is interpolated into the two Hebrew strings at `:18-19`, so the new value must stay a whole number: `4`, never `4.5`.

**Files:**
- Modify: `src/lib/import/upload-limits.ts:1-19`
- Test: `src/lib/import/upload-limits.test.ts:9-13`
- Test: `src/app/(admin)/upload/upload-drop.test.tsx:32,47`

**Interfaces:**
- Consumes: nothing.
- Produces: `MAX_UPLOAD_BYTES = 4194304`, `MAX_UPLOAD_MB = 4`. `UPLOAD_RULES_HE` and `TOO_LARGE_HE` keep their wording and interpolate the new number. No export is added or removed.

- [ ] **Step 1: Change the tests to state the new intent, and watch them fail**

In `src/lib/import/upload-limits.test.ts`, replace the block at `:10-13`:

```ts
  it('stays inside the 4.5 MB body limit Vercel enforces before the route runs', () => {
    // Above Vercel's cap the platform refuses the request itself, with its own
    // English error page -- on a Hebrew screen. Keeping the app's own limit
    // below it means the Hebrew refusal in TOO_LARGE_HE is what a member sees.
    // The largest real workbook in docs/reference-data/ is 0.07 MB, so this is
    // ~57x the observed need.
    expect(MAX_UPLOAD_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_UPLOAD_MB).toBe(4);
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });

  it('states a whole number of megabytes, because the Hebrew interpolates it', () => {
    expect(Number.isInteger(MAX_UPLOAD_MB)).toBe(true);
  });
```

In `src/app/(admin)/upload/upload-drop.test.tsx`, change `25` to `4` at `:32` and `:47`:

```ts
    expect(screen.getByText(/קובץ אקסל \(xlsx\) בלבד, עד 4 מגה־בייט/)).toBeTruthy();
```

```ts
    expect(screen.getByText('הקובץ גדול מדי — עד 4 מגה־בייט.')).toBeTruthy();
```

- [ ] **Step 2: Run both test files and confirm they fail**

```sh
npx vitest run --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 \
  --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json" \
  src/lib/import/upload-limits.test.ts "src/app/(admin)/upload/upload-drop.test.tsx"
```

Expected: FAIL — `expected 26214400 to be 4194304`, and the two Hebrew strings not found because the rendered text still says `25`.

- [ ] **Step 3: Change the constant and say why in the file**

In `src/lib/import/upload-limits.ts`, replace `:14` and extend the header comment. The existing header (`:1-13`) explains that the number and its Hebrew live together; add the platform ceiling as the second reason:

```ts
/**
 * ...existing header text, unchanged...
 *
 * The 4 MB ceiling is Vercel's, not a preference. A serverless function
 * receives at most a 4.5 MB request body, and above that the platform refuses
 * the request before this route runs — returning its own English error page to
 * a Hebrew screen, which is a product-rule violation rather than a rough edge.
 * Staying below it keeps the refusal here, in Hebrew, in TOO_LARGE_HE.
 *
 * The headroom is real: the largest workbook in docs/reference-data/ measures
 * 0.07 MB, so this is roughly 57x the observed need. That measurement is also
 * why the upload route still imports inline rather than handing off to a
 * background job — at this file size it finishes well inside the function
 * timeout.
 *
 * Must stay a whole number: MAX_UPLOAD_MB is interpolated into the two Hebrew
 * strings below, and "4.5 מגה־בייט" would read as sloppily as it sounds.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
```

- [ ] **Step 4: Run both test files again**

Same command as Step 2. Expected: PASS.

- [ ] **Step 5: Run the route test, which enforces the limit**

```sh
npx vitest run --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 \
  --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json" \
  src/app/api/uploads/route.test.ts
```

Expected: PASS. If a case builds a fixture sized between 4 MB and 25 MB to prove the limit is enforced, it will now be rejected earlier than it expects — resize the fixture, do not raise the cap.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
/usr/bin/git add src/lib/import/upload-limits.ts src/lib/import/upload-limits.test.ts "src/app/(admin)/upload/upload-drop.test.tsx"
/usr/bin/git commit -m "fix(upload): cap below Vercel's body limit so the Hebrew refusal wins

The cap was 25 MB. Vercel refuses a request body over 4.5 MB before the
route runs and returns its own English error page -- to a Hebrew screen.
That makes this a product-rule fix, not a tuning knob.

4 MB keeps the refusal inside the app, in Hebrew. The largest real workbook
in docs/reference-data/ measures 0.07 MB, so the new cap is ~57x the
observed need -- the same measurement that says the upload route does not
need splitting into a background job.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Railway Postgres, carrying the data that is on the laptop

Provision Postgres in europe-west4, copy the laptop's database into it, and reconcile the schema with `push`.

**The dump contains real camp members' names and real amounts owed.** It is written inside the container's `/tmp`, never into the repository tree or the scratchpad, and deleted in Step 8.

**Files:** none in the repository. This task's deliverable is infrastructure plus a verified row count.

**Interfaces:**
- Consumes: nothing.
- Produces: a Railway Postgres service, and its `DATABASE_PUBLIC_URL`, which Task 6 sets on Vercel.

- [ ] **Step 1: Confirm the source database is actually up**

```sh
docker ps -a --filter name=shliff
```

Expected: `shliff-pg`, status `Up`, `0.0.0.0:5433->5432/tcp`. **If it is stopped, stop and ask the camp lead** — starting it is their call (`claims.md` §2), and a stopped container produces connection errors that read exactly like a code defect.

- [ ] **Step 2: Record the source row counts, twice**

These are the numbers Step 7 checks the restore against. `CLAUDE.md`: counts here are intermittently inflated, and a single confident number is not evidence.

```sh
for i in 1 2; do
  docker exec shliff-pg psql -U shliff -d shliff -tAc \
    "select 'persons='||count(*) from persons"
  docker exec shliff-pg psql -U shliff -d shliff -tAc \
    "select 'users='||count(*) from users"
done
```

Expected: `persons=25` and `users=1`, both readings agreeing. **If the two readings disagree, take a third** — two readings of the same unchanged thing that disagree is the signal.

- [ ] **Step 3: Create the project and the database, in europe-west4**

Check the flags this CLI version actually has before using them:

```sh
railway --version          # expect 4.57.1 or newer
railway init --help
railway add --help
```

Then create:

```sh
railway init --name shliff-platform
railway add --database postgres
```

**Region:** if `railway add --help` shows no region flag, set the service's region to **europe-west4** in the Railway dashboard under the Postgres service → Settings → Region, and confirm it took before continuing. Do not skip this and do not silently accept a US region: the spec pairs fra1 with europe-west4 precisely so every page's several sequential queries stay inside Europe. If europe-west4 is unavailable on this account, record which region was used and tell the camp lead — the Vercel region in Task 6 must then match it.

- [ ] **Step 4: Get the public URL, and prove it is the public one**

```sh
railway variables --service Postgres
```

Copy **`DATABASE_PUBLIC_URL`** — the one whose host ends in `.proxy.rlwy.net`. Then assert that, rather than trusting the eye:

```sh
railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' \
  | sed 's/^DATABASE_PUBLIC_URL=//' > /dev/null && echo "present"
```

**`DATABASE_URL` is the wrong one.** It is `postgres.railway.internal`, which resolves only inside Railway's network; Vercel is outside it, and the failure is a DNS error that reads like an outage.

Hold the value in a shell variable for the remaining steps, never in a file and never in a command's arguments:

```sh
read -rs RAILWAY_URL    # paste the DATABASE_PUBLIC_URL, press enter
export RAILWAY_URL
```

- [ ] **Step 5: Confirm you can reach it, and that it is empty**

```sh
docker exec -e U="$RAILWAY_URL" shliff-pg psql "$U" -tAc "select version()"
docker exec -e U="$RAILWAY_URL" shliff-pg psql "$U" -tAc \
  "select count(*) from information_schema.tables where table_schema='public'"
```

Expected: PostgreSQL 16 or 17, and `0` tables. The container's own `psql` is used because it is version 16 and definitely present; the host may have no client at all.

- [ ] **Step 6: Dump and restore**

```sh
docker exec shliff-pg sh -c \
  'pg_dump -U shliff -Fc --no-owner --no-privileges shliff > /tmp/shliff.dump && ls -l /tmp/shliff.dump'
```

Expected: a file of roughly 1–9 MB (the database is 9127 kB uncompressed; `-Fc` compresses).

```sh
docker exec -e U="$RAILWAY_URL" shliff-pg sh -c \
  'pg_restore --no-owner --no-privileges --no-comments -d "$U" /tmp/shliff.dump'
```

`--no-owner --no-privileges` because the Railway role differs from `shliff`; without them every `ALTER ... OWNER TO shliff` errors. Harmless warnings about the `public` schema already existing are expected. **Any error mentioning a table or a constraint is not harmless — stop and read it.**

- [ ] **Step 7: Verify the restore against the numbers from Step 2**

```sh
docker exec -e U="$RAILWAY_URL" shliff-pg psql "$U" -tAc \
  "select 'persons='||(select count(*) from persons)||' users='||(select count(*) from users)||' tables='||(select count(*) from information_schema.tables where table_schema='public')"
```

Expected: `persons=25 users=1 tables=22`. The 22 is from the spec's schema check (snapshot 0008 and the four schema files agree on 22 tables). **If persons is not 25, the restore is incomplete — do not continue to Task 6.**

- [ ] **Step 8: Delete the dump**

```sh
docker exec shliff-pg rm -f /tmp/shliff.dump
docker exec shliff-pg sh -c 'ls /tmp/shliff.dump 2>&1 || echo "gone"'
```

Expected: `gone`. Real names and amounts do not linger in a container's `/tmp`.

- [ ] **Step 9: Reconcile the schema with `push`, not `migrate`**

The dump reproduced the laptop's journal divergence exactly: 0002–0004 are applied but unrecorded, 0005–0006 were never applied, 0008 is pending. `drizzle-kit migrate` would try to re-run 0002–0004 and collide (`scripts/cutover.ts:24-31`).

```sh
DATABASE_URL="$RAILWAY_URL" npx drizzle-kit push
```

Review the diff it prints **before** confirming. Expected: additive changes only — the tables and columns from 0005, 0006 and 0008. **If it proposes to DROP a table or a column holding data, answer no and stop.** That means the schema files and the restored database disagree about something this plan has not accounted for, and dropping a column of the camp's ledger is not recoverable from here.

- [ ] **Step 10: Confirm the data survived the push**

```sh
docker exec -e U="$RAILWAY_URL" shliff-pg psql "$U" -tAc \
  "select 'persons='||count(*) from persons"
```

Expected: still `persons=25`.

---

### Task 6: The Vercel project, its Blob store, and its environment

Create the project **by CLI so it is never linked to GitHub**, then give it a region, a Blob store and four environment variables.

**Files:**
- Create: `.vercelignore`

**Interfaces:**
- Consumes: `DATABASE_PUBLIC_URL` from Task 5.
- Produces: `.vercel/project.json` containing `orgId` and `projectId`, which Task 7 reads into GitHub secrets. `.vercel/` is already git-ignored.

- [ ] **Step 1: Authenticate with the token, without putting it in argv**

The token is at `./VERCEL_TOKEN`, git-ignored, and the camp lead keeps it there for local use.

```sh
export VERCEL_TOKEN="$(node -e "const s=require('fs').readFileSync('VERCEL_TOKEN','utf8');const m=s.match(/([A-Za-z0-9_-]{16,})\s*$/);process.stdout.write(m?m[1]:'')")"
vercel whoami
```

Expected: `yshitrit123-8674`. The Vercel CLI reads `VERCEL_TOKEN` from the environment, so `--token` never appears in a command line or in shell history.

- [ ] **Step 2: Create and link the project — and do not connect Git**

```sh
vercel project add shliff-platform
vercel link --yes --project shliff-platform
```

**Do not run `vercel git connect`, and do not accept any dashboard prompt to connect a repository.** Git integration would clone the whole repository — `docs/reference-data/` included — into Vercel's build infrastructure. That is the single constraint this entire deployment shape exists to satisfy.

Verify it is unconnected:

```sh
vercel project inspect shliff-platform 2>&1 | grep -i -E 'git|repo' || echo "no git connection listed"
```

- [ ] **Step 3: Pin the function region to fra1**

```sh
vercel project inspect shliff-platform 2>&1 | head -20
```

Set the region to **fra1** in the project's Settings → Functions → Function Region. If Hobby restricts the choice, pick the nearest permitted European region and **write down which one** — the spec's risk table requires this to be recorded rather than silently absorbed, and Task 5's Railway region must match it.

- [ ] **Step 4: Create the Blob store**

```sh
vercel blob --help
```

If the CLI exposes a store command, use it; otherwise create the store in the dashboard under Storage → Blob, named `shliff-workbooks`, and copy its read-write token.

```sh
vercel blob store add shliff-workbooks    # only if `vercel blob --help` lists it
```

Creating the store through the dashboard while the project is linked may add `BLOB_READ_WRITE_TOKEN` to the project automatically. Step 6 checks whether it did rather than assuming either way.

- [ ] **Step 5: Set the environment variables, production scope only**

Each value is piped from stdin, never passed as an argument.

```sh
# The PUBLIC url from Task 5, exactly as Railway gives it -- no sslmode
# parameter appended. Task 2 sets ssl:'require' in the client for every
# non-local host, so the parameter would be redundant, and a URL that carries
# its own TLS setting invites the two to drift.
printf '%s' "$RAILWAY_URL" | vercel env add DATABASE_URL production

# A NEW secret -- not the laptop's. 32 bytes, base64.
openssl rand -base64 32 | tr -d '\n' | vercel env add AUTH_SECRET production

# Exactly 'blob'. Task 3 made any other value throw in production instead of
# silently writing to an ephemeral disk.
printf 'blob' | vercel env add STORAGE_DRIVER production
```

`LOCAL_STORAGE_DIR` is deliberately **not** set. `ADMIN_PASSWORD` is never set on the server — it is read only by `scripts/create-admin.ts`, and the admin account came across in Task 5's dump, so no account needs creating.

- [ ] **Step 6: Confirm all four variables exist**

```sh
vercel env ls production
```

Expected: `DATABASE_URL`, `AUTH_SECRET`, `STORAGE_DRIVER`, and `BLOB_READ_WRITE_TOKEN`. **If `BLOB_READ_WRITE_TOKEN` is absent**, the store did not attach itself — copy its token from the dashboard and add it:

```sh
printf '%s' "$BLOB_TOKEN" | vercel env add BLOB_READ_WRITE_TOKEN production
```

- [ ] **Step 7: Write `.vercelignore`**

Redundant under `--prebuilt`, which uploads only `.vercel/output`. It exists for the day somebody runs a plain `vercel deploy` from the laptop, when it is the only thing between the camp's workbooks and a third party.

Create `.vercelignore`:

```
# Redundant on the CI path, which ships only .vercel/output via
# `vercel deploy --prebuilt`. This file is the guard for the other path: a
# plain `vercel deploy` from a laptop uploads the working tree, and
# docs/reference-data/ holds real camp members' names and real amounts owed.
#
# docs/ is excluded wholesale rather than just docs/reference-data/, because
# nothing under docs/ is read at runtime: reference-workbooks.ts is the only
# reader, it is excluded from every traced route by next.config.ts, and
# upload/actions.ts refuses it in production anyway.
docs/

# Uploaded workbooks and test output, both local-only.
.uploads/
.vitest/
.worktrees/
.playwright-mcp/

# Rebuilt on the runner.
.next/
node_modules/

# A live deploy token must never be uploaded anywhere.
VERCEL_TOKEN
RAILWAY_TOKEN
```

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add .vercelignore
/usr/bin/git commit -m "chore(deploy): .vercelignore keeps the camp's workbooks off a laptop deploy

The CI path ships only .vercel/output, so this changes nothing there. It is
the guard for the other path: a plain \`vercel deploy\` run from a laptop
uploads the working tree, and docs/reference-data/ holds real names and real
amounts. docs/ goes wholesale because nothing under it is read at runtime.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The deploy workflow, and the first deployment

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `.vercel/project.json` from Task 6; the green `build` job from Task 1.
- Produces: a production deployment URL, which Task 8 verifies in a browser.

- [ ] **Step 1: Put the three secrets in GitHub**

```sh
gh secret set VERCEL_TOKEN < VERCEL_TOKEN
gh secret set VERCEL_ORG_ID --body "$(node -p "require('./.vercel/project.json').orgId")"
gh secret set VERCEL_PROJECT_ID --body "$(node -p "require('./.vercel/project.json').projectId")"
gh secret list
```

Expected: all three listed. The token is piped from the file, so it never enters shell history.

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

# Deploys only after CI has gone green on main, never merely because main
# moved. A red main is exactly when a deploy is most expensive, and CI is the
# only thing that runs the 2640-test suite.
#
# workflow_dispatch is the manual path: any redeploy that does not follow a
# commit. It cannot fire the FIRST deployment, though -- GitHub only offers
# workflow_dispatch for a workflow already present on the default branch, and
# this file is new. Hence the temporary push trigger below.
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:
  # TEMPORARY -- removed in Task 8 Step 9, before this goes up for review.
  #
  # The first deployment has to come from a Linux runner: building on a Mac
  # would ship argon2's darwin-arm64 binding and 500 every sign-in, which is
  # the failure Task 1 exists to catch. And it has to happen BEFORE the PR
  # merges, because Task 8 verifies the live site and the protocol wants that
  # evidence in the PR body. So this branch deploys itself, once.
  #
  # While this line is present, any push to this branch deploys production.
  push:
    branches: [feat/deploy-vercel-railway]

# Never two production deploys at once, and never cancel one midway -- a
# half-uploaded deployment is worse than a late one.
concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  deploy:
    name: build on linux · deploy prebuilt
    runs-on: ubuntu-latest
    timeout-minutes: 20
    if: ${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}

    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}

    steps:
      # For a workflow_run trigger, check out the commit CI actually tested --
      # not whatever main points at now, which may have moved.
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.ref }}

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm

      - run: npm ci

      - name: Pull the project's settings
        run: npx vercel pull --yes --environment=production

      # `vercel pull` writes the project's production environment to
      # .vercel/.env.production.local, and `vercel build` loads it -- which
      # would put the real database credentials into this runner for no
      # benefit. The build needs DATABASE_URL only to *exist*, because
      # src/db/index.ts:7 throws at import and every route reaches it through
      # src/lib/auth/config.ts. Nothing connects: every admin page is dynamic
      # behind requireAdmin(), and there are no NEXT_PUBLIC_* variables for a
      # build to inline. Runtime env comes from the project's settings at
      # invocation, so this substitution cannot reach production.
      - name: Replace the real database url with an unroutable one
        run: |
          node -e "
          const fs = require('fs');
          const f = '.vercel/.env.production.local';
          let s = fs.readFileSync(f, 'utf8');
          if (!/^DATABASE_URL=/m.test(s)) {
            console.error('DATABASE_URL absent from the pulled env — refusing to build blind');
            process.exit(1);
          }
          s = s.replace(/^DATABASE_URL=.*\$/m, 'DATABASE_URL=\"postgres://build:build@127.0.0.1:5432/build\"');
          fs.writeFileSync(f, s);
          console.log('build will use an unroutable DATABASE_URL');
          "

      - name: Build
        run: npx vercel build --prod

      # Uploads .vercel/output and nothing else. This is what keeps
      # docs/reference-data/ from ever reaching Vercel: the repository is not
      # connected to the project, so this runner is the only thing that ever
      # sees the working tree.
      - name: Deploy
        run: |
          URL=$(npx vercel deploy --prebuilt --prod)
          echo "deployed: $URL"
          echo "### Deployed" >> "$GITHUB_STEP_SUMMARY"
          echo "$URL" >> "$GITHUB_STEP_SUMMARY"

      - name: Prove the workbooks are not in what was uploaded
        run: |
          if find .vercel/output -path '*reference-data*' -print -quit | grep -q .; then
            echo "docs/reference-data/ is inside .vercel/output — it would have been uploaded"
            exit 1
          fi
          echo "no reference-data paths in .vercel/output"
```

- [ ] **Step 3: Commit and push**

```bash
/usr/bin/git add .github/workflows/deploy.yml
/usr/bin/git commit -m "ci(deploy): build on the runner, ship only .vercel/output

The Vercel project is deliberately not connected to this repository: Git
integration would clone docs/reference-data/ -- the camp's real names and
amounts -- into Vercel's build infrastructure. So the runner builds and
\`vercel deploy --prebuilt\` uploads .vercel/output alone, and the workbooks
never reach Vercel in any form. A find(1) check asserts that rather than
trusting it.

Triggered by CI going green on main, not by main moving: CI is the only
thing that runs the full suite, and a red main is when a deploy costs most.

The real DATABASE_URL is swapped for an unroutable one before the build.
src/db/index.ts throws at import without the variable, so it must exist; it
must not be the production credential, which the build has no use for.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
/usr/bin/git push
```

- [ ] **Step 4: Watch the deploy the push in Step 3 already triggered**

Step 3's push fires the temporary `push:` trigger — no manual dispatch, because `gh workflow run` cannot reach a `workflow_dispatch` workflow that is not yet on the default branch.

```sh
gh run watch --exit-status $(gh run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

If the run does not appear within a minute, the temporary trigger is missing or misspelled — check the `push:` block's branch name against the branch you are on (`/usr/bin/git rev-parse --abbrev-ref HEAD`) before trying anything else.

- [ ] **Step 5: Read the deployment URL out of the run**

```sh
gh run view --log $(gh run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId') \
  | grep -E 'deployed: https' | tail -1
```

Expected: a `https://shliff-platform-*.vercel.app` URL. Also confirm the alias:

```sh
vercel ls shliff-platform 2>&1 | head -5
vercel inspect shliff-platform.vercel.app 2>&1 | head -20
```

---

### Task 8: Verify it against a browser, then document and open the PR for review

The oracle here is a rendered page, not reasoning about one. `claims.md` records a `'use server'` bug that passed `tsc`, `eslint`, `next build` and 868 unit tests while returning 500 on **every** route including `/signin`. Nothing short of loading the page catches that class.

**Files:**
- Create: `docs/deploy.md`
- Modify: `docs/superpowers/specs/2026-09-09-camp-data-platform-design.md:336`
- Modify: `docs/collab/claims.md`

**Interfaces:**
- Consumes: the deployment URL from Task 7.
- Produces: a PR ready for @josefcohen96's review.

- [ ] **Step 1: Check the sign-in page over HTTP before opening a browser**

```sh
curl -sS -o /dev/null -w 'status=%{http_code}\n' https://shliff-platform.vercel.app/signin
curl -sS https://shliff-platform.vercel.app/signin | head -c 400
```

Expected: `status=200`, and HTML carrying `dir="rtl"` and `lang="he"`. A 500 here means the page is broken for everyone — read the runtime log before anything else:

```sh
vercel logs shliff-platform.vercel.app 2>&1 | head -40
```

- [ ] **Step 2: Sign in as the existing admin, in a real browser**

Use the `claude-in-chrome` tools (load them with one `ToolSearch` call, per the harness instructions). Navigate to `https://shliff-platform.vercel.app/signin`, sign in with the admin account that came across in Task 5's dump, and confirm the redirect lands on an authenticated page.

**Ask the camp lead for the password — do not reset it, and do not create a second admin.** A working account already exists; minting another is a credential this work does not need.

- [ ] **Step 3: Confirm the real data renders on the three pages that matter**

Visit `/inbox`, `/money` and `/members`. Each must render Hebrew, right-to-left, with real rows — not an empty state and not an error.

Then read the console for each:

```
mcp__claude-in-chrome__read_console_messages
```

Expected: no uncaught errors, and in particular nothing about `argon2`, a missing `.node` binding, `STORAGE_DRIVER`, or a connection failure. **Screenshots of these pages must not go in the PR** — `protocol.md` §7 forbids a screenshot of a real member's row. Describe what rendered instead.

- [ ] **Step 4: Upload a workbook and confirm it reached Blob, not a disappearing disk**

Upload a real `.xlsx` through `/upload`. Expected: it imports, and the import appears under `/imports`. Then confirm the object exists:

```sh
vercel blob list 2>&1 | head -10
```

Expected: an entry. **An import that succeeds while Blob stays empty is the exact silent-loss failure Task 3 was written to prevent** — if that happens, check `vercel env ls production` for `STORAGE_DRIVER=blob` before suspecting anything else.

- [ ] **Step 5: Prove the token never entered git history**

```sh
/usr/bin/git log --all --full-history --oneline -- VERCEL_TOKEN
/usr/bin/git log --all --full-history --oneline -- RAILWAY_TOKEN
```

Expected: both empty. Positive control, because an empty result from a hook-wrapped command can also mean the instrument is dead:

```sh
/usr/bin/git log --all --oneline -- .gitignore | head -3
```

Expected: non-empty. If the control is empty too, the command is lying and the check has not been made.

- [ ] **Step 6: Correct the Neon line where it is wrong**

`protocol.md` §4: a correction goes where the wrong statement is. `docs/superpowers/specs/2026-09-09-camp-data-platform-design.md:336` still says the database is Neon. Edit that line:

```markdown
| Database | Postgres (Railway) | Relational model with JSON columns for raw block grids. Neon until 2026-09-19; see `2026-09-19-deployment-vercel-railway-design.md` |
```

Verify the line number first — it was 336 on 2026-09-19, and the file may have moved since:

```sh
node -e "
const L=require('fs').readFileSync('docs/superpowers/specs/2026-09-09-camp-data-platform-design.md','utf8').split('\n');
L.forEach((l,i)=>{ if(/Neon/.test(l)) console.log((i+1)+': '+l.trim()); });
"
```

- [ ] **Step 7: Write the runbook**

Create `docs/deploy.md` covering, each in a few lines: the topology and why the regions are paired; the four production environment variables and what each failure looks like when one is wrong or missing; that the Vercel project is **not** connected to GitHub and must never be; how to deploy manually (`gh workflow run deploy.yml`); how to rotate the Vercel token (`vercel tokens`, then `gh secret set VERCEL_TOKEN`); how to restore the database from the laptop (Task 5's steps, condensed); and the standing rule that it is `drizzle-kit push`, never `migrate`, with the `scripts/cutover.ts:24-31` reference.

- [ ] **Step 8: Add the claims row**

In `docs/collab/claims.md` §3, add a row and bump the `updated:` date at the top — the date is the only thing telling the next reader whether to believe the rest:

```markdown
| @Yarin-Shitrit | Hosting on Vercel + Railway | `feat/deploy-vercel-railway` | **active** — live at shliff-platform.vercel.app; Vercel project deliberately not Git-connected | 2026-09-19 |
```

- [ ] **Step 9: Remove the temporary deploy trigger, then commit the documentation**

The first deployment is done, so `.github/workflows/deploy.yml`'s temporary `push:` block has served its purpose. **Delete it now** — the whole block, comment included — leaving `workflow_run` and `workflow_dispatch`. While it stays, any push to this branch redeploys production, and once this merges `workflow_dispatch` works normally because the file will be on the default branch.

Confirm it is gone before committing:

```sh
/usr/bin/grep -n -A2 '^on:' .github/workflows/deploy.yml
/usr/bin/grep -c 'feat/deploy-vercel-railway' .github/workflows/deploy.yml
```

Expected: the `on:` block lists only `workflow_run` and `workflow_dispatch`, and the branch name count is **0**.

```bash
/usr/bin/git add .github/workflows/deploy.yml docs/deploy.md docs/collab/claims.md docs/superpowers/specs/2026-09-09-camp-data-platform-design.md
/usr/bin/git commit -m "docs(deploy): a runbook, and Neon corrected where it was stated

The Phase 1 spec's stack table said Neon. Fixing it in the new design
document alone would only fix it for whoever reads both, so the old line
changes too -- protocol.md §4.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
/usr/bin/git push
```

- [ ] **Step 10: Fill in the PR body and request review**

Four shared surfaces are touched, so this is not a self-merge (`protocol.md` §3).

```sh
gh pr ready
gh pr edit --add-reviewer josefcohen96
```

The body must contain:

- What changed, in a sentence.
- A `## Shared surfaces touched` section, one line per path and why: `src/db/index.ts` (serverless pool options), `next.config.ts` (`serverExternalPackages` for argon2), `src/lib/storage/index.ts` (production refuses an unset driver), `src/lib/import/upload-limits.ts` (cap below Vercel's body limit), `.github/workflows/ci.yml` (a Linux build job). Note that all are additive — no export renamed or removed — and that none sits on the `src/lib/money/**` collision path `claims.md` names for logistics.
- What was run, with real numbers: `npx tsc --noEmit`, the scoped vitest runs from Tasks 2–4 with their counts, and the CI run's own result. "Tests pass" is not evidence.
- The live verification from Steps 1–5, in words, with no screenshot of a real member's row.

---

## Self-Review

**Spec coverage.** Spec §2 topology → Tasks 5, 6. §3 CI-prebuilt deploy → Tasks 1, 7. §4 code changes 1–4 → Tasks 2, 3, 4; changes 5–7 → Tasks 6 (`.vercelignore`), 7 (workflow), 8 (runbook); change 8 (Neon) → Task 8 Step 6. §5 database → Task 5. §6 env vars → Task 6 Steps 5–6; the token hazard → Task 8 Step 5. §7 verification steps 1–6 → Task 1 (Linux build), Task 5 Step 7 (`persons=25`), Task 8 Steps 1–5. §8 risks → the fallbacks written into Task 5 Step 3 and Task 6 Step 3. No gap found.

**Placeholder scan.** No TBD/TODO. Every code step carries the actual code. The two genuinely unknown CLI surfaces — Railway's region flag and `vercel blob store add` — are written as *verify with `--help` first, then this fallback*, which is a real instruction rather than a deferral.

**Type consistency.** `getStorage(): Storage` keeps its signature across Tasks 3, 6 and 8. `MAX_UPLOAD_BYTES` / `MAX_UPLOAD_MB` are named identically in Task 4's source and test steps. `db` and `type Db` are unchanged by Task 2. `RAILWAY_URL` is the shell variable carried from Task 5 Step 4 into Task 6 Step 5; `VERCEL_TOKEN` is the environment variable in Task 6 Step 1 and the GitHub secret name in Task 7 Step 1 — same name, two scopes, deliberately.

**One correction made during review.** An earlier draft set `ssl: 'require'` unconditionally, which would have broken every developer's machine and CI against `shliff-pg`, a container that serves no TLS. Task 2 now makes TLS conditional on the host and tests both sides.
