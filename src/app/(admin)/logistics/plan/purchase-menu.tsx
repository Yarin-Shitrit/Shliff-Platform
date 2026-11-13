'use client';

/**
 * The row control for an item that is a purchase: the four states of the
 * acquisition, not the board's three. The board's done is the list's
 * arrived, so this is the same write רכש's status menu makes, offered
 * where the lead is standing. The undo is the status that was (E2).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Popover } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toaster';
import type { AcquisitionStatus } from '@/db/schema/logistics';
import { STATUS_LABELS } from '@/lib/logistics/labels';
import { setPurchaseStatusAction } from './actions';
import styles from './plan.module.css';

const STATUSES = Object.keys(STATUS_LABELS) as AcquisitionStatus[];

export function PurchaseMenu({ item }: { item: { acquisitionId: string; title: string; status: AcquisitionStatus } }) {
  const router = useRouter();
  const { show } = useToast();
  const [pending, setPending] = useState(false);

  async function set(next: AcquisitionStatus) {
    const previous = item.status;
    setPending(true);
    try {
      const result = await setPurchaseStatusAction(item.acquisitionId, next);
      if (!result.ok) { show({ message: result.error, tone: 'bad' }); return; }
      show({
        message: `${item.title} · ${STATUS_LABELS[next]}`,
        tone: 'ok',
        undo: { label: 'ביטול', run: () => setPurchaseStatusAction(item.acquisitionId, previous) },
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover
      id={`purchase-${item.acquisitionId}`}
      label={`עדכון סטטוס רכש · ${item.title}`}
      triggerTone="ghost"
      align="end"
      triggerContent={<span className={styles.rowAction}><Icon name="more" size={16} /></span>}
    >
      <span className={styles.menu}>
        {STATUSES.map((status) => (
          <Button
            key={status}
            size="sm"
            tone="ghost"
            disabled={pending || status === item.status}
            onClick={() => { void set(status); }}
          >
            {status === item.status ? <Icon name="check" size={14} /> : null}
            {STATUS_LABELS[status]}
          </Button>
        ))}
      </span>
    </Popover>
  );
}
