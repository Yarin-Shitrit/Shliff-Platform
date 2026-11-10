'use client';

/**
 * Two small things the server cannot do: bring today's column into view
 * when the page lands, and bring it back when the ״היום״ button is pressed.
 *
 * The scroll is horizontal only, by a delta on the wrapper's own
 * `scrollLeft`, so the page never jumps vertically to a timeline that sits
 * below the fold, and so it works whichever sign convention the browser
 * uses for a right-to-left scroller.
 */

import { useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

export function TimelineScroll({ wrapperId, todayId }: { wrapperId: string; todayId: string }) {
  const center = useCallback((behavior: ScrollBehavior) => {
    const wrapper = document.getElementById(wrapperId);
    const cell = document.getElementById(todayId);
    if (!wrapper || !cell) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const delta = (cellRect.left + cellRect.width / 2) - (wrapperRect.left + wrapperRect.width / 2);
    /* `scrollBy` is absent from jsdom, where this component is rendered
       under test with nothing to scroll. */
    if (typeof wrapper.scrollBy === 'function') wrapper.scrollBy({ left: delta, behavior });
    else wrapper.scrollLeft += delta;
  }, [wrapperId, todayId]);

  useEffect(() => { center('auto'); }, [center]);

  return (
    <Button size="sm" tone="ghost" onClick={() => { center('smooth'); }}>
      <Icon name="calendar" size={14} />
      היום
    </Button>
  );
}
