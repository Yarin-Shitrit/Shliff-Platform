import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AdminCheck } from '@/lib/auth/guard';
import type { SeedResult } from '@/lib/import/seed';

/**
 * `./actions` is a `'use server'` module that imports `@/db` at module scope
 * (which throws at import time without `DATABASE_URL`) and `@/lib/auth/guard`
 * (which reaches NextAuth and argon2) — both are replaced before the module
 * is imported, the same way `src/app/api/uploads/route.test.ts` does it.
 *
 * `@/lib/import/seed` and `@/lib/seed/camp-seed` are replaced too: this test
 * isolates the `NODE_ENV` branch inside `seedAction` itself, not the
 * (separately tested) file-reading pipeline behind it — a real
 * `seedReferenceWorkbooks` would try to run real queries against the `{}`
 * stand-in for `db` and fail for the wrong reason.
 *
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws a hoisting `ReferenceError` —
 * `vi.hoisted` gives the factories something to close over instead.
 */
const { adminRef, seedReferenceWorkbooks } = vi.hoisted(() => ({
  adminRef: { current: { ok: true, email: 'admin@example.com' } as AdminCheck },
  seedReferenceWorkbooks: vi.fn(async (): Promise<SeedResult> => ({ imported: [], skipped: [] })),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => adminRef.current }));
vi.mock('@/lib/import/seed', () => ({ seedReferenceWorkbooks }));
vi.mock('@/lib/seed/camp-seed', () => ({ seedCampBaseline: vi.fn() }));

import { seedAction } from './actions';

describe('seedAction — production gate', () => {
  beforeEach(() => {
    adminRef.current = { ok: true, email: 'admin@example.com' };
    seedReferenceWorkbooks.mockClear();
  });

  afterEach(() => {
    // `NODE_ENV` is a read-only property on `process.env` as far as
    // @types/node is concerned; `vi.stubEnv`/`vi.unstubAllEnvs` are vitest's
    // sanctioned way to override and restore it without fighting that type.
    vi.unstubAllEnvs();
  });

  it('refuses with the "production" code and never touches the workbooks', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await expect(seedAction()).rejects.toThrow('production');
    expect(seedReferenceWorkbooks).not.toHaveBeenCalled();
  });

  it('proceeds to seed the workbooks outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');

    await expect(seedAction()).resolves.toEqual({ imported: [], skipped: [] });
    expect(seedReferenceWorkbooks).toHaveBeenCalledTimes(1);
  });

  it('still refuses an unauthorized caller in production, before the production check', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    adminRef.current = { ok: false };

    await expect(seedAction()).rejects.toThrow('unauthorized');
    expect(seedReferenceWorkbooks).not.toHaveBeenCalled();
  });
});
