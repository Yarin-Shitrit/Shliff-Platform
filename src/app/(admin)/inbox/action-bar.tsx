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
import { Field, TextInput, Select } from '@/components/ui/field';
import {
  ignoreNameAction, unignoreNameAction,
  snoozeItemAction, unsnoozeItemAction, splitNameAction,
  setSeasonAction, setAuthorityAction,
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
    case 'set-authority': return action.label.replace('בחירת ', 'נבחר ').replace(' כמוסמך', ' כעותק הקובע');
    case 'set-season': return 'השנה של הגיליון נשמרה';
    default: return 'נשמר';
  }
}

/**
 * What a writing control says when nothing on this screen is wired to it.
 *
 * Before this existed the bar answered every unknown kind with `{ ok: true }`,
 * toasted «נשמר» and opened the next item — the lead "decided" the two
 * colliding budget sheets twice and the database never heard of it. A
 * control that writes nothing must say so; a control that writes nothing
 * *and* claims success is the silent default the product forbids.
 */
const NOT_WIRED = 'הפעולה הזאת עדיין לא מחוברת למסך — שום דבר לא נשמר';
const NO_SEASON_CHOSEN = 'צריך לבחור שנה לפני השמירה';

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
  itemId, actions, nextHref, alias = '', seasons = [],
}: {
  itemId: string;
  itemKind: InboxKind;
  actions: InboxAction[];
  nextHref: string | null;
  /** The raw workbook spelling, so a split can offer a first guess. */
  alias?: string;
  /** Every season the camp has, for a `set-season` control's select. */
  seasons?: ReadonlyArray<{ id: string; name: string }>;
}): ReactElement {
  const router = useRouter();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<InboxAction | null>(null);
  const [parts, setParts] = useState<[string, string]>(['', '']);
  const [season, setSeason] = useState('');

  const aliasId = itemId.startsWith('name:') ? itemId.slice('name:'.length) : itemId;

  function call(action: InboxAction, split: [string, string]): Promise<ActionResult> {
    switch (action.kind) {
      case 'link-name': return linkNameAction(aliasId, action.arg ?? '');
      case 'new-person': return promoteNameAction(aliasId);
      case 'ignore-name': return ignoreNameAction(aliasId);
      case 'split-name': return splitNameAction(aliasId, [split[0], split[1]]);
      case 'snooze': return snoozeItemAction(action.arg ?? itemId);
      // W13: the pressed copy becomes the one authoritative one; `arg` is its
      // sheet id. The domain refuses a copy with no season, in Hebrew.
      case 'set-authority': return setAuthorityAction(action.arg ?? '', true);
      // W10: the season is the one chosen in the select, never inferred.
      case 'set-season':
        if (season === '') return Promise.resolve({ ok: false, error: NO_SEASON_CHOSEN });
        return setSeasonAction(action.arg ?? '', season);
      default:
        // `skip` and its kin write nothing and only move on. Anything that
        // claims to write and reaches here is a control nobody wired up.
        return Promise.resolve(action.writes ? { ok: false, error: NOT_WIRED } : { ok: true });
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
      // The inverse of choosing a copy is clearing the choice, not choosing
      // the other one; the inverse of giving a sheet its season is taking it
      // back, which also clears its authority (`setSheetSeason`).
      case 'set-authority':
        return async () => {
          const result = await setAuthorityAction(action.arg ?? '', null);
          router.refresh();
          return result;
        };
      case 'set-season':
        return async () => {
          const result = await setSeasonAction(action.arg ?? '', null);
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
      // A control that writes nothing has nothing to report (E2 names what
      // happened, and «נשמר» after a skip names something that did not).
      if (action.writes) {
        const undo = reverse(action);
        show({
          message: receipt(action),
          tone: 'ok',
          ...(undo ? { undo: { label: 'ביטול', run: undo } } : {}),
        });
      }
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
        ) : action.control === 'select' ? (
          // A select is a choice plus a save: the choice alone writes nothing,
          // and a bare button labelled «בחירת עונה» chose nothing at all.
          <span key={`${action.kind}-${index}`} className={styles.selectAction}>
            <Field id={`inbox-select-${index}`} label={action.label}>
              <Select
                id={`inbox-select-${index}`}
                emptyLabel={action.label}
                options={seasons.map((s) => ({ value: s.id, label: s.name }))}
                value={season}
                onChange={setSeason}
                disabled={pending}
              />
            </Field>
            <button
              type="button"
              className={styles.action}
              disabled={pending}
              onClick={() => press(action)}
            >
              שמירה
            </button>
          </span>
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
