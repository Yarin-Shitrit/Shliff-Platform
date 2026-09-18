'use client';
/**
 * Client component: a disclosure that closes on an outside pointerdown, on
 * `esc`, and on a choice made inside it needs `document` listeners and a ref
 * to the trigger it restores focus to. R1 forbids the headless-UI dependency
 * that would supply this, so the kit owns one copy and C3 and C8 share it.
 * Positioning the panel also needs `document` (a portal target, the trigger's
 * measured rect, the viewport width) rather than the CSS this file used to
 * rely on — see `computePanelPosition` below.
 *
 * No `role="menu"`/`"menuitem"` here, on purpose: `season-switch.tsx` already
 * shipped this popover pattern once and settled the question for a panel of
 * *links* — overriding an anchor's implicit link role to `menuitem` would
 * take away the one role a keyboard or screen-reader user actually needs to
 * act on it, and every panel `FilterBar` builds from this component is a
 * list of links (Ruling 1: every filter is a URL). So the panel carries no
 * role of its own and lets its children's native roles stand; `aria-haspopup`
 * on the trigger is the same generic `"true"` `season-switch.tsx` uses, not
 * `"menu"`, for the same reason.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import styles from './popover.module.css';

export type PopoverTriggerTone = 'chip' | 'chip-dashed' | 'ghost' | 'bulk';

export type PopoverProps = {
  /** Unique within the page; the panel's `id` and the trigger's `aria-controls`. */
  id: string;
  /** The trigger's accessible name. */
  label: string;
  /** What the trigger shows. Omitted means the label is shown. */
  triggerContent?: ReactNode;
  /** default 'chip' */
  triggerTone?: PopoverTriggerTone;
  /** Which edge the panel lines up with. Default 'start'. */
  align?: 'start' | 'end';
  children: ReactNode;
};

const TONE_CLASS: Record<PopoverTriggerTone, string> = {
  chip: 'chip',
  'chip-dashed': 'chipDashed',
  ghost: 'ghost',
  bulk: 'bulk',
};

type PanelPosition = { top: number; left: number };
const GAP = 6;

/**
 * Physical `left`/`top`, not a logical inset: the panel is portaled to
 * `document.body` and `position: fixed`, so its offset has to be measured
 * from the trigger's real rect and the real viewport width. "Inline-start"
 * is the trigger's *right* edge and "inline-end" its *left* in this app's
 * fixed RTL, but that fact only picks which candidate is tried first — the
 * one actually used is whichever fits, from the rect and viewport width.
 */
function computePanelPosition(
  trigger: DOMRect, panelWidth: number, preferredAlign: 'start' | 'end',
): PanelPosition {
  const viewportWidth = window.innerWidth;
  const startLeft = trigger.right - panelWidth; // panel's start (right) edge meets the trigger's
  const endLeft = trigger.left;                 // panel's end (left) edge meets the trigger's
  const preferred = preferredAlign === 'start' ? startLeft : endLeft;
  const fallback = preferredAlign === 'start' ? endLeft : startLeft;
  const fits = (left: number) => left >= 0 && left + panelWidth <= viewportWidth;
  const left = fits(preferred)
    ? preferred
    : fits(fallback) ? fallback : Math.min(Math.max(preferred, 0), Math.max(viewportWidth - panelWidth, 0));
  return { top: trigger.bottom + GAP, left };
}

export function Popover({
  id, label, triggerContent, triggerTone = 'chip', align = 'start', children,
}: PopoverProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLSpanElement | null>(null);

  // K3/A9 territory: this is the kit's one hand-written disclosure, so it owns
  // the outside-pointerdown listener itself rather than pulling in a library.
  // Both refs, now the panel is portaled: it is no longer a DOM descendant of
  // `rootRef`, so a click inside it would otherwise read as "outside".
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node
        && (rootRef.current?.contains(target) === true || panelRef.current?.contains(target) === true)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); };
  }, [open]);

  // jsdom has no layout — `getBoundingClientRect()` returns zeros there, so
  // this measure-then-place step is inert in tests and only does real work
  // in a browser. `useLayoutEffect`, not `useEffect`: it must run before the
  // browser paints the panel at its first, unmeasured position.
  useLayoutEffect(() => {
    if (!open || triggerRef.current === null || panelRef.current === null) {
      setPosition(null);
      return;
    }
    setPosition(computePanelPosition(
      triggerRef.current.getBoundingClientRect(), panelRef.current.getBoundingClientRect().width, align,
    ));
  }, [open, align]);

  function close() {
    setOpen(false);
    // A9: esc and every other way of closing hand focus back to the trigger,
    // never to the document body.
    triggerRef.current?.focus();
  }

  return (
    <span
      className={styles.root}
      ref={rootRef}
      onKeyDown={(event) => {
        // `Escape` is not a letter, so R10's event.code rule does not bite here.
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();   // an enclosing Drawer must not also close
        event.preventDefault();
        close();
      }}
    >
      {/*
        `aria-label` is set unconditionally, so the trigger's accessible name is
        exactly `label` whether it shows an icon, a chip face, or the label
        itself. A name assembled from mixed content is a name no test can match.
      */}
      <button
        type="button"
        ref={triggerRef}
        className={cx(styles.trigger, styles[TONE_CLASS[triggerTone]])}
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-haspopup="true"
        onClick={() => { setOpen((was) => !was); }}
      >
        {triggerContent ?? label}
      </button>

      {open ? createPortal(
        // Rendered through a portal, `position: fixed` from the measured
        // trigger rect: `.root` may sit inside `table.module.css`'s
        // `overflow: auto`, `drawer.module.css`'s `overflow: hidden`, or
        // `saved-views.module.css`'s `overflow-x: auto` — any of which would
        // clip an `absolute` panel sized to its own `.root`. Hidden until
        // `position` is measured, so the unmeasured (0,0) frame never paints.
        <span
          className={styles.panel}
          ref={panelRef}
          id={`${id}-panel`}
          style={{
            top: position?.top ?? 0, left: position?.left ?? 0,
            visibility: position === null ? 'hidden' : 'visible',
          }}
          onClick={(event) => {
            const target = event.target;
            if (target instanceof Element && target.closest('a, button') !== null) close();
          }}
        >
          {children}
        </span>,
        document.body,
      ) : null}
    </span>
  );
}
