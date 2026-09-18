import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { findUpload } from '@/lib/import/uploads';
import { blockStates, sheetLabels, blockGrid } from '@/lib/import/register';
import { listSeasons } from '@/lib/members/roster';
import { formatDateShort } from '@/lib/dates';
import { promoteBlock } from '@/lib/import/promote/promote';
import {
  reviewStep, gridRows, columnRows, blockRefusal, summarise, mappingKey,
  nextUnreviewed,
} from '@/lib/import/review';
import { Banner } from '@/components/ui/banner';
import { Stepper } from './stepper';
import { BlockRail } from './block-rail';
import { BlockDetail } from './block-detail';
import { PromoteUploadButton } from './promote-upload-button';
import { RawGrid, type RowFilter } from './raw-grid';
import styles from './import-review.module.css';

const ROW_FILTERS: readonly RowFilter[] = ['all', 'written', 'refused'];

function rowFilter(value: string | undefined): RowFilter {
  return ROW_FILTERS.includes(value as RowFilter) ? (value as RowFilter) : 'all';
}

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
  const [preview, rawGrid] = openBlock
    ? await Promise.all([
      promoteBlock(db, openBlock.blockId, { dryRun: true, recordedBy: admin.email }),
      blockGrid(db, openBlock.blockId),
    ])
    : [null, null];

  const confirmed = blocks.filter((b) => b.confirmedAt !== null).length;
  /**
   * A23: a control scoped to this file's blocks, never the database.
   *
   * The count is of every block `promoteUpload` will touch — `confirmed` and
   * `promoted` both, because W4/W5 make a re-run the way a lead fixes a column
   * map. Counting only the unwritten ones would name one table and rewrite
   * four; on the camp's first workbook that is exactly 1 against 4 today, and
   * a button that understates what it touches is the same lie as one that
   * promises a count it cannot keep.
   */
  const alreadyPromoted = blocks.filter((b) => b.state === 'promoted').length;
  const readyToPromote = blocks.filter(
    (b) => b.state === 'confirmed' || b.state === 'promoted',
  ).length;

  /**
   * Everything the detail pane needs that does not depend on a draft is built
   * here, on the server. `columnRows` runs against the STORED map and the
   * draft overlays it in the browser — the headers and the samples do not move
   * when a lead retargets a column, so recomputing them client-side would mean
   * shipping the whole grid to do it.
   */
  const at = openBlock ? blocks.findIndex((b) => b.blockId === openBlock.blockId) : -1;
  const shape = openBlock && rawGrid
    ? {
      top: openBlock.top,
      left: openBlock.left,
      right: openBlock.right,
      headerRow: openBlock.headerRow,
      rawGrid,
    }
    : null;

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
        <div className={styles.headActions}>
          {readyToPromote > 0
            ? (
              <PromoteUploadButton
                uploadId={id}
                confirmedCount={readyToPromote}
                alreadyPromoted={alreadyPromoted}
              />
            )
            : null}
          <Link className={styles.secondary} href="/imports">כל הקבצים</Link>
        </div>
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
          {/*
            * `key` is the mapping the server holds. When `applyConfirmation`
            * recomputes a map for a new archetype, this key changes, the pane
            * remounts and any draft goes with it — so the UI re-reads rather
            * than re-sending a map that no longer describes anything. A local
            * edit does not change props, so it does not remount.
            *
            * The grid is handed down as a rendered node, not imported by the
            * pane: a client module that imports `RawGrid` drags it across the
            * boundary and a 59-row table becomes client JavaScript.
            */}
          {openBlock && preview && shape ? (
            <BlockDetail
              key={mappingKey(openBlock.archetype, openBlock.columnMap)}
              uploadId={id}
              block={openBlock}
              columns={columnRows(shape, openBlock.columnMap)}
              preflight={summarise([preview])}
              refusal={blockRefusal(preview)}
              grid={(
                <RawGrid
                  uploadId={id}
                  blockId={openBlock.blockId}
                  left={openBlock.left}
                  rows={gridRows(shape, preview)}
                  filter={rowFilter(one(search.rows))}
                />
              )}
              position={at + 1}
              total={blocks.length}
              prevId={blocks[at - 1]?.blockId ?? null}
              nextId={blocks[at + 1]?.blockId ?? null}
              skipBlockId={nextUnreviewed(blocks, openBlock.blockId)}
              confirmedBy={openBlock.confirmedBy}
              confirmedOn={openBlock.confirmedAt === null
                ? null
                : formatDateShort(openBlock.confirmedAt)}
            />
          ) : null}
        </div>
      )}
    </main>
  );
}
