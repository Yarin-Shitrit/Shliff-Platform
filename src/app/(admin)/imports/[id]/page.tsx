import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Frank_Ruhl_Libre, Heebo } from 'next/font/google';
import { db } from '@/db';
import { uploads, sheets, blocks, blockMappings } from '@/db/schema/source';
import { CONFIDENCE_THRESHOLD } from '@/lib/classify/types';
import { requireAdmin } from '@/lib/auth/guard';
import { BlockCard } from './block-card';
import styles from './import-review.module.css';

const display = Frank_Ruhl_Libre({ subsets: ['hebrew', 'latin'], weight: ['500'], variable: '--font-display' });
const body = Heebo({ subsets: ['hebrew', 'latin'], weight: ['400', '500', '600'], variable: '--font-body' });

type BlockRow = typeof blocks.$inferSelect;
type MappingRow = typeof blockMappings.$inferSelect;

/**
 * A block still needs a human decision only if nothing has reviewed it yet.
 * Once a signature auto-recognized it, or an admin confirmed it, it is
 * resolved — even if, in the admin case, the column map it was confirmed
 * with is still empty (column-level correction is out of this screen's
 * scope, so an empty map is a known, accepted limit, not an open question).
 */
function needsReview(block: BlockRow, mapping: MappingRow | null): boolean {
  const source = mapping?.source ?? 'rules';
  const columnCount = mapping?.columnMap.length ?? 0;
  return source === 'rules' && (Number(block.confidence) < CONFIDENCE_THRESHOLD || columnCount === 0);
}

export default async function ImportReviewPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const { id } = await params;
  const [upload] = await db.select().from(uploads).where(eq(uploads.id, id));
  if (!upload) notFound();

  const rows = await db
    .select({ block: blocks, sheet: sheets, mapping: blockMappings })
    .from(blocks)
    .innerJoin(sheets, eq(blocks.sheetId, sheets.id))
    .leftJoin(blockMappings, eq(blockMappings.blockId, blocks.id))
    .where(eq(sheets.uploadId, id));

  rows.sort((a, b) => a.sheet.index - b.sheet.index || a.block.top - b.block.top);
  const reviewCount = rows.filter((r) => needsReview(r.block, r.mapping)).length;

  return (
    <div className={`${display.variable} ${body.variable} ${styles.shell}`}>
      <header className={styles.bar}>
        <span className={styles.brand}>
          <Image className={styles.mark} src="/logo-dark.png" alt="" width={64} height={64} priority />
          <span className={styles.wordmark}>קופת שליף</span>
        </span>
        <Link href="/upload" className={styles.back}>העלאה נוספת</Link>
      </header>

      <div className={styles.page}>
        <section className={styles.hero}>
          <h1 className={styles.title}>סקירת ייבוא — {upload.filename}</h1>
          <p className={styles.summary}>
            <strong>{rows.length}</strong> טבלאות זוהו · <strong>{reviewCount}</strong> דורשות בדיקה
          </p>
        </section>

        {rows.length === 0 ? (
          <p className={styles.empty}>לא נמצאו טבלאות בקובץ הזה.</p>
        ) : (
          <div className={styles.list}>
            {rows.map(({ block, sheet, mapping }) => (
              <BlockCard
                key={block.id}
                blockId={block.id}
                sheetName={sheet.name}
                top={block.top}
                left={block.left}
                bottom={block.bottom}
                right={block.right}
                archetype={block.archetype}
                confidence={Number(block.confidence)}
                mappingSource={mapping?.source ?? 'rules'}
                columnMap={mapping?.columnMap ?? []}
                rawGrid={block.rawGrid}
                needsReview={needsReview(block, mapping)}
                confirmedBy={block.confirmedBy}
                confirmedAt={block.confirmedAt}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
