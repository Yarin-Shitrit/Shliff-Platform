import type { Session } from 'next-auth';

/**
 * Gates every matched request: signed-in only. Phase 1 onboards admins only,
 * so a valid session is sufficient — per-role page rules are deliberately
 * undecided.
 *
 * A pure function, kept in its own module with only a type-only import, so
 * it is directly unit-testable without pulling in NextAuth's Next.js
 * integration (which requires `next/server` and does not resolve under
 * plain Vitest).
 */
export function isAuthorized(auth: Session | null): boolean {
  return !!auth?.user;
}
