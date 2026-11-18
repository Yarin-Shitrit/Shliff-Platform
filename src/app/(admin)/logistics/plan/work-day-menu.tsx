'use client';

/**
 * Right-click on a task — a row of the list or a bar of the timeline — and
 * put it on one of the season's work days.
 *
 * The work days are the ones on לוח הנוכחות (kind ״יום עבודה״, not
 * cancelled). Choosing one writes the task's days and nothing else: the task
 * starts on that day and is a one-day item, exactly as if the drawer's two
 * date fields had been filled by hand. There is no stored link between the
 * two rows, so nothing here can drift: the task says a day, the board says
 * what happens on that day.
 *
 * One listener around both views rather than a handler per row: the list is
 * the kit's `Table`, whose rows this screen does not own. A task marks itself
 * with `data-plan-item`, and a click anywhere on its table row finds it.
 * Anything that is not a task — a heading, the header, empty space — keeps
 * the browser's own menu. The Menu key and Shift+F10 raise the same event
 * from a focused task, so the keyboard gets the same menu.
 */

import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toaster';
import { scheduleItemAction } from './actions';
import styles from './plan.module.css';

export const PLAN_ITEM_ATTR = 'data-plan-item';

export interface WorkDayTarget {
  id: string;
  title: string;
  startsOn: string | null;
  endsOn: string | null;
}

export interface WorkDayOption {
  /** The occasion's id on לוח הנוכחות. */
  id: string;
  /** Its title, or ״יום עבודה״ when it has none. */
  label: string;
  /** `YYYY-MM-DD`. */
  heldOn: string;
}

const WEEKDAY = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', weekday: 'long' });

/** `יום שבת 14/03/2026` — the weekday read from the calendar, never assumed. */
export function workDayWhen(day: string): string {
  const weekday = WEEKDAY.format(new Date(`${day}T12:00:00Z`));
  return `${weekday} ${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

/** True when the task already sits on exactly that one day. */
function isOn(item: WorkDayTarget, day: string): boolean {
  return item.startsOn === day && (item.endsOn === null || item.endsOn === day);
}

interface Open { item: WorkDayTarget; x: number; y: number }

const EDGE = 8;

export function WorkDayMenu({
  items, workDays, addHref, children,
}: {
  /** The tasks that can be placed: every one that is not cancelled. */
  items: readonly WorkDayTarget[];
  /** The season's live work days, oldest first. */
  workDays: readonly WorkDayOption[];
  /** Where a work day is added — null when this account cannot open נוכחות. */
  addHref: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [open, setOpen] = useState<Open | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const [pending, setPending] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const cameFrom = useRef<HTMLElement | null>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(null);
    setPlace(null);
    if (refocus) cameFrom.current?.focus();
    cameFrom.current = null;
  }, []);

  function onContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const marked = target.closest<HTMLElement>(`[${PLAN_ITEM_ATTR}]`)
      ?? target.closest('tr')?.querySelector<HTMLElement>(`[${PLAN_ITEM_ATTR}]`)
      ?? null;
    const id = marked?.getAttribute(PLAN_ITEM_ATTR);
    const item = items.find((candidate) => candidate.id === id);
    if (!item || !marked) return;

    event.preventDefault();
    /* From the keyboard there is no pointer: the menu opens under the task. */
    const fromKeyboard = event.clientX === 0 && event.clientY === 0;
    const rect = marked.getBoundingClientRect();
    cameFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPlace(null);
    setOpen({
      item,
      x: fromKeyboard ? rect.left : event.clientX,
      y: fromKeyboard ? rect.bottom : event.clientY,
    });
  }

  /* Measured once drawn, then pulled back inside the window: a right-click
     near an edge must not open a menu half off the screen. */
  useLayoutEffect(() => {
    if (open === null || panel.current === null) return;
    const rect = panel.current.getBoundingClientRect();
    setPlace({
      left: Math.max(EDGE, Math.min(open.x, window.innerWidth - rect.width - EDGE)),
      top: Math.max(EDGE, Math.min(open.y, window.innerHeight - rect.height - EDGE)),
    });
    const first = panel.current.querySelector<HTMLElement>('button:not(:disabled), a[href]');
    (first ?? panel.current).focus();
  }, [open]);

  useEffect(() => {
    if (open === null) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
    }
    function onPointer(event: MouseEvent) {
      if (panel.current?.contains(event.target as Node)) return;
      close(false);
    }
    function onMove(event: Event) {
      /* The menu's own list may scroll; the page moving under it may not. */
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      close(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, close]);

  async function choose(item: WorkDayTarget, day: WorkDayOption) {
    const before = { startsOn: item.startsOn, endsOn: item.endsOn };
    setPending(true);
    try {
      const result = await scheduleItemAction(item.id, { startsOn: day.heldOn, endsOn: null });
      if (!result.ok) { show({ message: result.error, tone: 'bad' }); return; }
      show({
        message: `${item.title} שויכה ל${day.label} · ${workDayWhen(day.heldOn)}`,
        tone: 'ok',
        /* E2: the undo is the domain's own inverse — the days that were. */
        undo: { label: 'ביטול', run: () => scheduleItemAction(item.id, before) },
      });
      close(true);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.ctxScope} onContextMenu={onContextMenu}>
      {children}
      {open === null ? null : createPortal(
        <div
          ref={panel}
          className={styles.ctxMenu}
          role="dialog"
          tabIndex={-1}
          aria-label={`שיוך ליום עבודה · ${open.item.title}`}
          style={place === null
            ? { left: open.x, top: open.y, visibility: 'hidden' }
            : { left: place.left, top: place.top }}
        >
          <div className={styles.ctxHead}>
            <span className={styles.ctxVerb}>שיוך ליום עבודה</span>
            <bdi className={styles.ctxTask}>{open.item.title}</bdi>
          </div>
          {workDays.length === 0 ? (
            <p className={styles.ctxEmpty}>
              {addHref === null
                ? 'עדיין אין ימי עבודה בלוח הנוכחות של השנה הזו. מי שמנהל את לוח הנוכחות מוסיף שם יום עבודה, והוא יופיע כאן.'
                : 'עדיין אין ימי עבודה בלוח הנוכחות של השנה הזו. מוסיפים שם יום עבודה, והוא יופיע כאן.'}
            </p>
          ) : (
            <span className={styles.menu}>
              {workDays.map((day) => {
                const current = isOn(open.item, day.heldOn);
                return (
                  <Button
                    key={day.id}
                    size="sm"
                    tone="ghost"
                    disabled={pending || current}
                    onClick={() => { void choose(open.item, day); }}
                  >
                    {current ? <Icon name="check" size={14} /> : null}
                    <bdi>{day.label}</bdi>
                    <span className={styles.ctxWhen}>{workDayWhen(day.heldOn)}</span>
                  </Button>
                );
              })}
            </span>
          )}
          {addHref === null ? null : (
            <Link className={styles.ctxAdd} href={addHref}>
              <Icon name="plus" size={14} />
              יום עבודה חדש בלוח הנוכחות
            </Link>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
