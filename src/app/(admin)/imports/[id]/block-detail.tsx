/**
 * The open block, beside the rail.
 *
 * TEMPORARY: Task 15 replaces this with the full detail pane — the archetype
 * picker, the column table, the raw grid and the promote bar. Until then it
 * renders what it can honestly answer from what the page already computed: the
 * block's identity, where it sits in the workbook, and what the one dry run
 * this page runs says would happen to it.
 */
import type { BlockStateRow } from '@/lib/import/register';
import type { PromotionResult } from '@/lib/import/promote/types';
import { summarise } from '@/lib/import/review';
import { ARCHETYPE_LABELS } from '../labels';
import styles from './import-review.module.css';

export function BlockDetail(
  { block, preview }: { block: BlockStateRow; preview: PromotionResult },
) {
  const counts = summarise([preview]);

  return (
    <div className={styles.detail}>
      <header className={styles.detailHead}>
        <h2 className={styles.detailTitle}>{ARCHETYPE_LABELS[block.archetype]}</h2>
        {/* R11 / W3: the sheet's own name for the range, as a trace renders it. */}
        <span className={styles.source}>
          <bdi>{block.sheetName}!{block.range}</bdi>
        </span>
      </header>
      <p className={styles.muted}>
        <bdi>ייכתבו {counts.written} שורות</bdi>
        {' · '}
        <bdi>{counts.refused} יידחו עם סיבה</bdi>
      </p>
    </div>
  );
}
