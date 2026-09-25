import { NextResponse } from 'next/server';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { getStorage, sha256Hex } from '@/lib/storage';
import { planById } from '@/lib/site/plan';
import { checkUnderlayFile } from '@/lib/site/underlay-file';
import {
  MAX_UNDERLAY_BYTES, MAX_UNDERLAY_REQUEST_BYTES, isPlanId, underlayKey, type UnderlayUploadCode,
} from '@/lib/site/underlay-limits';

/**
 * `POST /site/underlay/<planId>`: stores a picture to trace over (spec §16).
 * It checks, in order: an admin, the map, a file, its size (first the size
 * the request declares, before its body is read), its type from both its
 * bytes and its name, and its size in pixels. It answers 201 with
 * what the editor saves, or a machine code the card turns into Hebrew
 * (`uploadRefusalHe`).
 *
 * Nothing here may throw. An unhandled throw leaves as an HTML error page,
 * the card's `response.json()` fails too, and the lead is left with nothing
 * on screen (the same contract as `/api/uploads`).
 *
 * The route writes nothing to the database. Where the picture lies is the
 * editor's `setUnderlay` op, saved in a batch against the map's version, so
 * two leads uploading at once meet the conflict banner, not an overwrite.
 *
 * Why a route and not a server action: server actions accept 1 MB bodies by
 * default (`serverActions.bodySizeLimit`), and raising that means editing the
 * shared `next.config.ts`.
 */

function refuse(code: UnderlayUploadCode, status: number): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

export async function POST(
  request: Request, context: { params: Promise<{ planId: string }> },
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return refuse('unauthorized', 401);

  // Lower case, as Postgres writes a uuid, so one map has one folder; and never a path that could climb out of it.
  const planId = (await context.params).planId.toLowerCase();
  if (!isPlanId(planId)) return refuse('unknown plan', 404);
  try {
    if ((await planById(db, planId)) === null) return refuse('unknown plan', 404);
  } catch {
    return refuse('storage unavailable', 503);
  }

  // A body that says it is too big is refused before a byte of it is read (review U1).
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_UNDERLAY_REQUEST_BYTES) return refuse('file too large', 413);

  let file: FormDataEntryValue | null = null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    file = null;
  }
  if (!(file instanceof File)) return refuse('missing file', 400);
  // Before reading it: a body this size is refused without holding it twice.
  if (file.size > MAX_UNDERLAY_BYTES) return refuse('file too large', 413);

  const bytes = Buffer.from(await file.arrayBuffer());
  const check = checkUnderlayFile(file.name, bytes);
  if (!check.ok) return refuse(check.code, check.status);

  const storageKey = underlayKey(planId, sha256Hex(bytes), check.ext);
  if (!(await store(storageKey, bytes))) return refuse('storage unavailable', 503);

  return NextResponse.json(
    { storageKey, contentType: check.contentType, sizeBytes: bytes.byteLength, filename: file.name.trim() },
    { status: 201 },
  );
}

/**
 * Writes the file, or finds it already there. The key is the file's own
 * hash, so the same bytes always land on the same key: a second upload, or
 * the old picture uploaded again after a replace (spec §16). The local driver
 * overwrites. Vercel Blob refuses to — `put` throws when the pathname exists
 * (`allowOverwrite` defaults to false in `@vercel/blob` 2.x), and
 * `src/lib/storage` is not changed here — so a refused write whose key reads
 * back is a file already stored, not a failure (Review Focus #2).
 *
 * `getStorage()` itself may throw, when production has no driver named; that
 * is caught here too, and is storage being unavailable.
 */
async function store(key: string, bytes: Buffer): Promise<boolean> {
  try {
    await getStorage().put(key, bytes);
    return true;
  } catch {
    try {
      await getStorage().get(key);
      return true;
    } catch {
      return false;
    }
  }
}
