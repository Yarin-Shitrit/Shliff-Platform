'use client';

/**
 * The row form, in both modes: `row === null` adds something the camp needs,
 * a row edits it. One component for one set of fields and one set of
 * refusals, exactly as the warehouse's `ItemDrawer` is.
 *
 * A client component because which fields exist depends on what is chosen:
 * picking `השאלה מחבר קאמפ` makes the lender mandatory and takes the price
 * fields out of the foreground, and that is state.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, MoneyInput, Select, TextInput } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/banner';
import { useToast } from '@/components/ui/toaster';
import { isBlank } from '@/lib/text/normalize';
import { formatShekels } from '@/lib/money';
import type { AcquisitionRow } from '@/lib/logistics/acquisitions';
import { CATEGORY_LABELS, SOURCE_LABELS } from '@/lib/logistics/labels';
import type {
  AcquisitionSource, LogisticsCategory,
} from '@/db/schema/logistics';
import { createAcquisitionAction, updateAcquisitionAction } from './actions';
import { REQUIRED_NAME, REQUIRED_QUANTITY, REQUIRED_LENDER } from './failure-messages';
import styles from './acquisitions.module.css';

export interface PersonOption { id: string; name: string }
export interface BudgetLineOption { id: string; label: string; totalAgorot: number }

type Refusal = { where: 'name' | 'quantity' | 'lender' | 'form'; message: string };

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as LogisticsCategory[])
  .map((value) => ({ value, label: CATEGORY_LABELS[value] }));

const SOURCE_OPTIONS = (Object.keys(SOURCE_LABELS) as AcquisitionSource[])
  .map((value) => ({ value, label: SOURCE_LABELS[value] }));

/** Agorot back to the string a `MoneyInput` shows; null stays empty. */
function amountValue(agorot: number | null): string {
  return agorot === null ? '' : String(agorot / 100);
}

