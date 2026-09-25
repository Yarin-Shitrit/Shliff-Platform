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
 *
 * Built for a thumb. The screen this drawer matters most on is a phone held
 * in the storage container while gear is counted in: the count is a −/+
 * stepper, the boxes already in use are one-tap chips under the location box,
 * and the create form can stay open for the next item instead of dropping the
 * lead back to the list after every one.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Checkbox, Field, Segmented, Select, TextInput, Textarea } from '@/components/ui/field';
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

const NAME_ID = 'item-name';

/**
 * The stepper's reading of the box. `Number('')` is 0 — "none", the fact —
 * and anything unparseable is treated as 0 here so a press on + after a typo
 * gives 1 rather than NaN; the typo itself is still refused on save, where the
 * whole-number rule lives.
 */
function countOf(quantity: string): number {
  const parsed = Number(quantity.trim());
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export type ItemDrawerProps = {
  item: WarehouseRow | null;
  closeHref: string;
  /**
   * The locations already stored, most-used first (`frequentLocations`),
   * offered as chips under the location box. Empty on a fresh warehouse, and
   * then no chip row is drawn at all.
   */
  locations?: readonly string[];
};

export function ItemDrawer({ item, closeHref, locations = [] }: ItemDrawerProps) {
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
  /*
   * The lead's choice, not the system's: off until ticked, and it stays ticked
   * for as long as the drawer is open, because "add another" is a decision
   * about the next twenty minutes in the container, not about one item.
   */
  const [again, setAgain] = useState(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  function errorFor(where: Refusal['where']): string | undefined {
    return refusal?.where === where ? refusal.message : undefined;
  }

  function step(delta: number) {
    setQuantity(String(Math.max(0, countOf(quantity) + delta)));
  }

  /**
   * After an add that stays open: the fields that describe *this* item are
   * cleared; the category and the location are kept, because the next item
   * out of the same box is the common case and the checkbox's own label says
   * that this is what it does. Nothing here is a guess the lead did not ask
   * for. Focus goes back to the name — the first thing to type — through the
   * id the kit's `TextInput` already carries, since it forwards no ref.
   */
  function resetForNext() {
    setName('');
    setQuantity('0');
    setNotes('');
    setCondition('ready');
    document.getElementById(NAME_ID)?.focus();
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

      if (item === null && again) {
        /* The list under the drawer shows the new row, and the form is ready
           for the next one. The URL does not change: the drawer is still
           `?act=item`, which is exactly what is on screen. */
        router.refresh();
        resetForNext();
        return;
      }

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
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>
            {creating && again ? 'סיום' : 'ביטול'}
          </Button>
        </>
      )}
    >
      <form className={styles.form} onSubmit={save}>
        <Field id={NAME_ID} label="שם הפריט" required error={errorFor('name')}>
          <TextInput id={NAME_ID} value={name} onChange={setName} />
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
            {/*
              A `Field` clones its one child with the aria wiring, so the
              stepper is one element and the number box inside it gets the
              `id`. The −/+ buttons are named in words, not just glyphs: a
              screen reader reads "פחות אחד", never "minus".
            */}
            <span className={styles.stepper}>
              <button
                type="button"
                className={styles.step}
                aria-label="פחות אחד"
                disabled={pending || countOf(quantity) === 0}
                onClick={() => { step(-1); }}
              >
                −
              </button>
              <input
                className={styles.plainInput}
                id="item-quantity"
                type="number" min="0" step="1" inputMode="numeric"
                value={quantity}
                onChange={(event) => { setQuantity(event.target.value); }}
              />
              <button
                type="button"
                className={styles.step}
                aria-label="עוד אחד"
                disabled={pending}
                onClick={() => { step(1); }}
              >
                +
              </button>
            </span>
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
        {locations.length === 0 ? null : (
          /*
            The boxes already in use, one tap each, exactly as stored — so the
            next item lands under the same spelling as the last and a search
            for the box keeps finding everything in it. `aria-pressed` marks
            the one the box currently says; tapping it again clears the box,
            the way a filter chip toggles.
          */
          <div className={styles.suggestions} role="group" aria-label="מיקומים שכבר בשימוש">
            {locations.map((suggestion) => {
              const pressed = suggestion === location.trim();
              return (
                <button
                  key={suggestion}
                  type="button"
                  className={styles.suggestion}
                  aria-pressed={pressed}
                  disabled={pending}
                  onClick={() => { setLocation(pressed ? '' : suggestion); }}
                >
                  {suggestion}
                </button>
              );
            })}
          </div>
        )}

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

        {creating ? (
          <div className={styles.again}>
            <Checkbox
              id="item-again"
              label="אחרי ההוספה להישאר כאן ולהוסיף עוד פריט (הקטגוריה והמיקום נשמרים)"
              checked={again}
              onChange={setAgain}
              disabled={pending}
            />
          </div>
        ) : null}

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
      </form>
    </Drawer>
  );
}
