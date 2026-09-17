import { describe, it, expect } from 'vitest';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { proxy, config } from '@/proxy';
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

/**
 * M15: the matcher's exclusions must be anchored to whole path segments, not
 * matched as a bare prefix. `/signin-x`, `/signinfoo`, `/api/authz` and
 * `/favicon.icox` are real routes distinct from the excluded ones and must
 * still be gated; `/signin`, `/signin/…`, `/api/auth/…`, `/_next/static/…`,
 * `/_next/image…` and exactly `/favicon.ico` stay excluded.
 *
 * `unstable_doesMiddlewareMatch` (from `next/experimental/testing/server`)
 * runs the same matcher compiler Next uses at build time, so this tests the
 * exported `config` itself rather than a hand-rolled regex reimplementation.
 * See the task report for why this is the helper used, not
 * `unstable_doesProxyMatch`.
 */
describe('proxy matcher (M15: whole-segment exclusions)', () => {
  it.each([
    // Ordinary app routes: the gate must run on these.
    ['/', true],
    ['/money', true],
    ['/data', true],
    // Look-alikes of excluded segments: must NOT be swallowed by a prefix match.
    ['/signin-x', true],
    ['/signinfoo', true],
    ['/api/authz', true],
    ['/favicon.icox', true],
    // The excluded segments themselves, and their subpaths: must stay excluded.
    ['/signin', false],
    ['/signin/reset', false],
    ['/api/auth/session', false],
    ['/_next/static/chunk.js', false],
    ['/_next/image', false],
    ['/favicon.ico', false],
  ] as const)('%s → gated: %s', (url, expected) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(expected);
  });
});
