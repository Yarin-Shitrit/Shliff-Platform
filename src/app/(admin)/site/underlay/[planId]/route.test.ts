import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, type TestDb } from '@/test/db';
import { seasons } from '@/db/schema/camp';
import { siteUnderlays } from '@/db/schema/site';
import { createPlan, planById } from '@/lib/site/plan';
import { MAX_UNDERLAY_BYTES, MAX_UNDERLAY_REQUEST_BYTES } from '@/lib/site/underlay-limits';
import type { AdminCheck } from '@/lib/auth/guard';
import type { Storage } from '@/lib/storage';

/**
 * The route imports `@/db` and `@/lib/auth/guard` at module scope; `@/db`
 * throws without `DATABASE_URL`, and the guard reaches NextAuth. Both are
 * replaced before the route is imported, as `/api/uploads`' test does. The
 * database stand-in is a proxy onto whichever PGlite the current test built.
 *
 * Storage is the real local driver in a temporary directory, except where a
 * test swaps in a store that behaves as Vercel Blob does
 * (`storageRef.current`).
 */
const { dbRef, adminRef, dbProxy, storageRef } = vi.hoisted(() => {
  const dbRef: { current: TestDb | null } = { current: null };
  const adminRef: { current: AdminCheck } = { current: { ok: true, email: 'admin@example.com' } };
  const storageRef: { current: Storage | null } = { current: null };
  const dbProxy = new Proxy({} as TestDb, {
    get(_target, property) {
      const db = dbRef.current;
      if (!db) throw new Error('test database not initialised');
      const value = Reflect.get(db, property) as unknown;
      return typeof value === 'function' ? value.bind(db) : value;
    },
  });
  return { dbRef, adminRef, dbProxy, storageRef };
});

vi.mock('@/db', () => ({ db: dbProxy }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => adminRef.current }));
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return { ...actual, getStorage: () => storageRef.current ?? actual.getStorage() };
});

import { POST } from './route';
import { sha256Hex } from '@/lib/storage';

function bytes(...parts: Array<number[] | string>): number[] {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (let i = 0; i < part.length; i += 1) out.push(part.charCodeAt(i));
    else out.push(...part);
  }
  return out;
}
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** A PNG header, zero-padded: the route reads headers, never pixels. */
function png(width: number, height: number, padTo = 64): Uint8Array {
  const header = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(width), be32(height), [8, 6, 0, 0, 0]);
  const out = new Uint8Array(Math.max(padTo, header.length));
  out.set(header);
  return out;
}
const PDF = Uint8Array.from(bytes('%PDF-1.7\n'));
const HEIC = Uint8Array.from(bytes(be32(24), 'ftyp', 'heic', be32(0), 'mif1', 'heic'));
const GIF = Uint8Array.from(bytes('GIF89a', [0x40, 0x01, 0xc8, 0x00]));

function send(planId: string, file: File | null) {
  const form = new FormData();
  if (file !== null) form.set('file', file);
  return POST(
    new Request(`http://localhost/site/underlay/${planId}`, { method: 'POST', body: form }),
    { params: Promise.resolve({ planId }) },
  );
}
// A copy over a plain ArrayBuffer: `File` takes no view that could sit on a SharedArrayBuffer (TS 5.9's BlobPart).
const upload = (planId: string, name: string, data: Uint8Array) => send(planId, new File([new Uint8Array(data)], name));

