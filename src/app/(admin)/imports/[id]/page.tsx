import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { findUpload } from '@/lib/import/uploads';
import { blockStates, sheetLabels } from '@/lib/import/register';
import { listSeasons } from '@/lib/members/roster';
import { promoteBlock } from '@/lib/import/promote/promote';
import { reviewStep } from '@/lib/import/review';
import { Banner } from '@/components/ui/banner';
import { Stepper } from './stepper';
import { BlockRail } from './block-rail';
import { BlockDetail } from './block-detail';
import styles from './import-review.module.css';

/** Next 16: both `params` and `searchParams` arrive as Promises, and a search
 *  param may repeat, so every value is `string | string[] | undefined`. */
type RawSearch = Record<string, string | string[] | undefined>;

/** The first value of a param a lead may have repeated in the URL. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The layout's title template appends `· קופת שליף`, so this is the bare name. */
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const upload = await findUpload(db, id);
  return { title: upload ? `סקירת ייבוא — ${upload.filename}` : 'סקירת ייבוא' };
}

const DUPLICATE_NOTE =
  'הקובץ הזה כבר הועלה — זו הסקירה הקיימת שלו, ולא נוצר עותק שני.';

export default async function ImportReviewPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<RawSearch>;
  },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const [{ id }, search] = await Promise.all([params, searchParams]);
  const upload = await findUpload(db, id);
  if (!upload) notFound();

  const [sheets, blocks, seasonRows] = await Promise.all([
    sheetLabels(db, id),
    blockStates(db, id),
    listSeasons(db),
  ]);

  /**
   * With no `?block=`, open the first block still wanting a human, and fall
   * back to the first block of the file. Arriving from the upload redirect,
   * from the file list, or from a bookmark all land somewhere useful — and
   * every one of those positions is a URL a lead can send on (R6).
   */
  const namedId = one(search.block);
  const openBlock = blocks.find((b) => b.blockId === namedId)
    ?? blocks.find((b) => b.state === 'needs-review' || b.state === 'recognised')
    ?? blocks[0]
    ?? null;

  /**
   * Exactly one dry run per render, for the block that is open. The rail's
   * states come from `blockStates`, which is queries only; the refusals and
   * the pre-flight counts are the one thing that genuinely needs the promoter
   * to be asked, and asking it for eleven blocks to render one would be
   * eleven transactions to show one answer.
   */
  const preview = openBlock
    ? await promoteBlock(db, openBlock.blockId, {
      dryRun: true, recordedBy: admin.email,
    })
    : null;

  const confirmed = blocks.filter((b) => b.confirmedAt !== null).length;

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>
            סקירת ייבוא — <bdi>{upload.filename}</bdi>
          </h1>
          {/* Three independent counts, so one isolate each (A17). */}
          <p className={styles.lead}>
            <bdi>{sheets.length} גיליונות</bdi>
            {' · '}
            <bdi>{blocks.length} טבלאות זוהו</bdi>
            {' · '}
            <bdi>{confirmed} אושרו</bdi>
          </p>
        </div>
        <Link className={styles.secondary} href="/imports">כל הקבצים</Link>
      </div>

      {one(search.duplicate) === '1'
        ? <Banner tone="info" headline={DUPLICATE_NOTE} />
        : null}

      <Stepper
        current={reviewStep(upload, blocks)}
        confirmed={confirmed}
        total={blocks.length}
      />

      {/*
        * Not the kit's `EmptyState`: none of its five kinds says "we read the
        * file and there was nothing in it". `nothing-yet` would promise that
        * tables will appear later, which is false — this workbook has been
        * parsed. A banner states the result and carries the one move that
        * helps, which keeps it an invitation rather than an apology.
        */}
      {blocks.length === 0 ? (
        <Banner
          tone="warn"
          headline="לא נמצאו טבלאות בקובץ הזה"
          detail="ייתכן שהגיליונות ריקים, או שהטבלאות פרוסות בצורה שהמערכת לא זיהתה."
          action={{ label: 'העלאת קובץ אחר', href: '/upload' }}
        />
      ) : (
        <div className={styles.split}>
          <BlockRail
            uploadId={id}
            sheets={sheets}
            blocks={blocks}
            openBlockId={openBlock?.blockId ?? null}
            seasons={seasonRows}
          />
          {openBlock && preview
            ? <BlockDetail block={openBlock} preview={preview} />
            : null}
        </div>
      )}
    </main>
  );
}
