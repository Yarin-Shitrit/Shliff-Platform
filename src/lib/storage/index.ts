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
      // `path` is computed from `LOCAL_STORAGE_DIR` (an env var) and the
      // caller's `key`, so Next's output-file tracer can't resolve it
      // statically — its own diagnostic for this ("Dynamic filesystem access
      // causes tracing of the whole project") names three fixes: scope the
      // path to a static subfolder, use it only in development, or opt out
      // with an ignore comment on the flagged call. This driver's dev/test
      // role already covers "development only"; the ignore comment silences
      // the diagnostic itself, which fires regardless of which driver
      // `getStorage()` picks at runtime, since both are defined in the same
      // traced module.
      await mkdir(/* turbopackIgnore: true */ dirname(path), { recursive: true });
      await writeFile(/* turbopackIgnore: true */ path, data);
      return key;
    },
    async get(key) {
      return readFile(/* turbopackIgnore: true */ safePath(key));
    },
  };
}

/**
 * Vercel Blob driver. `access: 'private'` is required — these files must never
 * be publicly readable.
 *
 * Reads go through `@vercel/blob`'s own `get()`, which attaches the read
 * token itself. The earlier version fetched `head(key)` and then did a bare,
 * unauthenticated `fetch(meta.url)` — for a private blob that URL 401s
 * without credentials, so it never actually worked.
 */
function blobStorage(): Storage {
  return {
    async put(key, data) {
      const { put } = await import('@vercel/blob');
      const result = await put(key, data, { access: 'private' });
      return result.url;
    },
    async get(key) {
      const { get } = await import('@vercel/blob');
      const result = await get(key, { access: 'private' });
      // Testing `result.statusCode` directly (not an aliased local) is what
      // lets TypeScript narrow `result` to the `statusCode: 200` member of
      // `GetBlobResult`'s discriminated union below, so `result.stream` is
      // known to be a `ReadableStream`, not `ReadableStream | null`.
      if (!result || result.statusCode !== 200) {
        throw new Error(`failed to read blob "${key}": status ${result?.statusCode ?? 404}`);
      }
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    },
  };
}

export function getStorage(): Storage {
  return process.env.STORAGE_DRIVER === 'blob' ? blobStorage() : localStorage();
}
