'use client';

// A client component because pressing an action is three pieces of state the
// server cannot hold: a pending transition, a confirmation the lead has not
// answered yet, and the two names a split needs before it can run.

import { useState, useTransition, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import type { InboxAction, InboxKind } from '@/lib/inbox/items';
import type { ActionResult } from '@/lib/action-result';
import { useToast } from '@/components/ui/toaster';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ButtonLink } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import {
  ignoreNameAction, unignoreNameAction,
  snoozeItemAction, unsnoozeItemAction, splitNameAction,
} from './actions';
import {
  linkNameAction, promoteNameAction, unlinkAliasAction,
} from '../members/actions';
import styles from './inbox.module.css';

/** R8: an irreversible or removing action names its consequence first. */
const CONFIRMATIONS: Partial<Record<InboxAction['kind'], {
  title: string; body: string; verb: string;
}>> = {
  'ignore-name': {
    title: 'סימון השם כלא-אדם',
    body: 'השם יוסר מהרשימה ולא ייספר יותר. אפשר להחזיר אותו בכל רגע.',
    verb: 'סימון כלא-אדם',
  },
  'split-name': {
    title: 'פיצול השם לשניים',
    body: 'השם הזה יוחלף בשני שמות חדשים שימתינו לשיוך. השורות שכבר נכתבו ימשיכו לשאת את הטקסט המקורי מהגיליון.',
    verb: 'פיצול',
  },
};

/** Hebrew, in the past tense, naming what actually happened (E2). */
function receipt(action: InboxAction): string {
  switch (action.kind) {
    case 'link-name': return action.label.replace('קישור ל', 'קושר ל');
    case 'new-person': return 'נוצר אדם חדש';
    case 'ignore-name': return 'השם סומן כלא-אדם';
    case 'split-name': return 'השם פוצל לשני שמות שממתינים לשיוך';
    case 'snooze': return 'הפריט נדחה לשבוע';
    default: return 'נשמר';
  }
}

/**
 * A first guess at how a two-name cell splits, offered for the lead to edit.
 *
 * It is a suggestion sitting in a field they must confirm, never a decision:
 * the separators are the ones the camp's sheets actually use, and a cell that
 * matches none of them simply arrives with the second field empty, which the
 * domain refuses until someone types a name into it.
 */
export function guessParts(alias: string): [string, string] {
  const pieces = alias
    .split(/\s*(?:\bו-|\+|&|,|\/)\s*/)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '');
  return [pieces[0] ?? alias.trim(), pieces[1] ?? ''];
}

export function ActionBar({
  itemId, actions, nextHref, alias = '',
}: {
  itemId: string;
  itemKind: InboxKind;
  actions: InboxAction[];
  nextHref: string | null;
  /** The raw workbook spelling, so a split can offer a first guess. */
  alias?: string;
}): ReactElement {
  const router = useRouter();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<InboxAction | null>(null);
  const [parts, setParts] = useState<[string, string]>(['', '']);

  const aliasId = itemId.startsWith('name:') ? itemId.slice('name:'.length) : itemId;

  function call(action: InboxAction, split: [string, string]): Promise<ActionResult> {
    switch (action.kind) {
      case 'link-name': return linkNameAction(aliasId, action.arg ?? '');
      case 'new-person': return promoteNameAction(aliasId);
      case 'ignore-name': return ignoreNameAction(aliasId);
      case 'split-name': return splitNameAction(aliasId, [split[0], split[1]]);
      case 'snooze': return snoozeItemAction(action.arg ?? itemId);
      default: return Promise.resolve({ ok: true });
    }
  }

  /**
   * The domain inverse, and only where one exists.
   *
   * `link-name` is reversed by **unlinking**, not by un-ignoring: nothing was
   * ignored, and an undo that calls the wrong inverse is a button that says
   * ביטול and does nothing. `unlinkAliasAction` also refuses a person's last
   * alias, which is why `new-person` — whose alias becomes the new person's
   * only one — is not undoable at all.
   */
  function reverse(action: InboxAction): (() => Promise<ActionResult>) | undefined {
    if (!action.undoable) return undefined;
    switch (action.kind) {
      case 'link-name':
        return async () => {
          const result = await unlinkAliasAction(aliasId);
          router.refresh();
          return result;
        };
      case 'ignore-name':
        return async () => {
          const result = await unignoreNameAction(aliasId);
          router.refresh();
          return result;
        };
      case 'snooze':
        return async () => {
          const result = await unsnoozeItemAction(action.arg ?? itemId);
          router.refresh();
          return result;
        };
      default: return undefined;
    }
  }

  function run(action: InboxAction, split: [string, string]): void {
    setConfirming(null);
    startTransition(async () => {
      const result = await call(action, split);
      if (!result.ok) {
        // The kit routes a `bad` toast to the assertive region. The message is
        // already Hebrew: the action boundary mapped it (R9, I3). A refusal is
        // never swallowed and the screen never advances past one.
        show({ message: result.error, tone: 'bad' });
        return;
      }
      const undo = reverse(action);
      show({
        message: receipt(action),
        tone: 'ok',
        ...(undo ? { undo: { label: 'ביטול', run: undo } } : {}),
      });
      // After each decision the next item opens by itself (D2).
      if (nextHref) router.push(nextHref);
      else router.refresh();
    });
  }

  function press(action: InboxAction): void {
    if (CONFIRMATIONS[action.kind] !== undefined) {
      if (action.kind === 'split-name') setParts(guessParts(alias));
      setConfirming(action);
      return;
    }
    run(action, parts);
  }

  const confirmation = confirming ? CONFIRMATIONS[confirming.kind] : undefined;

  return (
    <div className={styles.actions}>
      {actions.map((action, index) => (
        action.control === 'link' && action.href !== null ? (
          <ButtonLink
            key={`${action.kind}-${index}`}
            href={action.href}
            tone="default"
            size="sm"
          >
            {action.label}
          </ButtonLink>
        ) : (
          <button
            key={`${action.kind}-${index}`}
            /* The keyboard finds a control by this id and clicks it, so the
               digit and the pointer take one path (R10). */
            id={action.digit === null ? undefined : `inbox-action-${action.digit}`}
            type="button"
            className={styles.action}
            disabled={pending}
            onClick={() => press(action)}
          >
            {action.label}
            {action.digit === null ? null : <span className={styles.kbd}>{action.digit}</span>}
          </button>
        )
      ))}

      {confirming !== null && confirmation !== undefined ? (
        <ConfirmDialog
          title={confirmation.title}
          consequence={confirmation.body}
          confirmLabel={confirmation.verb}
          onCancel={() => setConfirming(null)}
          onConfirm={() => run(confirming, parts)}
        >
          {confirming.kind === 'split-name' ? (
            <div className={styles.splitFields}>
              <Field id="split-a" label="שם ראשון">
                <TextInput
                  id="split-a"
                  value={parts[0]}
                  onChange={(value) => setParts([value, parts[1]])}
                />
              </Field>
              <Field id="split-b" label="שם שני">
                <TextInput
                  id="split-b"
                  value={parts[1]}
                  onChange={(value) => setParts([parts[0], value])}
                />
              </Field>
            </div>
          ) : undefined}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
