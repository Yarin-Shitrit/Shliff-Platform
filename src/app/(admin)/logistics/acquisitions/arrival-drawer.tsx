'use client';

/**
 * `הגיע למחסן — איפה אוחסן?`
 *
 * This is the screen's one real decision, and the reason the schema has an
 * `arrived_item_id` that nothing sets automatically. When something arrives
 * the system knows exactly one thing: it arrived. It does not know which box
 * it went into, what state it turned up in, or whether it is a new row in the
 * warehouse or more of something the camp already owns — and it does not
 * guess. It asks, here, and writes nothing until it has been told.
 *
 * A client component because the answers depend on each other: choosing
 * `פריט חדש` asks for a location, choosing `הוספה לפריט קיים` asks which row
 * instead.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, Segmented, Select, TextInput } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/banner';
import { useToast } from '@/components/ui/toaster';
import { Money } from '@/components/format';
import { formatShekels } from '@/lib/money';
import { isBlank } from '@/lib/text/normalize';
import type { AcquisitionRow } from '@/lib/logistics/acquisitions';
import { CONDITION_LABELS } from '@/lib/logistics/labels';
import type { ItemCondition } from '@/db/schema/logistics';
import { recordArrivalAction } from './actions';
import { REQUIRED_LOCATION } from './failure-messages';
import type { BudgetLineOption } from './acquisition-drawer';
import styles from './acquisitions.module.css';

export interface WarehouseOption { id: string; name: string; locationText: string | null; quantity: number }

type Refusal = { where: 'location' | 'existing' | 'quantity' | 'form'; message: string };

/**
 * `retired` is not offered. Nothing arrives at the camp already out of
 * service, and offering it here would turn a receiving question into an
 * invitation to file something away unseen.
 */
const RECEIVED_CONDITIONS: ItemCondition[] = ['ready', 'needs_testing', 'needs_repair'];

