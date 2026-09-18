/**
 * The four figures a lead opens דמי קאמפ for, and the two sentences that
 * qualify them.
 *
 * A Server Component. Every tile **value** comes from the one
 * `seasonFeeSummary` call the page already makes; the two counts in the נותר
 * tile's derivation come from `viewCounts` over the same rows the table
 * renders. A tile and a tab therefore cannot disagree about what
 * "טרם שילמו" means.
 *
 * D1: every figure links to the view that can change it, and no number
 * appears as one unlinked claim. The נותר tile's value spans two views
 * (`unpaid` and `partial`), so its derivation names both counts and its
 * single link goes to `unpaid`, where a lead's next action is.
 */

import type { ReactElement } from 'react';
import { StatTile } from '@/components/ui/stat-tile';
import { formatShekels } from '@/lib/money';
import type { SeasonFeeSummary } from '@/lib/fees/summary';
import type { FeeView } from '@/lib/fees/views';
import { feesHref } from './href';
import styles from './fees.module.css';

/**
 * The missing-dues banner's sentence.
 *
 * I12: the plan's copy was `חבר אחד ברשימת {season} עדיין בלי חיוב כלל.` —
 * a masculine singular noun standing in for a person whose gender `persons`
 * does not record. It is written about the חיוב instead, which is both what
 * the banner is reporting and what its button issues. It lives here, beside
 * the figures it qualifies, so that it has a test: `page.tsx` reads a
 * database and has none.
 */
export function missingDuesSentence(count: number, seasonName: string): string {
  return count === 1
    ? `חיוב אחד ברשימת ${seasonName} עדיין לא הונפק, ולכן הוא חסר מצפי הגבייה.`
    : `${count} חיובים ברשימת ${seasonName} עדיין לא הונפקו, ולכן הם חסרים מצפי הגבייה.`;
}

export interface FeeRollupProps {
  summary: SeasonFeeSummary;
  counts: Record<FeeView, number>;
  seasonId: string;
  view: FeeView;
}

export function FeeRollup({
  summary, counts, seasonId,
}: FeeRollupProps): ReactElement {
  const percent = summary.expectedAgorot === 0
    ? 0
    : Math.round((summary.collectedAgorot / summary.expectedAgorot) * 100);

  return (
    <div className={styles.rollup}>
      <StatTile
        label="צפי גבייה"
        valueAgorot={summary.expectedAgorot}
        href={feesHref({ season: seasonId })}
        /* A17: one isolate per phrase, not one per number. */
        derivation={(
          <bdi>{`${summary.flatCount} בתעריף רגיל · ${summary.exceptionCount} חריגים`}</bdi>
        )}
      />

      <StatTile
        label="נגבה"
        valueAgorot={summary.collectedAgorot}
        href={feesHref({ season: seasonId, view: 'paid' })}
        bar={{
          segments: [{ id: 'collected', percent, kind: 'dues' }],
          label: `${percent}% מצפי הגבייה נגבו`,
        }}
        derivation={<bdi>{`${percent}% מהצפי`}</bdi>}
      />

      <StatTile
        label="נותר לגבות"
        valueAgorot={summary.outstandingAgorot}
        tone={summary.outstandingAgorot > 0 ? 'warn' : 'default'}
        href={feesHref({ season: seasonId, view: 'unpaid' })}
        derivation={(
          <bdi>{`${counts.unpaid} טרם שילמו · ${counts.partial} שילמו חלקית`}</bdi>
        )}
      />

      <StatTile
        label="נגבה בקיזוז"
        valueAgorot={summary.offsetAgorot}
        href={feesHref({ season: seasonId, view: 'offset' })}
        derivation={(
          <bdi>
            {`${summary.offsetPersonCount} חברים קיזזו מול חוב שהקאמפ חייב להם`}
          </bdi>
        )}
      />
    </div>
  );
}

/** Kept beside the tiles so the lead sentence and the figures agree. */
export function feeLeadSentence(summary: SeasonFeeSummary, settledCount: number): string {
  return `${formatShekels(summary.flatRateAgorot)} לאדם`
    + ` · נאספו ${formatShekels(summary.collectedAgorot)}`
    + ` מתוך ${formatShekels(summary.expectedAgorot)}`
    + ` · ${settledCount} מתוך ${summary.memberCount} שילמו במלואם`;
}
