import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getStorage, sha256Hex } from '@/lib/storage';

// `getStorage()` reaches `@vercel/blob` through a dynamic `await import(...)`
// (see src/lib/storage/index.ts) so that the local-only dev environment never
// needs the package installed. `vi.mock` intercepts dynamic imports the same
// way it intercepts static ones. The mock functions are built with
// `vi.hoisted` because `vi.mock`'s factory runs before this file's top-level
// `const`s are initialised — referencing a plain top-level `const` here would
// throw a hoisting `ReferenceError`.
const blob = vi.hoisted(() => ({
  put: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@vercel/blob', () => blob);

describe('local storage driver', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shliff-'));
    process.env.STORAGE_DRIVER = 'local';
    process.env.LOCAL_STORAGE_DIR = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a buffer', async () => {
    const storage = getStorage();
    const payload = Buffer.from('קופת קאמפ', 'utf8');
    await storage.put('uploads/test.xlsx', payload);
    expect(await storage.get('uploads/test.xlsx')).toEqual(payload);
  });

  it('rejects keys that escape the storage directory', async () => {
    const storage = getStorage();
    await expect(storage.put('../escape.xlsx', Buffer.from('x'))).rejects.toThrow();
  });
});

describe('sha256Hex', () => {
  it('produces a stable 64-character hex digest', () => {
    const digest = sha256Hex(Buffer.from('abc'));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(Buffer.from('abc'))).toBe(digest);
  });

  it('differs for different content', () => {
    expect(sha256Hex(Buffer.from('a'))).not.toBe(sha256Hex(Buffer.from('b')));
  });
});

describe('blob storage driver', () => {
  beforeEach(() => {
    process.env.STORAGE_DRIVER = 'blob';
    blob.put.mockReset();
    blob.get.mockReset();
  });

  afterEach(() => {
    delete process.env.STORAGE_DRIVER;
  });

  it('writes with access: private — uploaded workbooks must never be publicly readable', async () => {
    blob.put.mockResolvedValue({ url: 'https://example.blob.vercel-storage.com/uploads/test.xlsx' });
    const storage = getStorage();
    const payload = Buffer.from('קופת קאמפ', 'utf8');

    await storage.put('uploads/test.xlsx', payload);

    expect(blob.put).toHaveBeenCalledWith(
      'uploads/test.xlsx',
      payload,
      expect.objectContaining({ access: 'private' }),
    );
  });

  it('reads a private blob through the authenticated get() API, not a bare fetch of its url', async () => {
    const payload = Buffer.from('סוד קאמפ', 'utf8');
    blob.get.mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(payload);
          controller.close();
        },
      }),
    });
    const storage = getStorage();

    const result = await storage.get('uploads/test.xlsx');

    expect(blob.get).toHaveBeenCalledWith(
      'uploads/test.xlsx',
      expect.objectContaining({ access: 'private' }),
    );
    expect(result).toEqual(payload);
  });

  it('throws with the key and status when the blob cannot be read', async () => {
    blob.get.mockResolvedValue(null);
    const storage = getStorage();

    await expect(storage.get('missing/key.xlsx')).rejects.toThrow(/missing\/key\.xlsx/);
    await expect(storage.get('missing/key.xlsx')).rejects.toThrow(/404/);
  });

  it('throws with the key and status when get() reports a non-200 status', async () => {
    blob.get.mockResolvedValue({ statusCode: 304, stream: null });
    const storage = getStorage();

    await expect(storage.get('cached/key.xlsx')).rejects.toThrow(/cached\/key\.xlsx/);
    await expect(storage.get('cached/key.xlsx')).rejects.toThrow(/304/);
  });
});
