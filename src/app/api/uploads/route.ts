import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { uploads } from '@/db/schema/source';
import { getStorage, sha256Hex } from '@/lib/storage';
import { runImport } from '@/lib/import/run-import';
import { requireAdmin } from '@/lib/auth/guard';

const MAX_BYTES = 25 * 1024 * 1024;

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
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file too large' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = sha256Hex(buffer);

  const existing = await db.select().from(uploads).where(eq(uploads.sha256, sha256));
  if (existing.length > 0) {
    return NextResponse.json(
      { uploadId: existing[0].id, duplicate: true },
      { status: 200 },
    );
  }

  const storageKey = `uploads/${sha256}.xlsx`;
  await getStorage().put(storageKey, buffer);

  const [row] = await db.insert(uploads).values({
    filename: file.name,
    sha256,
    storageKey,
    sizeBytes: buffer.byteLength,
    uploadedBy: admin.email,
  }).returning();

  const report = await runImport(db, row.id, buffer);
  return NextResponse.json({ uploadId: row.id, report }, { status: 201 });
}
