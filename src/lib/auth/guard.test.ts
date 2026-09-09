import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from 'next-auth';

const { sessionRef } = vi.hoisted(() => ({
  sessionRef: { current: null as Session | null },
}));

/**
 * `guard.ts` reads its session from `@/lib/auth/config`, the Node-runtime
 * NextAuth instance — importing that for real pulls in `@/db` (which throws at
 * import time without `DATABASE_URL`), argon2 and the whole Credentials
 * provider. `auth()` is the only thing the guard uses, so it is the only thing
 * stubbed; the decision under test is entirely `guard.ts`'s own.
 */
vi.mock('@/lib/auth/config', () => ({ auth: async () => sessionRef.current }));

import { requireAdmin } from '@/lib/auth/guard';

/** `role` is attached to the session user by the NextAuth session callback. */
function session(user: { email?: string; role?: string } | undefined): Session {
  return { user, expires: '' } as Session;
}

/**
 * `requireAdmin()` is the single authorization primitive behind `/api/uploads`,
 * `confirmBlock`, `seedAction` and the import-review page. It must fail closed:
 * anything short of a signed-in user carrying the admin role is refused.
 */
describe('requireAdmin', () => {
  beforeEach(() => {
    sessionRef.current = null;
  });

  it('refuses when there is no session at all', async () => {
    sessionRef.current = null;
    expect(await requireAdmin()).toEqual({ ok: false });
  });

  it('refuses a session that carries no email, even with the admin role', async () => {
    sessionRef.current = session({ role: 'admin' });
    expect(await requireAdmin()).toEqual({ ok: false });
  });

  it('refuses a signed-in user whose role is not admin', async () => {
    sessionRef.current = session({ email: 'viewer@example.com', role: 'viewer' });
    expect(await requireAdmin()).toEqual({ ok: false });
  });

  it('refuses a signed-in user with no role at all', async () => {
    sessionRef.current = session({ email: 'nobody@example.com' });
    expect(await requireAdmin()).toEqual({ ok: false });
  });

  /**
   * The email is not decoration: it is what `confirmBlock` writes into
   * `blocks.confirmed_by` and what `/api/uploads` records as `uploaded_by`, so
   * the admit path must hand it back.
   */
  it('admits an admin and returns the email the audit trail is written with', async () => {
    sessionRef.current = session({ email: 'admin@example.com', role: 'admin' });
    expect(await requireAdmin()).toEqual({ ok: true, email: 'admin@example.com' });
  });
});
