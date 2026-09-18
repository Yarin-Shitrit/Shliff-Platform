import type { FeeView } from '@/lib/fees/views';
import { closePeekHref, openPeekHref, type ReadableParams } from '@/components/ui/drawer-url';

/**
 * Every link this screen produces, from one place.
 *
 * A drawer is a URL (R6) and the season is global (R5), so a link to "record
 * איתי's payment, in the טרם שילמו view, for ברן 26" is a thing a lead can
 * paste into a message. Building these by hand at six call sites is how one
 * of them ends up dropping `?season=`.
 *
 * The drawer itself is `?peek=<id>&act=<verb>`, built through the kit's
 * `openPeekHref`/`closePeekHref` (A3) rather than spelled out here — so that
 * `esc`, the close control and the back button read the same two params this
 * screen's drawer will one day handle, instead of a `pay=`/`exception=` pair
 * only this file knows about.
 */
export interface FeesHrefParts {
  season: string;
  view?: FeeView;
  pay?: string;
  exception?: string;
}

export function feesHref(parts: FeesHrefParts): string {
  const current: ReadableParams = parts.view && parts.view !== 'all'
    ? [['season', parts.season], ['view', parts.view]]
    : [['season', parts.season]];

  // One drawer at a time: two overlapping panels have no sensible layout, and
  // `pay` is the one a lead is far more often in the middle of.
  if (parts.pay) return openPeekHref('/fees', current, parts.pay, 'pay');
  if (parts.exception) return openPeekHref('/fees', current, parts.exception, 'exception');
  return closePeekHref('/fees', current);
}
