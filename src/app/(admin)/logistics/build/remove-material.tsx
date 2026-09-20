'use client';

/**
 * The one destructive control on this screen, and the reason it is allowed to
 * be one: a material line is not a fact about the world, it is somebody's
 * statement that a task needs a thing. Withdrawing it leaves nothing
 * unexplained, and neither the stock nor the order it pointed at is touched.
 *
 * The undo re-adds the same line (E2 — the domain inverse, not a UI stack).
 * The restored row gets a new id, which is right: what is restored is the
 * state, not the identity.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { MaterialRow } from '@/lib/logistics/build';
import { addMaterialAction, removeMaterialAction } from './actions';

export function RemoveMaterial({ material }: { material: MaterialRow }) {
  const router = useRouter();
  const { show } = useToast();
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    try {
      const result = await removeMaterialAction(material.id);
      if (!result.ok) { show({ message: result.error, tone: 'bad' }); return; }

      show({
        message: `${material.name} הוסר מרשימת החומרים`,
        tone: 'ok',
        undo: {
          label: 'ביטול',
          /* The new row's id is dropped rather than carried: a toast's undo
             returns `ActionResult<never>`, and nothing here has a second
             inverse to offer. What is restored is the state, not the id. */
          run: async (): Promise<ActionResult> => {
            const undone = await addMaterialAction({
              taskId: material.taskId,
              name: material.name,
              quantityNeeded: material.quantityNeeded,
              inventoryItemId: material.inventory?.id ?? null,
              acquisitionItemId: material.acquisition?.id ?? null,
            });
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
    <Button
      size="sm"
      tone="ghost"
      iconLabel={`הסרת ${material.name} מרשימת החומרים`}
      disabled={pending}
      onClick={() => { void remove(); }}
    >
      <Icon name="trash" size={15} />
    </Button>
  );
}