export function AcquisitionDrawer({
  row, seasonId, seasonName, people, budgetLines, closeHref,
}: {
  row: AcquisitionRow | null;
  seasonId: string;
  seasonName: string;
  people: readonly PersonOption[];
  budgetLines: readonly BudgetLineOption[];
  closeHref: string;
}) {
  const router = useRouter();
  const { show } = useToast();

  const [name, setName] = useState(row?.name ?? '');
  const [category, setCategory] = useState<LogisticsCategory>(row?.category ?? 'general');
  const [quantity, setQuantity] = useState(String(row?.quantityNeeded ?? 1));
  const [source, setSource] = useState<AcquisitionSource>(row?.source ?? 'buy_new');
  const [estimate, setEstimate] = useState(amountValue(row?.estimatedAgorot ?? null));
  const [actual, setActual] = useState(amountValue(row?.actualAgorot ?? null));
  const [assignee, setAssignee] = useState(row?.assignee?.id ?? '');
  const [lender, setLender] = useState(row?.lender?.id ?? '');
  const [budgetLineId, setBudgetLineId] = useState(row?.budgetLineId ?? '');
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const borrowed = source === 'borrow_member';

  function errorFor(where: Refusal['where']): string | undefined {
    return refusal?.where === where ? refusal.message : undefined;
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setRefusal(null);

    if (isBlank(name)) { setRefusal({ where: 'name', message: REQUIRED_NAME }); return; }

    const needed = Number(quantity.trim());
    if (!Number.isInteger(needed) || needed < 1) {
      setRefusal({ where: 'quantity', message: REQUIRED_QUANTITY }); return;
    }
    if (borrowed && isBlank(lender)) {
      setRefusal({ where: 'lender', message: REQUIRED_LENDER }); return;
    }

    const input = {
      name,
      category,
      quantityNeeded: needed,
      source,
      estimatedCost: isBlank(estimate) ? null : estimate,
      actualCost: isBlank(actual) ? null : actual,
      assigneePersonId: isBlank(assignee) ? null : assignee,
      lenderPersonId: borrowed && !isBlank(lender) ? lender : null,
      budgetLineId: isBlank(budgetLineId) ? null : budgetLineId,
    };

    setPending(true);
    try {
      const result = row === null
        ? await createAcquisitionAction(seasonId, input)
        : await updateAcquisitionAction(row.id, input);

      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }

      show({ message: row === null ? `${name.trim()} נוסף לרשימת הרכש` : `${name.trim()} עודכן`, tone: 'ok' });
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const creating = row === null;

  return (
    <Drawer
      title={creating ? 'הוספת פריט לרכש' : row.name}
      subtitle={seasonName}
      closeHref={closeHref}
      width={500}
      phone="full"
      footer={(
        <>
          <Button tone="primary" onClick={() => { void save(); }} disabled={pending}>
            {creating ? 'הוספה לרכש' : 'שמירה'}
          </Button>
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>ביטול</Button>
        </>
      )}
    >
      <form className={styles.form} onSubmit={save}>
        <Field id="acq-name" label="מה צריך" required error={errorFor('name')}>
          <TextInput id="acq-name" value={name} onChange={setName} />
        </Field>

        <div className={styles.pair}>
          <Field id="acq-category" label="קטגוריה">
            <Select
              id="acq-category"
              value={category}
              onChange={(value) => { setCategory(value as LogisticsCategory); }}
              options={CATEGORY_OPTIONS}
            />
          </Field>

          <Field id="acq-quantity" label="כמה צריך" required error={errorFor('quantity')}>
            <input
              className={styles.plainInput}
              id="acq-quantity"
              type="number" min="1" step="1" inputMode="numeric"
              value={quantity}
              onChange={(event) => { setQuantity(event.target.value); }}
            />
          </Field>
        </div>

        <Field id="acq-source" label="דרך ההשגה">
          <Select
            id="acq-source"
            value={source}
            onChange={(value) => { setSource(value as AcquisitionSource); }}
            options={SOURCE_OPTIONS}
          />
        </Field>

        {borrowed && (
          <Field
            id="acq-lender"
            label="ממי משאילים"
            required
            error={errorFor('lender')}
            hint="בלי שם, בסוף הברן יש חפץ ואין למי להחזיר אותו."
          >
            <Select
              id="acq-lender"
              value={lender}
              emptyLabel="—"
              onChange={setLender}
              options={people.map((person) => ({ value: person.id, label: person.name }))}
            />
          </Field>
        )}

        <div className={styles.pair}>
          <Field
            id="acq-estimate"
            label="אומדן"
            hint="כמה זה אמור לעלות. ריק פירושו שעוד לא תמחרו — לא שזה בחינם."
          >
            <MoneyInput id="acq-estimate" value={estimate} onChange={setEstimate} />
          </Field>

          <Field
            id="acq-actual"
            label="בפועל"
            hint="כמה זה עלה בסוף. ריק פירושו שעוד לא נקנה."
          >
            <MoneyInput id="acq-actual" value={actual} onChange={setActual} />
          </Field>
        </div>

        <Field
          id="acq-assignee"
          label="מי אחראי להשיג"
          hint="אפשר להשאיר ריק — פריט בלי אחראי הוא מצב אמיתי בתחילת שנה, והוא נראה ברשימה."
        >
          <Select
            id="acq-assignee"
            value={assignee}
            emptyLabel="אין אחראי עדיין"
            onChange={setAssignee}
            options={people.map((person) => ({ value: person.id, label: person.name }))}
          />
        </Field>

        <Field
          id="acq-budget"
          label="סעיף תקציב"
          hint="בלי סעיף, ההוצאה נספרת כאן אבל לא בתקציב הקאמפ."
        >
          <Select
            id="acq-budget"
            value={budgetLineId}
            emptyLabel="ללא שיוך לתקציב"
            onChange={setBudgetLineId}
            /* `formatShekels`, never `${formatILS(x)} ₪` — money.ts forbids
               composing the sign at a call site, and an <option> cannot hold
               the <bdi> that <Money> would bring. */
            options={budgetLines.map((line) => ({
              value: line.id,
              label: `${line.label} — ${formatShekels(line.totalAgorot)}`,
            }))}
          />
        </Field>

        {row !== null && row.arrivedItemId !== null && (
          <Banner
            tone="info"
            headline="הפריט הזה כבר נרשם במחסן."
            detail="שינוי הכמות כאן לא משנה את מה שיש על המדף — הכמות במחסן נערכת במסך המחסן."
          />
        )}

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
      </form>
    </Drawer>
  );
}
