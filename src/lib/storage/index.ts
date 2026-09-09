import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export interface Storage {
  put(key: string, data: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Local-disk driver for development and tests. Uploaded workbooks contain
 * personal financial data, so the directory must never be served publicly.
 */
function localStorage(): Storage {
  const root = resolve(process.env.LOCAL_STORAGE_DIR ?? './.uploads');

  const safePath = (key: string): string => {
    const full = resolve(join(root, key));
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error(`storage key escapes the storage directory: ${key}`);
    }
    return full;
  };

  return {
    async put(key, data) {
      const path = safePath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
      return key;
    },
    async get(key) {
      return readFile(safePath(key));
    },
  };
}

/**
 * Vercel Blob driver. `access: 'private'` is required — these files must never
 * be publicly readable.
 */
function blobStorage(): Storage {
  return {
    async put(key, data) {
      const { put } = await import('@vercel/blob');
      const result = await put(key, data, { access: 'private' });
      return result.url;
    },
    async get(key) {
      const { head } = await import('@vercel/blob');
      const meta = await head(key);
      const response = await fetch(meta.url);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

export function getStorage(): Storage {
  return process.env.STORAGE_DRIVER === 'blob' ? blobStorage() : localStorage();
}
