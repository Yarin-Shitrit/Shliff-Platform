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
  // `LOCAL_STORAGE_DIR` is an env var, so Turbopack's output-file tracer
  // can't resolve this `resolve(...)` call's argument statically and flags
  // it: "Dynamic filesystem access causes tracing of the whole project." Its
  // own fix menu is: scope the path to a static subfolder, use it only in
  // development, or opt out with an ignore comment on the flagged call
  // itself — `path.join(/*turbopackIgnore: true*/ ...)`, right before the
  // call's first argument. This driver's dev/test-only role already covers
  // "development only"; `turbopackIgnore` silences the diagnostic at the
  // actual flagged call, not at whatever `fs.*` call later consumes its
  // result (which Turbopack never flags — only the `path.resolve`/`path.join`
  // calls that construct the unresolvable value are highlighted).
  const root = resolve(/* turbopackIgnore: true */ process.env.LOCAL_STORAGE_DIR ?? './.uploads');

  const safePath = (key: string): string => {
    // Same diagnostic, same fix, for the two calls that build the per-key
    // path: `key` is a runtime argument, so both the inner `join` and the
    // `resolve` wrapping it are flagged too.
    const full = resolve(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ root, key));
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

/**
 * The driver is chosen explicitly or not at all.
 *
 * This used to be `=== 'blob' ? blobStorage() : localStorage()`, which meant
 * every typo and every unset variable selected the *disk* driver. On Vercel
 * the disk is ephemeral, so the camp's fee workbook would upload, report
 * success, and vanish with the instance — the system guessing, and guessing
 * wrong, about real financial records.
 *
 * Outside production the fallback stays: dev and tests should need no setup.
 * The message is English because its only audience is whoever is holding a
 * deploy log. This branch *is* reachable on the live upload path — it is not
 * confined to a dev-only tool like `seed.ts`, which `actions.ts` already
 * refuses to run in production before ever calling here. `route.ts:73` calls
 * `getStorage()` unguarded, and it is that route's job — not this function's —
 * to catch the throw and turn it into a machine code the upload form maps to
 * Hebrew, so this English text stays in logs and never becomes user-facing
 * copy.
 */
export function getStorage(): Storage {
  const driver = process.env.STORAGE_DRIVER;
  if (driver === 'blob') return blobStorage();
  if (driver === 'local') return localStorage();

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `STORAGE_DRIVER must be "blob" or "local" in production; got ` +
        `${driver ? `"${driver}"` : 'no value'}. Uploads would otherwise be ` +
        `written to an ephemeral filesystem and silently lost.`,
    );
  }

  return localStorage();
}
