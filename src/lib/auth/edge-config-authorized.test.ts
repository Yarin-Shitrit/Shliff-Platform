import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { authConfig } from '@/lib/auth/edge-config';

/**
 * Exercises `authConfig.callbacks.authorized` through the real `edge-config`
 * module — not a re-declaration of the decision logic. `authorized.test.ts`
 * covers the pure `isAuthorized` function; this file covers the wiring: a
 * hardcoded `true`, a callback that stops delegating to `isAuthorized`, or a
 * missing `authorized` key would all fail here even though they'd slip past
 * the pure-function tests.
 */
describe('authConfig.callbacks.authorized (wiring)', () => {
  const authorized = authConfig.callbacks!.authorized!;

  /**
   * Calls the callback exactly as NextAuth does — the session under test plus
   * the request being authorized. Only `auth` decides the outcome, but the
   * request is part of the callback's contract, so a real `NextRequest` is
   * passed rather than casting the argument away.
   */
  const authorize = (auth: Session | null) =>
    authorized({ auth, request: new NextRequest('https://shliff.test/data') });

  it('refuses an anonymous request (no session)', async () => {
    expect(await authorize(null)).toBe(false);
  });

  it('refuses a session with no user', async () => {
    expect(await authorize({ user: undefined, expires: '' })).toBe(false);
  });

  it('allows a signed-in user', async () => {
    expect(await authorize({ user: { email: 'admin@example.com' }, expires: '' })).toBe(true);
  });
});
