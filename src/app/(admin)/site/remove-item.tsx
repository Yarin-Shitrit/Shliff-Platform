'use client';

/**
 * The confirmation over one item. A real delete (see `removeItem` in
 * `src/lib/site/plan.ts` for why this platform allows one here), so it
 * names the thing and the consequence and the verb is the verb.
 */

import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toaster';
import { removeItemAction } from './actions';

export function RemoveItem({ item, cancelHref }: {
  item: { id: string; label: string };
  cancelHref: string;
}) {
  const router = useRouter();
  const { show } = useToast();

  async function remove(): Promise<void> {
    const result = await removeItemAction(item.id);
    if (!result.ok) {
      show({ message: result.error, tone: 'bad' });
      return;
    }
    show({ message: `${item.label} הוסר מהמפה`, tone: 'ok' });
    router.replace(cancelHref);
    router.refresh();
  }

  return (
    <ConfirmDialog
      title="הסרה מהמפה"
      consequence={<>{item.label} יוסר מהמפה. הציוד עצמו לא נוגע בזה — רק המקום שלו בשרטוט.</>}
      confirmLabel="הסרת הפריט"
      cancelHref={cancelHref}
      onConfirm={() => { void remove(); }}
    />
  );
}
