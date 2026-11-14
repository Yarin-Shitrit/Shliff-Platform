'use client';

/**
 * The round check at the start of a row: one press marks the item done,
 * one more reopens it. The pleasure of a plan is ticking things off, and
 * that should never cost a menu. Cancelling is rarer and stays behind the
 * row's menu and the drawer's confirmation.
 *
 * `aria-pressed` carries the state for a reader; the label names the verb
 * the press performs, not the state. A client component: it writes,
 * reports, and offers the inverse.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toaster';
import { cx } from '@/components/ui/cx';
import type { WorkItemStatus } from '@/db/schema/logistics';
import { setItemStatusAction } from './actions';
import styles from './plan.module.css';

export function DoneToggle({ item }: { item: { id: string; title: string; status: WorkItemStatus } }) {
  const router = useRouter();
  const { show } = useToast();
  const [pending, setPending] = useState(false);
  const done = item.status === 'done';

  async function toggle() {
    const next: WorkItemStatus = done ? 'open' : 'done';
    setPending(true);
    try {
      const result = await setItemStatusAction(item.id, next);
      if (!result.ok) { show({ message: result.error, tone: 'bad' }); return; }
      show({
        message: next === 'done' ? `${item.title} הושלמה` : `${item.title} נפתחה מחדש`,
        tone: 'ok',
        undo: {
          label: 'ביטול',
          /* The toaster wants a bare result; the status the undo landed on is not its to report. */
          run: async () => {
            const undone = await setItemStatusAction(item.id, item.status);
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
    <button
      type="button"
      className={cx(styles.check, done && styles.checkDone)}
      aria-pressed={done}
      aria-label={done ? `פתיחה מחדש · ${item.title}` : `סימון כהושלמה · ${item.title}`}
      disabled={pending}
      onClick={() => { void toggle(); }}
    >
      <Icon name="check" size={14} />
    </button>
  );
}
