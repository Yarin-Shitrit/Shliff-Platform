import { describe, it, expect } from 'vitest';
import { proxy } from '@/proxy';
import { auth } from '@/lib/auth/edge-config';

/**
 * `src/proxy.ts` must re-export `auth` from the edge-safe config, never from
 * `@/lib/auth/config` (the Node-runtime one that imports `@/db` and argon2 —
 * both unsupported on the Edge runtime Proxy runs on). A strict identity
 * check: if Proxy ever pointed at the wrong module, `proxy` and
 * `edge-config`'s `auth` would no longer be the same function reference (or,
 * if it pointed at the database-backed config, importing this file would
 * throw before the assertion even runs, since that module requires
 * `DATABASE_URL`).
 */
describe('proxy', () => {
  it('is the edge-safe auth() instance', () => {
    expect(proxy).toBe(auth);
  });
});
