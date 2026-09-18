/**
 * The rail: every sheet of the file, and under each one the tables detected
 * in it.
 *
 * A Server Component. Every entry is a `<Link>` carrying `?block=`, so the
 * rail ships no JavaScript of its own and every position in it is a URL a
 * lead can send to someone else (R6). The one client-side thing in it is the
 * sheet's own controls, which have to report a refusal.
 */
import Link from 'next/link';
import { Pill } from '@/components/ui/pill';
import type { BlockStateRow, SheetLabel } from '@/lib/import/register';
import { ARCHETYPE_LABELS, BLOCK_STATE_LABELS } from '../labels';
import { SheetLabelControls } from './sheet-label-controls';
import styles from './import-review.module.css';

export function BlockRail(
  { uploadId, sheets, blocks, openBlockId, seasons }: {
    uploadId: string;
    sheets: SheetLabel[];
    blocks: BlockStateRow[];
    openBlockId: string | null;
    seasons: Array<{ id: string; name: string }>;
  },
) {
  return (
    <nav className={styles.rail} aria-label="גיליונות וטבלאות">
      {sheets.map((sheet) => {
        const own = blocks.filter((b) => b.sheetId === sheet.sheetId);
        return (
          <section
            key={sheet.sheetId}
            className={styles.railGroup}
            role="group"
            aria-label={sheet.name}
          >
            <header className={styles.railHead}>
              <span className={styles.railSheetName}>{sheet.name}</span>
              <span className={styles.railDims}>
                <bdi>{sheet.rowCount}×{sheet.colCount}</bdi>
              </span>
              {/* W10: a season is never inferred, so its absence is a word. */}
              {sheet.seasonName
                ? <Pill>{sheet.seasonName}</Pill>
                : <Pill tone="warn">בלי שנה</Pill>}
            </header>

            <SheetLabelControls sheet={sheet} seasons={seasons} />

            <ul className={styles.railList}>
              {own.map((block) => {
                const label = BLOCK_STATE_LABELS[block.state];
                const open = block.blockId === openBlockId;
                return (
                  <li key={block.blockId}>
                    <Link
                      className={`${styles.railItem} ${open ? styles.railItemOpen : ''}`}
                      href={`/imports/${uploadId}?block=${block.blockId}`}
                      aria-current={open ? 'page' : undefined}
                    >
                      <span className={styles.railItemBody}>
                        <span className={styles.railItemName}>
                          {ARCHETYPE_LABELS[block.archetype]}
                        </span>
                        {/*
                          * A17: one isolate per phrase. The A1 range is an
                          * independent Latin run and keeps its own; the two
                          * counts are each a phrase of their own.
                          */}
                        <span className={styles.railItemMeta}>
                          <bdi>{block.range}</bdi>
                          {' · '}
                          <bdi>{block.rowCount} שורות</bdi>
                          {block.promotedRows > 0 ? (
                            <>
                              {' · '}
                              <bdi>{block.promotedRows} שורות נכתבו</bdi>
                            </>
                          ) : null}
                        </span>
                      </span>
                      <Pill tone={label.tone}>{label.text}</Pill>
                    </Link>
                    {/*
                      * `blocked` is the one state this screen cannot resolve
                      * from here: the decision belongs to the sheet's group
                      * across files, which is לטיפול's. Every figure links to
                      * the page that can change it.
                      */}
                    {block.state === 'blocked' ? (
                      <Link className={styles.railInbox} href="/inbox">
                        ההחלטה על הגיליון נמצאת בלטיפול
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
