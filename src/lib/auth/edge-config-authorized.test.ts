import { describe, it, expect } from 'vitest';
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

  it('refuses an anonymous request (no session)', async () => {
    expect(await authorized({ auth: null } as any)).toBe(false);
  });

  it('refuses a session with no user', async () => {
    expect(await authorized({ auth: { user: undefined, expires: '' } } as any)).toBe(false);
  });

  it('allows a signed-in user', async () => {
    expect(await authorized({
      auth: { user: { email: 'admin@example.com' }, expires: '' },
    } as any)).toBe(true);
  });
});
