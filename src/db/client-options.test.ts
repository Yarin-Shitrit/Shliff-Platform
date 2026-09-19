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
