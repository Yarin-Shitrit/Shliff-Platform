import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import type { AdminCheck } from '@/lib/auth/guard';
import type { Storage } from '@/lib/storage';

const { adminRef, storageRef } = vi.hoisted(() => ({
  adminRef: { current: { ok: true, email: 'admin@example.com' } as AdminCheck },
  storageRef: { current: null as Storage | null },
}));

vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => adminRef.current }));
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return { ...actual, getStorage: () => storageRef.current ?? actual.getStorage() };
});

import { config } from '@/proxy';
import { getStorage } from '@/lib/storage';
import { GET } from './route';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const OTHER = '5e1d2c3b-4a59-4876-9e0f-a1b2c3d4e5f6';
const SHA = 'c'.repeat(64);
const BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const ask = (planId: string, file: string) =>
  GET(new Request(`http://localhost/site/underlay/${planId}/${file}`), { params: Promise.resolve({ planId, file }) });

/** A store that answers every read, and remembers what it was asked. */
function watchedStore(): { store: Storage; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn(async () => BYTES);
  return { store: { put: vi.fn(async (key: string) => key), get }, get };
}

describe('GET /site/underlay/<planId>/<file>', () => {
  let storageDir: string;

  beforeEach(() => {
    adminRef.current = { ok: true, email: 'admin@example.com' };
    storageRef.current = null;
    storageDir = mkdtempSync(join(tmpdir(), 'shliff-underlay-get-'));
    process.env.STORAGE_DRIVER = 'local';
    process.env.LOCAL_STORAGE_DIR = storageDir;
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('serves the picture to an admin with its type, a year of private caching and no sniffing', async () => {
    await getStorage().put(`site-underlays/${PLAN}/${SHA}.png`, BYTES);
    const response = await ask(PLAN, `${SHA}.png`);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BYTES);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('names the type by the stored extension', async () => {
    await getStorage().put(`site-underlays/${PLAN}/${SHA}.jpg`, BYTES);
    await getStorage().put(`site-underlays/${PLAN}/${SHA}.webp`, BYTES);
    expect((await ask(PLAN, `${SHA}.jpg`)).headers.get('Content-Type')).toBe('image/jpeg');
    expect((await ask(PLAN, `${SHA}.webp`)).headers.get('Content-Type')).toBe('image/webp');
  });

  it('is not gated by the proxy, so it gates itself: 401 without an admin session, and storage is never asked (Review Focus #4)', async () => {
    // The proxy lets every path ending in an image extension through unauthenticated (`src/proxy.ts`, for public/).
    // This route's own requireAdmin is the only thing between these bytes and anyone with the URL.
    expect(unstable_doesMiddlewareMatch({ config, url: `/site/underlay/${PLAN}/${SHA}.png` })).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, url: `/site/underlay/${PLAN}` })).toBe(true);

    const watched = watchedStore();
    storageRef.current = watched.store;
    adminRef.current = { ok: false };
    const response = await ask(PLAN, `${SHA}.png`);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    expect(watched.get).not.toHaveBeenCalled();
  });

  it('never asks storage for a name outside the pattern, or for a plan that is not a plan id (Review Focus #4)', async () => {
    const watched = watchedStore();
    storageRef.current = watched.store;
    for (const [planId, file] of [
      [PLAN, 'x.png'], [PLAN, `${SHA}.gif`], [PLAN, `${SHA}.PNG`], [PLAN, `${SHA}.png.json`], [PLAN, `${SHA}.jpeg`],
      ['..', `${SHA}.png`], ['not-a-plan', `${SHA}.png`], [`${PLAN}/..`, `${SHA}.png`],
    ]) {
      expect((await ask(planId, file)).status).toBe(404);
    }
    expect(watched.get).not.toHaveBeenCalled();
  });

  it('answers 404 for a file that is not there, and for one that belongs to another map', async () => {
    expect((await ask(PLAN, `${SHA}.png`)).status).toBe(404);
    await getStorage().put(`site-underlays/${OTHER}/${SHA}.png`, BYTES);
    expect((await ask(PLAN, `${SHA}.png`)).status).toBe(404);
    expect((await ask(OTHER, `${SHA}.png`)).status).toBe(200);
  });
});
