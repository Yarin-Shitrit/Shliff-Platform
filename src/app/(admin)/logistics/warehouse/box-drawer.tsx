'use client';

/**
 * The drawer over a box, in both of its modes: `box === null` adds one, and
 * a box edits it and lists what is in it. One component for the reason the
 * item drawer is one: one set of fields, one set of refusals.
 *
 * A box is a place with a name. The form is the two of those and a note; the
 * list under it is the reason a box exists at all — "what is in the blue
 * box" answered without opening it. Every row is a link to the item's own
 * drawer (R6: a drawer is a URL), and the link at the foot opens the create
 * drawer with this box already chosen, so filling a box is one tap per item.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, TextInput, Textarea } from '@/components/ui/field';
import { Button, ButtonLink } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toaster';
import { DateText } from '@/components/format';
import { isBlank } from '@/lib/text/normalize';
import type { BoxRow } from '@/lib/logistics/boxes';
import { CONDITION_LABELS, CONDITION_TONES } from '@/lib/logistics/labels';
import type { ItemCondition } from '@/db/schema/logistics';
import { boxHref, itemHref, newItemInBoxHref, type RawParams } from '@/lib/logistics/warehouse-views';
import { createBoxAction, updateBoxAction } from './actions';
import { BOX_NAME_REQUIRED, BOX_LOCATION_REQUIRED } from './failure-messages';
import styles from './warehouse.module.css';

type Refusal = { where: 'name' | 'location' | 'form'; message: string };

/** One row of the contents list. Plain data, because it crosses from the
 *  page (a Server Component) into this client one. */
export type BoxItem = {
  id: string;
  name: string;
  quantity: number;
  condition: ItemCondition;
};

export type BoxDrawerProps = {
  box: BoxRow | null;
  /** What the box holds. Ignored while creating — there is nothing yet. */
  items?: readonly BoxItem[];
  closeHref: string;
  /** The page's URL params, so every link out of here keeps the list's
   *  filters underneath it, the way every other href on the screen does. */
  params: RawParams;
};

const NAME_ID = 'box-name';

export function BoxDrawer({ box, items = [], closeHref, params }: BoxDrawerProps) {
  const router = useRouter();
  const { show } = useToast();

  const [name, setName] = useState(box?.name ?? '');
  const [location, setLocation] = useState(box?.locationText ?? '');
  const [notes, setNotes] = useState(box?.notes ?? '');
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  function errorFor(where: Refusal['where']): string | undefined {
    return refusal?.where === where ? refusal.message : undefined;
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setRefusal(null);

    // The same two refusals the library makes, in the same words, so a lead
    // finds out without a round trip.
    if (isBlank(name)) { setRefusal({ where: 'name', message: BOX_NAME_REQUIRED }); return; }
    if (isBlank(location)) { setRefusal({ where: 'location', message: BOX_LOCATION_REQUIRED }); return; }

    const input = { name, locationText: location, notes: isBlank(notes) ? null : notes };

    setPending(true);
    try {
      if (box === null) {
        const result = await createBoxAction(input);
        if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
        show({ message: `הארגז ${name.trim()} נוסף למחסן`, tone: 'ok' });
        /* Straight into the new box rather than back to the list: the next
           thing a lead does with a box they just made is put something in it,
           and the drawer over it has the link for that. `value` is typed
           optional on every action result; this one always sets it, and the
           fallback is the list rather than a drawer over nothing. */
        router.push(result.value === undefined ? closeHref : boxHref(params, result.value));
        router.refresh();
        return;
      }

      const result = await updateBoxAction(box.id, input);
      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
      show({ message: `הארגז ${name.trim()} עודכן`, tone: 'ok' });
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const creating = box === null;

  return (
    <Drawer
      title={creating ? 'הוספת ארגז למחסן' : box.name}
      subtitle={creating ? 'מקום אחד, שם אחד — והפריטים שבתוכו לא צריכים מיקום משלהם' : (
        <>
          {'עודכן לאחרונה '}
          <DateText at={box.updatedAt} />
          {box.updatedBy === null ? null : <>{' · '}{box.updatedBy}</>}
        </>
      )}
      closeHref={closeHref}
      width={500}
      phone="full"
      footer={(
        <>
          <Button tone="primary" onClick={() => { void save(); }} disabled={pending}>
            {creating ? 'הוספת הארגז' : 'שמירה'}
          </Button>
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>
            ביטול
          </Button>
        </>
      )}
    >
      <form className={styles.form} onSubmit={save}>
        <Field id={NAME_ID} label="שם הארגז" required error={errorFor('name')} hint="כמו שכתוב על הארגז עצמו — ״ארגז כחול #1״.">
          <TextInput id={NAME_ID} value={name} onChange={setName} />
        </Field>

        <Field
          id="box-location"
          label="מיקום הארגז במחסן"
          required
          error={errorFor('location')}
          hint="איפה הארגז מונח בפועל — ״מדף עליון״, ״מאחורי המכולה״. כל פריט שבתוכו יימצא דרך זה."
        >
          <TextInput id="box-location" value={location} onChange={setLocation} />
        </Field>

        <Field id="box-notes" label="הערות">
          <Textarea id="box-notes" value={notes} onChange={setNotes} rows={2} />
        </Field>

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
      </form>

      {creating ? null : (
        /*
          The contents. A section rather than a table: a box holds a handful,
          and on a phone each row is the item's name, its count and its state,
          all of which fit on one line. The count is the page's `itemCount`
          — the same number the boxes strip shows — never `items.length`.
        */
        <section className={styles.contents} aria-labelledby="box-contents-heading">
          <h3 id="box-contents-heading" className={styles.contentsHeading}>
            {box.itemCount === 0 ? 'הארגז ריק' : `בארגז · ${box.itemCount} פריטים`}
          </h3>
          {items.length === 0 ? (
            <p className={styles.contentsEmpty}>
              עדיין לא רשום כאן כלום. פריט שנוסף לארגז הזה לא צריך מיקום משלו.
            </p>
          ) : (
            <ul className={styles.contentsList}>
              {items.map((item) => (
                <li key={item.id} className={styles.contentsRow}>
                  <Link href={itemHref(params, item.id)} className="nm">{item.name}</Link>
                  <span className={styles.contentsCount}>{item.quantity}</span>
                  {/* R3: the word carries the state; the tone decorates it. */}
                  <Pill tone={CONDITION_TONES[item.condition]} dot>
                    {CONDITION_LABELS[item.condition]}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
          <ButtonLink size="sm" href={newItemInBoxHref(params, box.id)}>
            <Icon name="plus" size={14} />
            הוספת פריט לארגז
          </ButtonLink>
        </section>
      )}
    </Drawer>
  );
}
