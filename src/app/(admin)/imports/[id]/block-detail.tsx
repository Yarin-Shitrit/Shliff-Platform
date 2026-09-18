'use client';

/**
 * The open block: what it is, what its columns become, the grid as it stands,
 * and the one button that writes it.
 *
 * A client component, and the only stateful one in the review: it holds the
 * draft column map and the draft budget category between a lead's edits and
 * the button that saves them. Everything that does not need a draft arrives as
 * props already computed on the server — the pre-flight counts, the whole-block
 * refusal, and the grid itself.
 *
 * The grid arrives as a rendered node rather than as an import, and that is
 * deliberate. A client module that imports `RawGrid` drags it across the
 * boundary and a 59-row table becomes client JavaScript; handed down as a prop
 * it stays server-rendered, which is the whole point of putting its filter in
 * the URL.
 *
 * The draft never outlives the mapping it describes: the page keys this
 * component on `mappingKey(archetype, columnMap)`, so a server-side recompute
 * for a new archetype remounts it and the stale draft goes with it. That is the
 * mechanism behind "re-read rather than re-send" — the draft cannot survive,
 * because its component cannot.
 */
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { BlockStateRow } from '@/lib/import/register';
import type { ColumnRow, PromotionSummary } from '@/lib/import/review';
import { mappingKey } from '@/lib/import/review';
import type { Refusal, RefusalReason } from '@/lib/import/promote/types';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BudgetCategory } from '@/db/schema/money';
import { Banner } from '@/components/ui/banner';
import { Pill } from '@/components/ui/pill';
import { ARCHETYPE_LABELS } from '../labels';
import { ArchetypePicker } from './archetype-picker';
import { BudgetCategoryPicker } from './budget-category-picker';
import { ColumnMapTable } from './column-map-table';
import { PromoteBar } from './promote-bar';
import styles from './import-review.module.css';

/** Whole-block refusals that pressing אישור וקידום resolves: it confirms the
 *  block and replaces its column map, in that order. */
const CLEARED_BY_CONFIRMING: readonly RefusalReason[] = ['unconfirmed', 'unmapped-column'];

export function BlockDetail(
  {
    uploadId, block, columns, preflight, refusal, grid,
    position, total, prevId, nextId, skipBlockId, confirmedBy, confirmedOn,
  }: {
    uploadId: string;
    block: BlockStateRow;
    /** Built server-side from the STORED map; the draft overlays it. */
    columns: ColumnRow[];
    preflight: PromotionSummary;
    /** A refusal about the whole block, filed at its own top row. */
    refusal: Refusal | null;
    /** `<RawGrid>`, already rendered on the server. */
    grid: ReactNode;
    position: number;
    total: number;
    prevId: string | null;
    nextId: string | null;
    /** The next block still wanting a human, for דילוג. */
    skipBlockId: string | null;
    confirmedBy: string | null;
    /**
     * Already formatted, on the server. No `Date` reaches this tree: a
     * locale-sensitive formatter rendered one way on the server and another in
     * the browser that hydrated it, which is the defect the card this pane
     * replaces carried its own UTC formatter to avoid.
     */
    confirmedOn: string | null;
  },
) {
  const [draft, setDraft] = useState<ColumnMapping[]>(block.columnMap);
  const [category, setCategory] = useState<BudgetCategory | null>(block.budgetCategory);

  /**
   * Compared through `mappingKey`, which sorts and drops confidence, so a
   * re-ordered but identical map does not read as an edit. Only the column map
   * is compared: the budget category changes which budget the rows belong to,
   * not how many there are, so the counts still describe what would be written.
   */
  const dirty = mappingKey(block.archetype, draft)
    !== mappingKey(block.archetype, block.columnMap);

  /**
   * The button confirms before it promotes, so a whole-block refusal that this
   * very press clears makes the dry run's counts describe a world the press
   * ends — `promoteBlock` refuses an unconfirmed block before it looks at a
   * single row, so those counts are all zero on exactly the blocks a lead
   * comes here to review. Every other whole-block refusal survives the press,
   * and its zeros are true.
   */
  const countable = refusal === null
    || !CLEARED_BY_CONFIRMING.includes(refusal.reason);

  return (
    <div className={styles.detail}>
      <header className={styles.detailHead}>
        <h2 className={styles.detailTitle}>{ARCHETYPE_LABELS[block.archetype]}</h2>
        <span className={styles.source}>
          <bdi>{block.sheetName}!{block.range}</bdi>
        </span>
        {block.mappingSource === 'signature'
          ? <Pill tone="info">זוהה מפריסה מוכרת משנה שעברה</Pill>
          : null}
        <span className={styles.detailNav}>
          {/* A17: one isolate for the whole phrase, not one per number. */}
          <span className={styles.muted}><bdi>{position} מתוך {total}</bdi></span>
          {prevId
            ? <Link href={`/imports/${uploadId}?block=${prevId}`}>הטבלה הקודמת</Link>
            : null}
          {nextId
            ? <Link href={`/imports/${uploadId}?block=${nextId}`}>הטבלה הבאה</Link>
            : null}
        </span>
      </header>

      {confirmedBy ? (
        <p className={styles.source}>
          {'אושר ע״י '}
          <bdi>{confirmedBy}</bdi>
          {confirmedOn ? <> · <bdi>{confirmedOn}</bdi></> : null}
        </p>
      ) : null}

      {refusal ? <Banner tone="warn" headline={refusal.message} /> : null}

      <ArchetypePicker
        blockId={block.blockId}
        archetype={block.archetype}
        confidence={block.confidence}
      />

      {/* The question only applies to a budget block; every other archetype
          stores null for it, so asking would be asking about nothing. */}
      {block.archetype === 'budget_lines' ? (
        <BudgetCategoryPicker
          blockId={block.blockId}
          value={category}
          onChange={setCategory}
        />
      ) : null}

      <ColumnMapTable
        blockId={block.blockId}
        archetype={block.archetype}
        rows={columns}
        draft={draft}
        onDraftChange={setDraft}
      />

      {grid}

      <PromoteBar
        uploadId={uploadId}
        blockId={block.blockId}
        archetype={block.archetype}
        preflight={preflight}
        draft={draft}
        budgetCategory={category}
        dirty={dirty}
        countable={countable}
        nextBlockId={skipBlockId}
      />
    </div>
  );
}