describe('POST /site/underlay/<planId>', () => {
  let storageDir: string;
  let planId: string;

  beforeEach(async () => {
    dbRef.current = await createTestDb();
    adminRef.current = { ok: true, email: 'admin@example.com' };
    storageRef.current = null;
    storageDir = mkdtempSync(join(tmpdir(), 'shliff-underlay-'));
    process.env.STORAGE_DRIVER = 'local';
    process.env.LOCAL_STORAGE_DIR = storageDir;
    const [season] = await dbRef.current.insert(seasons).values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    planId = await createPlan(dbRef.current, season.id, { widthCm: 2600, depthCm: 2400, gridCm: 50 }, 'lead@shliff.camp');
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('refuses a request without an admin session with 401, and stores nothing', async () => {
    adminRef.current = { ok: false };
    const response = await upload(planId, 'sketch.png', png(1600, 1200));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(readdirSync(storageDir)).toEqual([]);
  });

  it('answers 404 for a map that is not there, or a plan id that is not one', async () => {
    for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-plan', '..']) {
      const response = await upload(id, 'sketch.png', png(1600, 1200));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'unknown plan' });
    }
    expect(readdirSync(storageDir)).toEqual([]);
  });

  it('answers 400 when no file came, or the body is not a form at all', async () => {
    const none = await send(planId, null);
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: 'missing file' });
    const text = await POST(
      new Request(`http://localhost/site/underlay/${planId}`, { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } }),
      { params: Promise.resolve({ planId }) },
    );
    expect(text.status).toBe(400);
    expect(await text.json()).toEqual({ error: 'missing file' });
  });

  it('takes exactly 4 MB and refuses one byte more with 413', async () => {
    expect((await upload(planId, 'big.png', png(1600, 1200, MAX_UNDERLAY_BYTES))).status).toBe(201);
    const over = await upload(planId, 'bigger.png', png(1600, 1200, MAX_UNDERLAY_BYTES + 1));
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: 'file too large' });
  });

  /** The form as a browser sends it: serialized, with the Content-Length it states. */
  async function stated(planId: string, name: string, data: Uint8Array): Promise<Request> {
    const form = new FormData();
    form.set('file', new File([new Uint8Array(data)], name));
    const draft = new Request(`http://localhost/site/underlay/${planId}`, { method: 'POST', body: form });
    const body = new Uint8Array(await draft.arrayBuffer());
    return new Request(`http://localhost/site/underlay/${planId}`, {
      method: 'POST', body,
      headers: { 'content-type': draft.headers.get('content-type') ?? '', 'content-length': String(body.byteLength) },
    });
  }

  it('refuses a body whose Content-Length is over the limit with 413, without reading it (review U1)', async () => {
    const request = new Request(`http://localhost/site/underlay/${planId}`, {
      method: 'POST', body: 'x',
      headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(MAX_UNDERLAY_REQUEST_BYTES + 1) },
    });
    const read = vi.spyOn(request, 'formData');
    const response = await POST(request, { params: Promise.resolve({ planId }) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'file too large' });
    expect(read).not.toHaveBeenCalled();
    expect(readdirSync(storageDir)).toEqual([]);
  });

  it('still takes exactly 4 MB sent as a browser sends it, Content-Length and all', async () => {
    const request = await stated(planId, 'big.png', png(1600, 1200, MAX_UNDERLAY_BYTES));
    expect(Number(request.headers.get('content-length'))).toBeGreaterThan(MAX_UNDERLAY_BYTES);
    const response = await POST(request, { params: Promise.resolve({ planId }) });
    expect(response.status).toBe(201);
  });

  it('asks who is signed in, and for which map, before it reads the Content-Length', async () => {
    adminRef.current = { ok: false };
    const request = new Request(`http://localhost/site/underlay/${planId}`, {
      method: 'POST', body: 'x', headers: { 'content-length': String(MAX_UNDERLAY_REQUEST_BYTES + 1) },
    });
    expect((await POST(request, { params: Promise.resolve({ planId }) })).status).toBe(401);
  });

  it('refuses a PDF, an iPhone photo and anything else with 415, each with its own code', async () => {
    for (const [name, data, code] of [
      ['plan.pdf', PDF, 'pdf'],
      ['IMG_0001.HEIC', HEIC, 'heic'],
      ['anim.gif', GIF, 'unsupported file type'],
      ['sketch.jpg', png(400, 300), 'unsupported file type'],
    ] as const) {
      const response = await upload(planId, name, data);
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: code });
    }
    expect(readdirSync(storageDir)).toEqual([]);
  });

  it('refuses a file name over 200 characters with 422, and stores nothing (review U1)', async () => {
    const response = await upload(planId, `${'א'.repeat(197)}.png`, png(1600, 1200));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'file name too long' });
    expect(readdirSync(storageDir)).toEqual([]);
  });

  it('refuses under 100 or over 8192 pixels a side with 422', async () => {
    const small = await upload(planId, 'a.png', png(99, 300));
    expect(small.status).toBe(422);
    expect(await small.json()).toEqual({ error: 'image too small' });
    const large = await upload(planId, 'a.png', png(9000, 300));
    expect(large.status).toBe(422);
    expect(await large.json()).toEqual({ error: 'image too large' });
  });

  it('stores the picture under its map and its own hash, answers what the editor saves, and writes nothing to the database', async () => {
    const data = png(1600, 1200);
    const response = await upload(planId, ' שרטוט.png ', data);
    expect(response.status).toBe(201);
    const body = await response.json();
    const sha = sha256Hex(Buffer.from(data));
    expect(body).toEqual({
      storageKey: `site-underlays/${planId}/${sha}.png`, contentType: 'image/png', sizeBytes: data.byteLength, filename: 'שרטוט.png',
    });
    expect(readFileSync(join(storageDir, body.storageKey as string))).toEqual(Buffer.from(data));
    // Where it lies is the editor's op to save, against the map's version (spec §17).
    expect(await dbRef.current!.select().from(siteUnderlays)).toEqual([]);
    expect((await planById(dbRef.current!, planId))?.version).toBe(0);
  });

  it('answers the same key for the same bytes, however often they come', async () => {
    const data = png(1600, 1200);
    const first = await (await upload(planId, 'a.png', data)).json();
    const second = await upload(planId, 'b.png', data);
    expect(second.status).toBe(201);
    expect((await second.json()).storageKey).toBe(first.storageKey);
  });

  it('answers 201 when storage refuses to overwrite a file it already holds (Review Focus #2)', async () => {
    // @vercel/blob 2.8's put() throws when the pathname exists (allowOverwrite defaults to false), and the key is the
    // content's hash, so the same picture uploaded again always meets its own earlier copy.
    const data = png(1600, 1200);
    const put = vi.fn(async () => { throw new Error('Vercel Blob: This blob already exists'); });
    const get = vi.fn(async () => Buffer.from(data));
    storageRef.current = { put, get };
    const response = await upload(planId, 'sketch.png', data);
    expect(response.status).toBe(201);
    const { storageKey } = await response.json();
    expect(get).toHaveBeenCalledWith(storageKey);

    // A write that failed for any other reason cannot read the file back: that is storage being down.
    storageRef.current = { put, get: vi.fn(async () => { throw new Error('blob store unreachable'); }) };
    const down = await upload(planId, 'sketch.png', data);
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: 'storage unavailable' });
  });

  it('answers a machine code, not an error page, when production has no storage driver', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STORAGE_DRIVER', '');
    const response = await upload(planId, 'sketch.png', png(1600, 1200));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'storage unavailable' });
  });

  it('takes every limit from the shared modules, and declares none of its own', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/(admin)/site/underlay/[planId]/route.ts'), 'utf8');
    expect(source).toContain("from '@/lib/site/underlay-limits'");
    expect(source).toContain("from '@/lib/site/underlay-file'");
    expect(source).not.toMatch(/const [A-Z_]*(BYTES|PX|MB)\s*=/);
  });
});
