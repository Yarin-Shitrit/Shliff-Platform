import { desc, eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { uploads } from '@/db/schema/source';
import { blockStates, sheetLabels } from './register';
import { SEASON_REQUIRED_ARCHETYPES } from './promote/promote';

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
  /**
   * Tables that would refuse every row they hold because their sheet carries
   * no season — a budget or a ticket table on an unlabelled sheet (A36).
   *
   * A subset of `openDecisions`, kept apart from it because the two answer
   * different questions: `openDecisions` counts everything still waiting on a
   * human, at sheet granularity, while this counts only what stands between
   * the file and a promotion that writes something. A file can have an open
   * season decision on a sheet whose tables promote fine regardless, and that
   * file is genuinely ready.
   */
  seasonBlockedCount: number;
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
 *
 * A36: confirmation is a statement about tables, and a season is a statement
 * about sheets. Counting only the first and printing "מוכן לקידום" told a lead
 * that קופת קאמפ 23'-24' was ready while every budget and ticket row in it
 * would be refused `no-season` — 96 of the real data's 234 refusals. So the
 * season state is read too, and it is read from the sheets rather than assumed
 * from the table count.
 *
 * "ממתין לקביעת עונה" is deliberately not a failure: the camp lead has left
 * ברן 23/24 unlabelled on purpose, and those refusals are expected. The file
 * is not broken, it is waiting on a decision nobody has made — which is what
 * the platform requires of anything it cannot resolve: a visible decision
 * rather than a silent one. `warn` carries that; `bad` would claim a break.
 *
 * Precedence, for the two neighbours it was placed between:
 *
 * - It outranks "הוקדם". Promoting this file writes its ledger and its debts
 *   and refuses its budgets, and the pill flipping to "הוקדם" one click later
 *   would re-create exactly A36's harm — a terminal word over an untouched
 *   decision. This is `blockState`'s rule at the file level: the most
 *   actionable truth is the one on the pill.
 * - It does not outrank "N לבדיקה", because review comes first and that label
 *   is already an honest open decision. Replacing it would hide work that has
 *   to happen before the season matters at all.
 */
export function uploadStatusLabel(
  row: Pick<UploadRow,
  'status' | 'blockCount' | 'confirmedCount' | 'promotedRows' | 'seasonBlockedCount'>,
): { text: string; tone: StatusTone } {
  if (row.status === 'failed') return { text: 'נכשל', tone: 'bad' };
  if (row.status === 'pending') return { text: 'בעיבוד', tone: 'neutral' };
  if (row.blockCount === 0) return { text: 'לא נמצאו טבלאות', tone: 'warn' };
  if (row.confirmedCount < row.blockCount) {
    return { text: `${row.blockCount - row.confirmedCount} לבדיקה`, tone: 'brand' };
  }
  if (row.seasonBlockedCount > 0) {
    return { text: 'ממתין לקביעת עונה', tone: 'warn' };
  }
  if (row.promotedRows > 0) return { text: 'הוקדם', tone: 'ok' };
  return { text: 'מוכן לקידום', tone: 'brand' };
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
    // A36: the sheets that carry no season, and then the tables on them whose
    // promoter would refuse every row for want of one. Both halves are needed
    // — a season-less sheet holding only ledger tables blocks nothing.
    const seasonless = new Set(
      labels.filter((s) => s.seasonId === null).map((s) => s.sheetId),
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
      seasonBlockedCount: states.filter(
        (b) => seasonless.has(b.sheetId)
          && SEASON_REQUIRED_ARCHETYPES.includes(b.archetype),
      ).length,
      firstOpenBlockId: open[0]?.blockId ?? null,
    });
  }

  return out;
}
