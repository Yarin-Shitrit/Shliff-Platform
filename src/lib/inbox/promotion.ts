import type { AnyDb } from '@/lib/db-types';
import type { BlockArchetype } from '@/lib/classify/types';
import { blockStates } from '@/lib/import/register';

export interface PromotionReadyBlock {
  blockId: string;
  uploadId: string;
  sheetName: string;
  archetype: BlockArchetype;
  /** `A5:F20`. */
  range: string;
  /** The screen that can actually promote this block, and show what it keeps. */
  href: string;
}

export interface PromotionPreview {
  /** Blocks a promotion would write, in the state `promoteUpload` acts on. */
  ready: PromotionReadyBlock[];
  readyCount: number;
  /** Confirmed blocks that already own rows. A re-run does not touch them. */
  alreadyPromoted: number;
  /** Nobody has reviewed these yet. */
  awaitingReview: number;
  /** Their sheet is contested or superseded; the sheet decision comes first. */
  heldBySheet: number;
  /** Confirmed, but this archetype has no promoter. */
  noPromoter: number;
}

/**
 * What a promotion would do, for the register to **render** — never to run.
 *
 * Integration A23, confirmed by the camp lead, forbids לטיפול offering
 * promotion in bulk, and its remedy is this: the register may show what
 * promotion would do and must not offer to do it. So this function reads and
 * returns; nothing here writes, and nothing here calls a promoter.
 *
 * **It runs no dry run.** `worklist` would give a per-block `wouldWrite`, but
 * it obtains that by dry-running `promoteBlock` on every confirmed block, and
 * this is rendered in a page header on every visit. A number bought at that
 * price is the hazard this project was warned about wearing a different hat.
 * `blockStates` counts rows that exist, which is the honest half, and the
 * count of blocks is the other half — so the preview says *which tables*
 * would be written rather than claiming a row total it has not measured.
 *
 * `ready` is the `confirmed` set and nothing else, which is deliberately the
 * same set A34 rules the per-file promote may act on. A preview describing a
 * larger set than any button will touch is a promise nobody keeps.
 */
export async function promotionPreview(db: AnyDb): Promise<PromotionPreview> {
  const blocks = await blockStates(db);

  const ready: PromotionReadyBlock[] = [];
  let alreadyPromoted = 0;
  let awaitingReview = 0;
  let heldBySheet = 0;
  let noPromoter = 0;

  for (const block of blocks) {
    switch (block.state) {
      case 'confirmed':
        ready.push({
          blockId: block.blockId,
          uploadId: block.uploadId,
          sheetName: block.sheetName,
          archetype: block.archetype,
          range: block.range,
          // The review screen owns per-block promotion and renders what the
          // run would delete and what it would retain before anything is
          // written (A34). The register links to it rather than growing a
          // second path to the same write.
          href: `/imports/${block.uploadId}?block=${block.blockId}`,
        });
        break;
      case 'promoted':
        alreadyPromoted += 1;
        break;
      case 'needs-review':
      case 'recognised':
        awaitingReview += 1;
        break;
      case 'blocked':
      case 'superseded':
        heldBySheet += 1;
        break;
      case 'no-promoter':
        noPromoter += 1;
        break;
      default:
        // An unrecognised state — `retired` is coming — is counted nowhere
        // rather than folded into a bucket it does not belong to.
        break;
    }
  }

  return {
    ready,
    readyCount: ready.length,
    alreadyPromoted,
    awaitingReview,
    heldBySheet,
    noPromoter,
  };
}
