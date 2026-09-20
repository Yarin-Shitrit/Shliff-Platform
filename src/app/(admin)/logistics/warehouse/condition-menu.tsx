'use client';

/**
 * The quick control on a row: four states, one press, no drawer.
 *
 * It exists beside the item drawer rather than instead of it because the two
 * answer different questions. Walking the storage unit before the burn is a
 * run of condition changes and nothing else, and making each one cost a drawer
 * open, a save and a close is how a checklist stops being done. Everything
 * else about an item — its name, its count, where it sits — is still the
 * drawer's.
 *
 * A client component: it writes, reports, and offers the inverse.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Popover } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toaster';
import type { WarehouseRow } from '@/lib/logistics/warehouse';
import { CONDITION_LABELS } from '@/lib/logistics/labels';
import type { ItemCondition } from '@/db/schema/logistics';
import { setConditionAction } from './actions';
import styles from './warehouse.module.css';

const CONDITIONS = Object.keys(CONDITION_LABELS) as ItemCondition[];

export function ConditionMenu({ item }: { item: WarehouseRow }) {
  const router = useRouter();
  const { show } = useToast();
  const [pending, setPending] = useState(false);

  async function set(next: ItemCondition) {
    const previous = item.condition;
    setPending(true);
    try {
      const result = await setConditionAction(item.id, next);
      if (!result.ok) { show({ message: result.error, tone: 'bad' }); return; }

      show({
        message: `${item.name} · ${CONDITION_LABELS[next]}`,
        tone: 'ok',
        /* E2: the undo is the domain's own inverse. Writing the old state back
           is precisely what was true before — including the record that
           somebody changed it, which is history and is not rewritten. */
        undo: { label: 'ביטול', run: () => setConditionAction(item.id, previous) },
      });

      /* The default sort is worst-first and the `attention` view filters on
         condition, so the row that was just changed can legitimately leave the
         view. Leaving it drawn where it was would be the screen disagreeing
         with what is stored. */
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover
      id={`condition-${item.id}`}
      label={`עדכון מצב · ${item.name}`}
      triggerTone="chip"
      align="end"
      triggerContent={<>עדכון מצב</>}
    >
      <span className={styles.menu}>
        {CONDITIONS.map((condition) => (
          <Button
            key={condition}
            size="sm"
            tone="ghost"
            disabled={pending || condition === item.condition}
            onClick={() => { void set(condition); }}
          >
            {condition === item.condition ? <Icon name="check" size={14} /> : null}
            {CONDITION_LABELS[condition]}
          </Button>
        ))}
      </span>
    </Popover>
  );
}
