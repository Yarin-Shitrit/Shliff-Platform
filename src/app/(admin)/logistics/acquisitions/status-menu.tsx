'use client';

/**
 * The quick status control on a row, and the twin of the warehouse's
 * `ConditionMenu`: four states, one press, no drawer. Chasing an order is a
 * run of small updates, and making each one cost a drawer is how a list stops
 * being kept.
 *
 * `הגיע למחסן` is offered here as a plain status write, deliberately. A box
 * turns up at somebody's flat and they mark it on a phone; where it finally
 * gets stored is answered days later, when it goes into the container. Forcing
 * the two together would either lose the first fact or invent the second. The
 * screen holds the gap as a visible decision instead, and the toast says so.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Popover } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toaster';
import type { AcquisitionRow } from '@/lib/logistics/acquisitions';
import { STATUS_LABELS } from '@/lib/logistics/labels';
import type { AcquisitionStatus } from '@/db/schema/logistics';
import { setAcquisitionStatusAction } from './actions';
import styles from './acquisitions.module.css';

const STATUSES = Object.keys(STATUS_LABELS) as AcquisitionStatus[];

export function StatusMenu({ row }: { row: AcquisitionRow }) {
  const router = useRouter();
  const { show } = useToast();
  const [pending, setPending] = useState(false);

  async function set(next: AcquisitionStatus) {
    const previous = row.status;
    setPending(true);
    try {
      const result = await setAcquisitionStatusAction(row.id, next);
      if (!result.ok) { show({ message: result.error, tone: 'bad' }); return; }

      show({
        message: next === 'arrived' && row.arrivedItemId === null
          /* Says what is still open rather than reporting a clean finish: the
             row now claims the thing is here and cannot say where. */
          ? `${row.name} · הגיע, ועדיין לא נרשם למחסן`
          : `${row.name} · ${STATUS_LABELS[next]}`,
        tone: 'ok',
        // E2: the undo is the domain inverse — the previous status, written back.
        undo: { label: 'ביטול', run: () => setAcquisitionStatusAction(row.id, previous) },
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover
      id={`status-${row.id}`}
      label={`עדכון סטטוס · ${row.name}`}
      triggerTone="chip"
      align="end"
      triggerContent={<>עדכון</>}
    >
      <span className={styles.menu}>
        {STATUSES.map((status) => (
          <Button
            key={status}
            size="sm"
            tone="ghost"
            disabled={pending || status === row.status}
            onClick={() => { void set(status); }}
          >
            {status === row.status ? <Icon name="check" size={14} /> : null}
            {STATUS_LABELS[status]}
          </Button>
        ))}
      </span>
    </Popover>
  );
}
