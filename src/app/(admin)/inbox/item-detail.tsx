import type { ReactElement } from 'react';
import type { InboxItem, InboxGroup } from '@/lib/inbox/items';

/**
 * Task 10 builds this. It is a stub so Task 9's page can be written, rendered
 * and tested against the rail and the empty states, which are what that task
 * is about.
 */
export function ItemDetail(_props: {
  item: InboxItem | null;
  position: number;
  total: number;
  nextId: string | null;
  prevId: string | null;
  tab: 'decide' | 'notice' | 'done';
  kind: InboxGroup | 'all';
}): ReactElement | null {
  return null;
}
