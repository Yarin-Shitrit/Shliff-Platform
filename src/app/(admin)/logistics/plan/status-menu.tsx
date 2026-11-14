'use client';

/**
 * The quick status control on a row, the twin of the warehouse's
 * `ConditionMenu`: three states, one press, no drawer. Ticking off a
 * morning's work is a run of small updates, and making each one cost a
 * drawer is how a plan stops being kept.
 *
 * A client component: it writes, reports, and offers the inverse.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Popover } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toaster';
import type { WorkItemStatus } from '@/db/schema/logistics';
import { WORK_STATUS_LABELS } from '@/lib/logistics/labels';
import { WORK_ITEM_STATUSES } from '@/lib/logistics/plan';
import { setItemStatusAction } from './actions';
import styles from './plan.module.css';

export function StatusMenu({ item }: { item: { id: string; title: string; status: WorkItemStatus } }) {
  const router = useRouter();
  const { show } = useToast();
  const [pending, setPending] = useState(false);

  async function set(next: WorkItemStatus) {
    const previous = item.status;
    setPending(true);
    try {
      const result = await setItemStatusAction(item.id, next);
      if (!result.ok) { show({ message: result.error, tone: 'bad' }); return; }
      show({
        /* The state the server set, which for a purchase's line reopened
           after its purchase arrived is done, not the open that was asked for. */
        message: `${item.title} · ${WORK_STATUS_LABELS[result.value ?? next]}`,
        tone: 'ok',
        /* E2: the undo is the domain's own inverse — the status that was. */
        undo: {
          label: 'ביטול',
          /* The toaster wants a bare result; the status the undo landed on is not its to report. */
          run: async () => {
            const undone = await setItemStatusAction(item.id, previous);
            return undone.ok ? { ok: true } : undone;
          },
        },
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover
      id={`status-${item.id}`}
      label={`עדכון מצב · ${item.title}`}
      triggerTone="ghost"
      align="end"
      triggerContent={<span className={styles.rowAction}><Icon name="more" size={16} /></span>}
    >
      <span className={styles.menu}>
        {WORK_ITEM_STATUSES.map((status) => (
          <Button
            key={status}
            size="sm"
            tone="ghost"
            disabled={pending || status === item.status}
            onClick={() => { void set(status); }}
          >
            {status === item.status ? <Icon name="check" size={14} /> : null}
            {WORK_STATUS_LABELS[status]}
          </Button>
        ))}
      </span>
    </Popover>
  );
}
