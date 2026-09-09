import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, type TestDb } from '@/test/db';
import { uploads, sheets } from '@/db/schema/source';
import { sha256Hex } from '@/lib/storage';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';
import type { AdminCheck } from '@/lib/auth/guard';

/**
 * The route imports `@/db` and `@/lib/auth/guard` at module scope. `@/db`
 * throws at import time without `DATABASE_URL`, and the guard reaches NextAuth
 * and argon2 — so both are replaced before the route is imported.
 *
 * The database stand-in is a proxy rather than a fixed object: each test builds
 * its own PGlite instance in `beforeEach`, long after the module namespace has
 * been captured, so every property access has to resolve against whichever
 * instance is current.
 */
const { dbRef, adminRef, dbProxy } = vi.hoisted(() => {
  const dbRef: { current: TestDb | null } = { current: null };
  const adminRef: { current: AdminCheck } = {
    current: { ok: true, email: 'admin@example.com' },
  };
  const dbProxy = new Proxy({} as TestDb, {
    get(_target, property) {
      const db = dbRef.current;
      if (!db) throw new Error('test database not initialised');
      const value = Reflect.get(db, property) as unknown;
      return typeof value === 'function' ? value.bind(db) : value;
    },
  });
  return { dbRef, adminRef, dbProxy };
});

vi.mock('@/db', () => ({ db: dbProxy }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => adminRef.current }));

import { POST } from '@/app/api/uploads/route';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function postFile(filename: string, buffer: Buffer, type = XLSX_TYPE): Request {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(buffer)], filename, { type }));
  return new Request('http://localhost/api/uploads', { method: 'POST', body: form });
}

function postNothing(): Request {
  return new Request('http://localhost/api/uploads', { method: 'POST', body: new FormData() });
}

/** Passes the zip magic-byte check, but is not a workbook. */
const CORRUPT_XLSX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('this is not a workbook'),
]);

describe('POST /api/uploads', () => {
  let storageDir: string;

  beforeEach(async () => {
    dbRef.current = await createTestDb();
    adminRef.current = { ok: true, email: 'admin@example.com' };
    storageDir = mkdtempSync(join(tmpdir(), 'shliff-route-'));
    process.env.STORAGE_DRIVER = 'local';
    process.env.LOCAL_STORAGE_DIR = storageDir;
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('refuses an unauthenticated request with 401 and writes nothing', async () => {
    adminRef.current = { ok: false };

    const response = await POST(postFile(FIXTURES.y26, fixtureBuffer(FIXTURES.y26)));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(await dbRef.current!.select().from(uploads)).toHaveLength(0);
  });

  it('rejects a request with no file', async () => {
    const response = await POST(postNothing());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('missing file');
  });

  /**
   * `accept=".xlsx"` on the form is a file-picker hint, not enforcement. Both
   * halves of the server-side check are exercised: a wrong name and wrong bytes.
   */
  it('rejects a CSV, whatever it is called', async () => {
    const csv = Buffer.from('date,amount\n2026-01-01,100\n');

    const byName = await POST(postFile('ledger.csv', csv, 'text/csv'));
    expect(byName.status).toBe(415);
    expect((await byName.json()).error).toBe('unsupported file type');

    const byBytes = await POST(postFile('ledger.xlsx', csv));
    expect(byBytes.status).toBe(415);
    expect((await byBytes.json()).error).toBe('unsupported file type');

    expect(await dbRef.current!.select().from(uploads)).toHaveLength(0);
  });

  it('imports a real workbook and reports what it found', async () => {
    const buffer = fixtureBuffer(FIXTURES.y26);
    const response = await POST(postFile(FIXTURES.y26, buffer));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.report.blockCount).toBeGreaterThan(0);

    const [row] = await dbRef.current!.select().from(uploads);
    expect(row.id).toBe(body.uploadId);
    expect(row.status).toBe('parsed');
    expect(row.uploadedBy).toBe('admin@example.com');
  });

  it('answers duplicate for a workbook that already parsed', async () => {
    const buffer = fixtureBuffer(FIXTURES.y26);
    const first = await POST(postFile(FIXTURES.y26, buffer));
    const firstBody = await first.json();

    const second = await POST(postFile('renamed.xlsx', buffer));

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ uploadId: firstBody.uploadId, duplicate: true });
    expect(await dbRef.current!.select().from(uploads)).toHaveLength(1);
  });

  /**
   * The retry path. Deduplicating on the hash alone left a failed import with
   * no way forward: the same file came back `duplicate: true` and pushed the
   * admin to a review page showing no tables, permanently.
   */
  it('retries a previously failed workbook instead of reporting it as a duplicate', async () => {
    const buffer = fixtureBuffer(FIXTURES.y26);
    const sha256 = sha256Hex(buffer);
    const [failed] = await dbRef.current!.insert(uploads).values({
      filename: FIXTURES.y26,
      sha256,
      storageKey: `uploads/${sha256}.xlsx`,
      sizeBytes: buffer.byteLength,
      uploadedBy: 'admin@example.com',
      status: 'failed',
      error: 'boom',
    }).returning();

    const response = await POST(postFile(FIXTURES.y26, buffer));

    expect(response.status).toBe(201);
    expect((await response.json()).uploadId).toBe(failed.id);

    const rows = await dbRef.current!.select().from(uploads).where(eq(uploads.sha256, sha256));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('parsed');
    expect(await dbRef.current!.select().from(sheets)).not.toHaveLength(0);
  });

  /**
   * A workbook the parser cannot read must come back as JSON with a status, not
   * as an unhandled throw: the client reads `response.json()`, and an HTML
   * error page there used to leave the submit button disabled forever.
   */
  it('answers JSON when the workbook cannot be parsed, and leaves it retryable', async () => {
    const response = await POST(postFile('broken.xlsx', CORRUPT_XLSX));

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe('import failed');

    const [row] = await dbRef.current!.select().from(uploads);
    expect(row.status).toBe('failed');
    expect(row.error).toBeTruthy();
    expect(await dbRef.current!.select().from(sheets)).toHaveLength(0);

    /* And the next attempt is a retry, not a duplicate. */
    const retry = await POST(postFile('broken.xlsx', CORRUPT_XLSX));
    expect(retry.status).toBe(422);
    expect((await retry.json()).uploadId).toBe(row.id);
    expect(await dbRef.current!.select().from(uploads)).toHaveLength(1);
  });
});
