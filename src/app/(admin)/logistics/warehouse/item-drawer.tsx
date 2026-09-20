'use client';

/**
 * The one form on this screen, in both of its modes: `item === null` adds a
 * row by hand, and an item edits that row. They are one component because
 * they are one set of fields with one set of refusals — two files would be two
 * places for the location rule to drift.
 *
 * A client component because a form is state: what has been typed, which
 * refusal is showing, and whether a save is in flight. The drawer itself is
 * still a URL (R6) — the page decides from `?peek=` / `?act=` that this is on
 * screen and hands it the record; no list and no filter lives here.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, Segmented, Select, TextInput, Textarea } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { SourceChip } from '@/components/ui/source-chip';
import { useToast } from '@/components/ui/toaster';
import { DateText } from '@/components/format';
import { isBlank } from '@/lib/text/normalize';
import type { WarehouseRow } from '@/lib/logistics/warehouse';
import { CATEGORY_LABELS, CONDITION_LABELS } from '@/lib/logistics/labels';
import type { ItemCondition, LogisticsCategory } from '@/db/schema/logistics';
import { createItemAction, updateItemAction } from './actions';
import { NAME_REQUIRED, LOCATION_REQUIRED } from './failure-messages';
import styles from './warehouse.module.css';

/** Which box a refusal belongs to, so it is announced beside its own field. */
type Refusal = { where: 'name' | 'location' | 'form'; message: string };

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as LogisticsCategory[])
  .map((value) => ({ value, label: CATEGORY_LABELS[value] }));

/**
 * `retired` is offered here and nowhere else in the form's order: it is the
 * end of an item's life, not a degree of disrepair, so it sits after the three
 * states that describe something still in service.
 */
const CONDITION_OPTIONS = (Object.keys(CONDITION_LABELS) as ItemCondition[])
  .map((value) => ({ value, label: CONDITION_LABELS[value] }));

export function ItemDrawer(
  { item, closeHref }: { item: WarehouseRow | null; closeHref: string },
) {
  const router = useRouter();
  const { show } = useToast();

  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState<LogisticsCategory>(item?.category ?? 'general');
  /* A string, not a number: an empty box is a state a `number` cannot hold,
     and coercing it on every keystroke would fight the lead while they clear
     it to type something else. */
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 0));
  const [location, setLocation] = useState(item?.locationText ?? '');
  const [condition, setCondition] = useState<ItemCondition>(item?.condition ?? 'ready');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  function errorFor(where: Refusal['where']): string | undefined {
    return refusal?.where === where ? refusal.message : undefined;
  }

  /* The event is optional because this is both the form's `onSubmit` (enter
     in a text box) and the footer button's `onClick`, and the kit's `Button`
     hands its handler no arguments. */
  async function save(event?: FormEvent) {
    event?.preventDefault();
    setRefusal(null);

    // The same two refusals the library makes, made here so a lead finds out
    // without a round trip — and in the same words, imported rather than
    // retyped.
    if (isBlank(name)) { setRefusal({ where: 'name', message: NAME_REQUIRED }); return; }
    if (isBlank(location)) { setRefusal({ where: 'location', message: LOCATION_REQUIRED }); return; }

    /* `Number('')` is 0, which is the right reading of an empty count box —
       "none", the fact. Anything unparseable stays NaN and is refused by the
       library, which is where the whole-number rule lives. */
    const parsed = Number(quantity.trim());

    const input = {
      name,
      category,
      quantity: parsed,
      locationText: location,
      condition,
      notes: isBlank(notes) ? null : notes,
    };

    setPending(true);
    try {
      const result = item === null
        ? await createItemAction(input)
        : await updateItemAction(item.id, input);

      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }

      show({
        message: item === null
          ? `${name.trim()} נוסף למחסן`
          : `${name.trim()} עודכן`,
        tone: 'ok',
      });
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const creating = item === null;

  return (
    <Drawer
      title={creating ? 'הוספת פריט למחסן' : item.name}
      subtitle={creating ? 'ציוד של הקאמפ, לא של שנה מסוימת' : (
        <>
          {'עודכן לאחרונה '}
          <DateText at={item.updatedAt} />
          {item.updatedBy === null ? null : <>{' · '}{item.updatedBy}</>}
        </>
      )}
      closeHref={closeHref}
      width={500}
      phone="full"
      footer={(
        <>
          <Button tone="primary" onClick={() => { void save(); }} disabled={pending}>
            {creating ? 'הוספת הפריט' : 'שמירה'}
          </Button>
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>ביטול</Button>
        </>
      )}
    >
      <form className={styles.form} onSubmit={save}>
        <Field id="item-name" label="שם הפריט" required error={errorFor('name')}>
          <TextInput id="item-name" value={name} onChange={setName} />
        </Field>

        <div className={styles.pair}>
          <Field id="item-category" label="קטגוריה">
            <Select
              id="item-category"
              value={category}
              onChange={(value) => { setCategory(value as LogisticsCategory); }}
              options={CATEGORY_OPTIONS}
            />
          </Field>

          <Field
            id="item-quantity"
            label="כמות"
            hint={<SourceChip source={{ kind: 'manual' }} />}
          >
            <input
              className={styles.plainInput}
              id="item-quantity"
              type="number" min="0" step="1" inputMode="numeric"
              value={quantity}
              onChange={(event) => { setQuantity(event.target.value); }}
            />
          </Field>
        </div>

        <Field
          id="item-location"
          label="מיקום במחסן"
          required
          error={errorFor('location')}
          hint="איפה זה מונח בפועל — ״ארגז גדול #2״, ״מאחורי המכולה״. בלי זה אי אפשר למצוא את הפריט בשנה הבאה."
        >
          <TextInput id="item-location" value={location} onChange={setLocation} />
        </Field>

        <Field id="item-condition" label="מצב הפריט" as="group">
          <Segmented
            id="item-condition"
            name="item-condition"
            options={CONDITION_OPTIONS}
            value={condition}
            onChange={(value) => { setCondition(value as ItemCondition); }}
          />
        </Field>

        <Field id="item-notes" label="הערות" hint="מה שכדאי לדעת לפני שלוקחים את זה מהמדף.">
          <Textarea id="item-notes" value={notes} onChange={setNotes} rows={3} />
        </Field>

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
      </form>
    </Drawer>
  );
}