export function ArrivalDrawer({
  row, items, budgetLines, closeHref,
}: {
  row: AcquisitionRow;
  /** The whole warehouse, so "more of something we own" can be found. */
  items: readonly WarehouseOption[];
  budgetLines: readonly BudgetLineOption[];
  closeHref: string;
}) {
  const router = useRouter();
  const { show } = useToast();

  /* The default is `new` only when the warehouse holds nothing by this name.
     That is a reading of the data, not a guess about intent — and the hint
     under the control says which of the two it found, so a lead can see the
     reason and overrule it. */
  const sameName = items.filter((item) => item.name.trim() === row.name.trim());
  const [mode, setMode] = useState<'new' | 'existing'>(sameName.length > 0 ? 'existing' : 'new');
  const [existingId, setExistingId] = useState(sameName[0]?.id ?? '');
  const [location, setLocation] = useState('');
  const [condition, setCondition] = useState<ItemCondition>('ready');
  const [quantity, setQuantity] = useState(String(row.quantityNeeded));
  const [budgetLineId, setBudgetLineId] = useState(row.budgetLineId ?? '');
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  function errorFor(where: Refusal['where']): string | undefined {
    return refusal?.where === where ? refusal.message : undefined;
  }

  async function register(event?: FormEvent) {
    event?.preventDefault();
    setRefusal(null);

    const arriving = Number(quantity.trim());
    if (!Number.isInteger(arriving) || arriving < 1) {
      setRefusal({ where: 'quantity', message: 'הכמות שנכנסת למחסן חייבת להיות מספר שלם, אחד או יותר' });
      return;
    }
    if (mode === 'new' && isBlank(location)) {
      setRefusal({ where: 'location', message: REQUIRED_LOCATION }); return;
    }
    if (mode === 'existing' && isBlank(existingId)) {
      setRefusal({ where: 'existing', message: 'צריך לבחור לאיזה פריט במחסן זה מצטרף' }); return;
    }

    setPending(true);
    try {
      const result = await recordArrivalAction({
        acquisitionId: row.id,
        target: mode === 'new'
          ? { kind: 'new', locationText: location, condition }
          : { kind: 'existing', itemId: existingId },
        quantity: arriving,
        budgetLineId: isBlank(budgetLineId) ? null : budgetLineId,
      });

      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }

      show({ message: `${row.name} נרשם למחסן`, tone: 'ok' });
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      title="הגיע למחסן — איפה אוחסן?"
      subtitle={(
        <>
          {row.name}
          {' · '}
          <bdi>{`${row.quantityNeeded} יחידות`}</bdi>
          {row.actualAgorot === null ? null : <>{' · נרכש ב־'}<Money agorot={row.actualAgorot} /></>}
        </>
      )}
      closeHref={closeHref}
      width={500}
      phone="full"
      footer={(
        <>
          <Button tone="primary" onClick={() => { void register(); }} disabled={pending}>
            רישום למחסן
          </Button>
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>ביטול</Button>
        </>
      )}
    >
      <form className={styles.form} onSubmit={register}>
        <Banner
          tone="neutral"
          headline="המערכת לא יודעת איפה הנחתם את זה ובאיזה מצב זה הגיע."
          detail="היא גם לא תנחש. השאלות למטה הן מה שחסר כדי שזה ייכנס למחסן."
        />

        <Field
          id="arrival-mode"
          label="הפריט במחסן"
          as="group"
          hint={sameName.length > 0
            ? `במחסן כבר יש ${sameName.length === 1 ? 'פריט' : 'פריטים'} בשם הזה, ולכן ברירת המחדל היא הוספה לפריט קיים.`
            : `במחסן אין כרגע ${row.name}, ולכן ברירת המחדל היא פריט חדש.`}
        >
          <Segmented
            id="arrival-mode"
            name="arrival-mode"
            value={mode}
            onChange={(value) => { setMode(value as 'new' | 'existing'); }}
            options={[
              { value: 'new', label: 'פריט חדש', icon: 'plus' },
              { value: 'existing', label: 'הוספה לפריט קיים', icon: 'merge' },
            ]}
          />
        </Field>

        {mode === 'existing' ? (
          <Field
            id="arrival-existing"
            label="לאיזה פריט זה מצטרף"
            required
            error={errorFor('existing')}
          >
            <Select
              id="arrival-existing"
              value={existingId}
              emptyLabel="—"
              onChange={setExistingId}
              options={items.map((item) => ({
                value: item.id,
                label: item.locationText === null
                  ? `${item.name} (${item.quantity})`
                  : `${item.name} · ${item.locationText} (${item.quantity})`,
              }))}
            />
          </Field>
        ) : (
          <div className={styles.pair}>
            <Field
              id="arrival-location"
              label="מיקום במחסן"
              required
              error={errorFor('location')}
              hint="חובה — בלי מיקום אי אפשר למצוא את זה בשנה הבאה."
            >
              <TextInput id="arrival-location" value={location} onChange={setLocation} />
            </Field>

            <Field id="arrival-quantity" label="כמות שנכנסת" required error={errorFor('quantity')}>
              <input
                className={styles.plainInput}
                id="arrival-quantity"
                type="number" min="1" step="1" inputMode="numeric"
                value={quantity}
                onChange={(event) => { setQuantity(event.target.value); }}
              />
            </Field>
          </div>
        )}

        {mode === 'existing' && (
          <Field id="arrival-quantity-merge" label="כמות שנכנסת" required error={errorFor('quantity')}>
            <input
              className={styles.plainInput}
              id="arrival-quantity-merge"
              type="number" min="1" step="1" inputMode="numeric"
              value={quantity}
              onChange={(event) => { setQuantity(event.target.value); }}
            />
          </Field>
        )}

        {mode === 'new' && (
          <Field id="arrival-condition" label="מצב הפריט בקבלה" as="group">
            <Segmented
              id="arrival-condition"
              name="arrival-condition"
              value={condition}
              onChange={(value) => { setCondition(value as ItemCondition); }}
              options={RECEIVED_CONDITIONS.map((value) => ({
                value, label: CONDITION_LABELS[value],
              }))}
            />
          </Field>
        )}

        <Field
          id="arrival-budget"
          label="סעיף תקציב"
          hint={row.actualAgorot === null
            ? 'בלי סעיף, ההוצאה תיספר ברכש אבל לא בתקציב הקאמפ.'
            : `בלי סעיף, ${formatShekels(row.actualAgorot)} ייספרו ברכש אבל לא בתקציב הקאמפ.`}
        >
          <Select
            id="arrival-budget"
            value={budgetLineId}
            emptyLabel="ללא שיוך לתקציב"
            onChange={setBudgetLineId}
            options={budgetLines.map((line) => ({
              value: line.id,
              label: `${line.label} — ${formatShekels(line.totalAgorot)}`,
            }))}
          />
        </Field>

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
      </form>
    </Drawer>
  );
}
