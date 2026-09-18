import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { uploads } from '@/db/schema/source';
import { getStorage, sha256Hex } from '@/lib/storage';
import { runImport } from '@/lib/import/run-import';
import { requireAdmin } from '@/lib/auth/guard';
import { MAX_UPLOAD_BYTES, UPLOAD_EXTENSION } from '@/lib/import/upload-limits';

/** Every .xlsx is a zip container, and every zip starts with a local file header. */
const ZIP_LOCAL_FILE_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Server-side file-type check. The form's `accept=".xlsx"` is a hint to the
 * file picker and nothing more — it is trivially bypassed, and this endpoint
 * exists precisely to receive the messy files people actually have. Both the
 * name and the bytes must agree, so neither a CSV renamed to `.xlsx` nor a
 * workbook renamed to `.csv` gets as far as the parser.
 */
function looksLikeXlsx(filename: string, buffer: Buffer): boolean {
  if (!filename.toLowerCase().endsWith(UPLOAD_EXTENSION)) return false;
  return buffer.subarray(0, ZIP_LOCAL_FILE_HEADER.length).equals(ZIP_LOCAL_FILE_HEADER);
}

/**
 * The `error` values are stable machine codes, not user-facing copy — the
 * upload form maps them to Hebrew. Nothing here may throw: an unhandled throw
 * escapes as an HTML error page, and the client's `response.json()` then throws
 * too, leaving the submit button disabled forever with nothing on screen.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing file' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'file too large' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!looksLikeXlsx(file.name, buffer)) {
    return NextResponse.json({ error: 'unsupported file type' }, { status: 415 });
  }

  const sha256 = sha256Hex(buffer);

  /**
   * Deduplicate on content, but only against a workbook that actually parsed.
   * Skipping on the hash alone made a failed import unrecoverable: re-uploading
   * the same file answered `duplicate: true` and sent the admin back to a
   * review page that would say "no tables found" forever, with no retry path.
   * A row left in `pending` or `failed` is reused instead — `uploads.sha256` is
   * unique, so it cannot be inserted twice. This matches `seed.ts`.
   */
  const existing = await db.select().from(uploads).where(eq(uploads.sha256, sha256));
  const parsed = existing.find((row) => row.status === 'parsed');
  if (parsed) {
    return NextResponse.json({ uploadId: parsed.id, duplicate: true }, { status: 200 });
  }

  let uploadId: string;
  if (existing.length > 0) {
    /* The bytes were written to storage before that row was ever inserted. */
    uploadId = existing[0].id;
  } else {
    const storageKey = `uploads/${sha256}.xlsx`;
    await getStorage().put(storageKey, buffer);

    const [row] = await db.insert(uploads).values({
      filename: file.name,
      sha256,
      storageKey,
      sizeBytes: buffer.byteLength,
      uploadedBy: admin.email,
    }).returning();
    uploadId = row.id;
  }

  try {
    const report = await runImport(db, uploadId, buffer);
    return NextResponse.json({ uploadId, report }, { status: 201 });
  } catch {
    /**
     * A corrupt or merely surprising workbook is a normal outcome here, not a
     * server fault. `runImport` has already rolled back its inserts and
     * recorded the reason on the upload row, so the failure is durable and the
     * next upload of the same file retries it.
     */
    return NextResponse.json({ uploadId, error: 'import failed' }, { status: 422 });
  }
}
