import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getStorage, sha256Hex } from '@/lib/storage';

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
