import { desc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { uploads } from '@/db/schema/source';
import { blockStates, sheetLabels } from './register';

/** One file's own row: the filename, who brought it and what became of it. */
export interface UploadHeader {
  id: string;
  filename: string;
  uploadedBy: string;
  createdAt: Date;
  status: string;
  error: string | null;
}

/**
 * The review screen's header, and the reason `imports/[id]/page.tsx` spells no
 * query of its own. Every other admin page here reaches the database through a
 * library function; a page that reaches for `db.select` is a page that can only
 * be tested against a real database.
 *
 * Answers `null` rather than throwing, because "no such file" is a 404 the page
 * renders, not a failure.
 */
export async function findUpload(
  db: AnyDb, uploadId: string,
): Promise<UploadHeader | null> {
  const [row] = await db.select({
    id: uploads.id,
    filename: uploads.filename,
    uploadedBy: uploads.uploadedBy,
    createdAt: uploads.createdAt,
    status: uploads.status,
    error: uploads.error,
  }).from(uploads).where(eq(uploads.id, uploadId));
  return row ?? null;
}

export interface UploadRow {
  id: string;
  filename: string;
  uploadedBy: string;
  createdAt: Date;
  status: string;
  error: string | null;
  sheetCount: number;
  blockCount: number;
  confirmedCount: number;
  /** Rows now standing in the four money tables that carry this file's blocks. */
  promotedRows: number;
  /** Blocks needing review, plus sheets with no season, plus sheets whose
   *  authority is undecided or ambiguous. The same number לטיפול shows. */
  openDecisions: number;
  /** What "המשך סקירה" opens; null when nothing is left to review. */
  firstOpenBlockId: string | null;
}

export type StatusTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'brand';

/**
 * The word on the status pill, and never the raw `uploads.status` value.
 *
 * `status` can read `committed` without a single row having been written —
 * nothing in the running app sets it, only three test fixtures do — so the
 * promoted state is read off rows that exist. A file is "מוכן לקידום" when
 * every block is confirmed and "הוקדם" only once it has produced something.
 */
export function uploadStatusLabel(
  row: Pick<UploadRow, 'status' | 'blockCount' | 'confirmedCount' | 'promotedRows'>,
): { text: string; tone: StatusTone } {
  if (row.status === 'failed') return { text: 'נכשל', tone: 'bad' };
  if (row.status === 'pending') return { text: 'בעיבוד', tone: 'neutral' };
  if (row.blockCount === 0) return { text: 'לא נמצאו טבלאות', tone: 'warn' };
  if (row.promotedRows > 0 && row.confirmedCount === row.blockCount) {
    return { text: 'הוקדם', tone: 'ok' };
  }
  if (row.confirmedCount === row.blockCount) {
    return { text: 'מוכן לקידום', tone: 'brand' };
  }
  return { text: `${row.blockCount - row.confirmedCount} לבדיקה`, tone: 'brand' };
}

/**
 * Composed from `blockStates` and `sheetLabels` rather than from its own
 * joins, so a file's row on the list and the same file's review can never
 * disagree about how many blocks are confirmed or how many decisions are
 * open. It costs one pass per upload; the camp has three files.
 */
export async function listUploads(db: AnyDb): Promise<UploadRow[]> {
  const rows = await db.select().from(uploads).orderBy(desc(uploads.createdAt));
  const out: UploadRow[] = [];

  for (const upload of rows) {
    const [labels, states] = await Promise.all([
      sheetLabels(db, upload.id),
      blockStates(db, upload.id),
    ]);

    const undecidedSheets = labels.filter(
      (s) => s.seasonId === null || s.state === 'undecided' || s.state === 'ambiguous',
    ).length;
    const open = states.filter(
      (b) => b.state === 'needs-review' || b.state === 'recognised',
    );

    out.push({
      id: upload.id,
      filename: upload.filename,
      uploadedBy: upload.uploadedBy,
      createdAt: upload.createdAt,
      status: upload.status,
      error: upload.error,
      sheetCount: labels.length,
      blockCount: states.length,
      confirmedCount: states.filter((b) => b.confirmedAt !== null).length,
      promotedRows: states.reduce((n, b) => n + b.promotedRows, 0),
      openDecisions: undecidedSheets
        + states.filter((b) => b.state === 'needs-review').length,
      firstOpenBlockId: open[0]?.blockId ?? null,
    });
  }

  return out;
}
