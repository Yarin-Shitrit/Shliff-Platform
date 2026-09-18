/**
 * The saved-view tab strip.
 *
 * A Server Component: every view is a link, so there is nothing to make this
 * a client tree (R7). The counts arrive already computed by `viewCounts` over
 * the rows the table renders — this file derives nothing, so a tab's number
 * and the rows beneath it cannot drift apart.
 *
 * A view whose count is zero is still listed. `טרם שילמו 0` is the best news
 * this screen can carry, and a tab that disappears when it hits zero takes
 * that news away with it.
 */

import type { ReactElement } from 'react';
import { SavedViews } from '@/components/ui/saved-views';
import { FEE_VIEWS, type FeeView } from '@/lib/fees/views';
import { feesHref } from './href';

export interface FeeViewsProps {
  counts: Record<FeeView, number>;
  seasonId: string;
  view: FeeView;
}

export function FeeViews({ counts, seasonId, view }: FeeViewsProps): ReactElement {
  return (
    <SavedViews
      label="תצוגות של דמי קאמפ"
      currentId={view}
      views={FEE_VIEWS.map((one) => ({
        id: one.id,
        label: one.label,
        count: counts[one.id],
        href: feesHref({ season: seasonId, view: one.id }),
      }))}
    />
  );
}
