import type { ReactElement } from 'react';
import Link from 'next/link';
import type { PromotionPreview } from '@/lib/inbox/promotion';
import { ARCHETYPE_LABELS } from '../imports/labels';
import styles from './inbox.module.css';

/**
 * What a promotion would write — rendered, never offered.
 *
 * **This is what stands where the plan's promote-everything button was.**
 * Integration A23, confirmed by the camp lead, forbids the register offering
 * promotion in bulk: the promoter replaces a block's rows by deleting them
 * first, except the ones something else references, which are retained. A
 * plain repeated press is safe — the run's own produced rows are skipped by
 * the sweep and the upsert refreshes them in place. The damage needs the
 * produced set to stop matching what is stored, which is what a re-detection
 * or a re-import shifting a `source_row` does: the retained old rows then
 * stay and the new ones land beside them, and ברן 26's budget is counted
 * twice. **The register cannot know whether a file was re-imported**, so it
 * cannot know which press is the safe one, and A23 stands on that rather than
 * on the press itself being dangerous.
 *
 * Promotion of one table lives on the review screen, which renders that
 * block's `deleted` and `retained` before anything is written — so a lead
 * consents to a known outcome. This panel links there and stops.
 */
export function PromotionPreviewPanel(
  { preview }: { preview: PromotionPreview },
): ReactElement {
  const parked: Array<{ key: string; label: string; count: number }> = [
    { key: 'promoted', label: 'כבר קודמו', count: preview.alreadyPromoted },
    { key: 'review', label: 'ממתינות לסקירה', count: preview.awaitingReview },
    { key: 'sheet', label: 'ממתינות להכרעה על הגיליון', count: preview.heldBySheet },
    { key: 'none', label: 'אין להן מנגנון קידום', count: preview.noPromoter },
  ].filter((entry) => entry.count > 0);

  return (
    <section className={styles.preview} aria-labelledby="promotion-preview-title">
      <h2 className={styles.previewTitle} id="promotion-preview-title">
        מה קידום היה כותב
      </h2>

      {preview.readyCount === 0 ? (
        <p className={styles.muted}>אין טבלה שממתינה לקידום.</p>
      ) : (
        <>
          <ul className={styles.previewList}>
            {preview.ready.map((block) => (
              <li key={block.blockId}>
                <Link href={block.href}>
                  <bdi>{block.sheetName} · {block.range}</bdi>
                </Link>
                {' '}
                <span className={styles.muted}>{ARCHETYPE_LABELS[block.archetype]}</span>
              </li>
            ))}
          </ul>
          <p className={styles.muted}>
            קידום נעשה טבלה אחת בכל פעם, במסך הקובץ — שם רואים מראש אילו שורות
            ייכתבו, אילו יוסרו ואילו יישארו כי משהו אחר מסתמך עליהן.
          </p>
        </>
      )}

      {parked.length === 0 ? null : (
        <ul className={styles.previewParked}>
          {parked.map((entry) => (
            <li key={entry.key}>
              {/* A17: one isolate per phrase, so a test can read the sentence. */}
              <bdi>{entry.label}: {entry.count}</bdi>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
