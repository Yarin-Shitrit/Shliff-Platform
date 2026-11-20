'use client';
/**
 * Client component: the ⓘ that holds an explanation a screen does not need to
 * say out loud. It opens while the pointer rests on it and stays open once it
 * is pressed, which needs state, a timer and the `document` listeners
 * `Popover` needs for the same reasons.
 *
 * What belongs here is the sentence that explains how a screen *works* — where
 * its rows come from, what a button will write. What does not: a warning
 * about the thing being done right now, an error, an empty state's
 * invitation, or a figure. Those are read at the moment they matter, and a
 * lead who has to go looking for one has already missed it.
 *
 * Two ways in, on purpose. Hover is the quick one and exists only for a
 * mouse; a press pins the panel open, which is the only way a phone or a
 * keyboard has, and the way to reach a link inside it. The panel is rendered
 * only while open, portaled and `fixed` like `Popover`'s, so a drawer's or a
 * table's `overflow` cannot clip it.
 */
import {
  useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconSize } from './icon';
import { computePanelPosition } from './popover';
import styles from './info-tip.module.css';

export type InfoTipProps = {
  /** Unique within the page; the panel's `id`. */
  id: string;
  /** The trigger's accessible name. Hebrew. Default ״הסבר״. */
  label?: string;
  /** default 15 */
  size?: IconSize;
  /** The explanation. */
  children: ReactNode;
};

type PanelPosition = { top: number; left: number; maxHeight: number };

/** Long enough to cross the gap from the icon to the panel without it shutting. */
const LEAVE_MS = 140;

export function InfoTip({ id, label = 'הסבר', size = 15, children }: InfoTipProps): ReactElement {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLSpanElement | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = pinned || hovered;
  const panelId = `${id}-tip`;

  function cancelLeave() {
    if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  }
  useEffect(() => cancelLeave, []);

  /* Hover is a mouse's gesture. A finger fires `pointerenter` too, on the way
     to the click that pins the panel, and counting it would leave the panel
     open after a second tap meant to close it. */
  function onEnter(event: { pointerType: string }) {
    if (event.pointerType !== 'mouse') return;
    cancelLeave();
    setHovered(true);
  }
  function onLeave(event: { pointerType: string }) {
    if (event.pointerType !== 'mouse') return;
    cancelLeave();
    leaveTimer.current = setTimeout(() => { setHovered(false); }, LEAVE_MS);
  }

  useEffect(() => {
    if (!pinned) return undefined;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node
        && (rootRef.current?.contains(target) === true || panelRef.current?.contains(target) === true)) return;
      setPinned(false);
      setHovered(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); };
  }, [pinned]);

  // Inert in jsdom, which has no layout; see `Popover` for the same step.
  useLayoutEffect(() => {
    if (!open || triggerRef.current === null || panelRef.current === null) {
      setPosition(null);
      return;
    }
    const panel = panelRef.current.getBoundingClientRect();
    setPosition(computePanelPosition(
      triggerRef.current.getBoundingClientRect(), { width: panel.width, height: panel.height }, 'start',
    ));
  }, [open]);

  function onKeyDown(event: { key: string; stopPropagation: () => void; preventDefault: () => void }) {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();   // an enclosing Drawer must not also close
    event.preventDefault();
    cancelLeave();
    setPinned(false);
    setHovered(false);
    triggerRef.current?.focus();
  }

  return (
    <span
      className={styles.root}
      ref={rootRef}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        onClick={() => { setPinned((was) => !was); }}
      >
        <Icon name="info" size={size} />
      </button>

      {open ? createPortal(
        <span
          className={styles.panel}
          ref={panelRef}
          id={panelId}
          role="note"
          style={{
            top: position?.top ?? 0, left: position?.left ?? 0,
            maxBlockSize: position?.maxHeight,
            visibility: position === null ? 'hidden' : 'visible',
          }}
          onPointerEnter={onEnter}
          onPointerLeave={onLeave}
          onKeyDown={onKeyDown}
        >
          {children}
        </span>,
        document.body,
      ) : null}
    </span>
  );
}
