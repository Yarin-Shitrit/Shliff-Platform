'use client';

/**
 * One cell of the board: a round check that is a mark when it is filled.
 * One press marks the person present on that day, one more takes it back.
 * The pleasure of a board like this is ticking names off, and that should
 * never cost a menu or a drawer.
 *
 * `aria-pressed` carries the state for a reader; the label names the verb
 * the press performs and the two things it joins, because a cell in a grid
 * of forty rows and twenty columns has no header close enough to borrow.
 * A client component: it writes, reports, and offers the inverse.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toaster';
import { cx } from '@/components/ui/cx';
import { setMarkAction } from './actions';
import styles from './attendance.module.css';

export function MarkToggle({
  eventId, personId, personName, eventName, present,
}: {
  eventId: string;
  personId: string;
  personName: string;
  /** The column's words — the title or the kind, with the day. */
  eventName: string;
  present: boolean;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [pending, setPending] = useState(false);
  /* Drawn as pressed the moment it is pressed, so a lead ticking down a
     column is not waiting on the server between names. The page's own
     refresh brings the real state back under it. */
  const [shown, setShown] = useState(present);

  async function toggle() {
    const next = !shown;
    setPending(true);
    setShown(next);
    try {
      const result = await setMarkAction(eventId, personId, next);
      if (!result.ok) {
        setShown(!next);
        show({ message: result.error, tone: 'bad' });
        return;
      }
      show({
        message: next
          ? `${personName} · ${eventName} — סומן כנוכח/ה`
          : `${personName} · ${eventName} — הסימון הוסר`,
        tone: 'ok',
        undo: {
          label: 'ביטול',
          run: async () => {
            const undone = await setMarkAction(eventId, personId, !next);
            if (undone.ok) setShown(!next);
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
      className={cx(styles.check, shown && styles.checkOn)}
      aria-pressed={shown}
      aria-label={shown
        ? `הסרת סימון · ${personName} · ${eventName}`
        : `סימון נוכחות · ${personName} · ${eventName}`}
      disabled={pending}
      onClick={() => { void toggle(); }}
    >
      <Icon name="check" size={14} />
    </button>
  );
}
