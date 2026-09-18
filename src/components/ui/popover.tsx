'use client';
/**
 * Client component: a disclosure that closes on an outside pointerdown, on
 * `esc`, and on a choice made inside it needs `document` listeners and a ref
 * to the trigger it restores focus to. R1 forbids the headless-UI dependency
 * that would supply this, so the kit owns one copy and C3 and C8 share it.
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
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
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

export function Popover({
  id, label, triggerContent, triggerTone = 'chip', align = 'start', children,
}: PopoverProps): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // K3/A9 territory: this is the kit's one hand-written disclosure, so it owns
  // the outside-pointerdown listener itself rather than pulling in a library.
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target) === true) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); };
  }, [open]);

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

      {open ? (
        <span
          className={cx(styles.panel, align === 'end' && styles.alignEnd)}
          id={`${id}-panel`}
          onClick={(event) => {
            const target = event.target;
            if (target instanceof Element && target.closest('a, button') !== null) close();
          }}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
