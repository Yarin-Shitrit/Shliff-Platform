'use client';
/**
 * Client component: a toast is a reaction to something the reader just did. It
 * needs state that outlives one render, a timer per message, and a look at
 * `document.activeElement` before it takes a message away — none of which
 * exists on the server. The two live regions are the reason the provider
 * renders markup even when there is nothing to say (see the ruling above).
 *
 * This file holds no copy of its own except the dismiss button's name: every
 * sentence a lead reads is the `message` its caller wrote in Hebrew, past
 * tense, naming what happened.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactElement, type ReactNode,
} from 'react';
import type { ActionResult } from '@/lib/action-result';
import { Icon } from '@/components/ui/icon';
import { Button } from './button';
import { cx } from './cx';
import styles from './toaster.module.css';

export interface Toast {
  /** Hebrew, past tense, naming what happened: 'נרשם תשלום של 1,200 ₪ לאיתי כהן'. */
  message: string;
  tone?: 'ok' | 'bad';
  undo?: { label: string; run: () => Promise<ActionResult> };
}

/** `closing`: its caller took it away while the reader was inside it; it goes once the focus leaves. */
type ShownToast = Toast & { id: number; closing?: boolean };

/** Plan 12 Task 6's binding numbers: read it, or read it and reach it. */
const DWELL_MS = 6_000;
const DWELL_WITH_UNDO_MS = 10_000;

/**
 * `show` hands back a way to take that one toast away, for a caller whose
 * sentence stops being true before the reader closes it — an undo toast
 * once a newer edit has made its ביטול about something else. Callers that
 * have no such moment ignore it. Like the toast's own timer, it never takes
 * the toast out from under a reader inside it: it waits until the focus
 * leaves, so the focus is never dropped onto the page.
 */
type ToastApi = { show: (toast: Toast) => () => void };

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) {
    // Not a no-op: a missing provider would otherwise be a screen that quietly
    // stops reporting its writes, which is the whole of what E2 forbids.
    throw new Error('useToast: אין ToastProvider מעל הרכיב הזה');
  }
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [toasts, setToasts] = useState<ShownToast[]>([]);
  const lastId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  /* The caller's way out: marks the toast, and the toast itself goes now, or
     once the reader's focus has left it (`ToastItem`). */
  const close = useCallback((id: number) => {
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, closing: true } : toast)));
  }, []);

  const show = useCallback((toast: Toast) => {
    lastId.current += 1;
    const id = lastId.current;
    setToasts((current) => [...current, { ...toast, id }]);
    return () => { close(id); };
  }, [close]);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  const results = toasts.filter((toast) => toast.tone !== 'bad');
  const failures = toasts.filter((toast) => toast.tone === 'bad');

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/*
        Both regions are rendered unconditionally and both start empty. A live
        region inserted at the same moment as its content is not reliably
        announced, so these two exist from first paint and `show` only ever
        appends. `aria-atomic="false"` overrides the implicit `true` that
        `status` and `alert` carry, so a second toast does not re-read the first.

        They sit inside the Provider, which is also what lets a toast's own undo
        report a refusal through `useToast`.
      */}
      <div className={styles.toaster}>
        <ol className={styles.region} role="alert" aria-atomic="false">
          {failures.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </ol>
        <ol className={styles.region} role="status" aria-live="polite" aria-atomic="false">
          {results.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </ol>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem(
  { toast, onDismiss }: { toast: ShownToast; onDismiss: (id: number) => void },
): ReactElement {
  const { show } = useToast();
  const itemRef = useRef<HTMLLIElement | null>(null);
  /** A local, so the narrowing survives into the button's `onClick` closure. */
  const undo = toast.undo;
  const dwell = undo === undefined ? DWELL_MS : DWELL_WITH_UNDO_MS;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(() => {
        // Never out from under a hand reaching for ביטול.
        if (itemRef.current?.contains(document.activeElement) === true) {
          arm();
          return;
        }
        onDismiss(toast.id);
      }, dwell);
    };
    arm();
    return () => { clearTimeout(timer); };
  }, [dwell, onDismiss, toast.id]);

  /* Taken away by its caller: at once, unless the reader is inside it — then
     when the focus leaves it, the same care the timer takes. */
  const closing = toast.closing === true;
  useEffect(() => {
    if (!closing) return;
    const item = itemRef.current;
    if (item === null || !item.contains(document.activeElement)) {
      onDismiss(toast.id);
      return;
    }
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && item.contains(event.relatedTarget)) return;
      onDismiss(toast.id);
    };
    item.addEventListener('focusout', onFocusOut);
    return () => { item.removeEventListener('focusout', onFocusOut); };
  }, [closing, onDismiss, toast.id]);

  async function takeUndo(taken: NonNullable<Toast['undo']>) {
    // The sentence has stopped being true, so it goes before the inverse runs.
    onDismiss(toast.id);
    const result = await taken.run();
    // An undo is an action that writes, so E2 applies to it too. The message is
    // already Hebrew: R9 and I3 map it at the action boundary.
    if (!result.ok) show({ message: result.error, tone: 'bad' });
  }

  return (
    <li className={cx(styles.toast, styles[toast.tone ?? 'ok'])} ref={itemRef}>
      <span className={styles.icon}>
        <Icon name={toast.tone === 'bad' ? 'alert' : 'check'} size={16} />
      </span>
      <span className={styles.message}>{toast.message}</span>
      <span className={styles.actions}>
        {undo === undefined ? null : (
          <Button size="sm" tone="ghost" onClick={() => { void takeUndo(undo); }}>
            {undo.label}
          </Button>
        )}
        <Button
          size="sm"
          tone="ghost"
          iconLabel="סגירת ההודעה"
          onClick={() => { onDismiss(toast.id); }}
        >
          <Icon name="x" size={14} />
        </Button>
      </span>
    </li>
  );
}
