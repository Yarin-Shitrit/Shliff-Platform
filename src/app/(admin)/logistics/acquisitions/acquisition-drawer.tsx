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
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Checkbox, Field, MoneyInput, Select, TextInput } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/banner';
import { useToast } from '@/components/ui/toaster';
import { isBlank } from '@/lib/text/normalize';
import { formatShekels } from '@/lib/money';
import { Money } from '@/components/format';
import { typedEstimate } from '@/lib/logistics/estimate';
import type { AcquisitionRow } from '@/lib/logistics/acquisitions';
import { CAMP_WIDE_LABEL, CATEGORY_LABELS, SOURCE_LABELS } from '@/lib/logistics/labels';
import { itemHref as planItemHref, PLAN_PATH } from '@/lib/logistics/plan-views';
import type {
  AcquisitionSource, LogisticsCategory,
} from '@/db/schema/logistics';
import { createAcquisitionAction, updateAcquisitionAction } from './actions';
import { REQUIRED_NAME, REQUIRED_QUANTITY, REQUIRED_LENDER } from './failure-messages';
import styles from './acquisitions.module.css';

export interface PersonOption { id: string; name: string }
export interface BudgetLineOption { id: string; label: string; totalAgorot: number }
/** An active topic on the season's work plan, for where the new line goes. */
export interface TopicOption { id: string; name: string }

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
  row, seasonId, seasonName, people, budgetLines, topics, closeHref,
}: {
  row: AcquisitionRow | null;
  seasonId: string;
  seasonName: string;
  people: readonly PersonOption[];
  budgetLines: readonly BudgetLineOption[];
  topics: readonly TopicOption[];
  closeHref: string;
}) {
  const router = useRouter();
  const { show } = useToast();

  const [name, setName] = useState(row?.name ?? '');
  const [category, setCategory] = useState<LogisticsCategory>(row?.category ?? 'general');
  const [quantity, setQuantity] = useState(String(row?.quantityNeeded ?? 1));
  const [source, setSource] = useState<AcquisitionSource>(row?.source ?? 'buy_new');
  const [estimate, setEstimate] = useState(amountValue(row?.unitEstimateAgorot ?? null));
  const [actual, setActual] = useState(amountValue(row?.actualAgorot ?? null));
  const [assignee, setAssignee] = useState(row?.assignee?.id ?? '');
  const [lender, setLender] = useState(row?.lender?.id ?? '');
  const [budgetLineId, setBudgetLineId] = useState(row?.budgetLineId ?? '');
  /* Where the new row's line goes on the work plan. Only a new row asks:
     an existing line is moved between topics on the board itself. */
  const [topicId, setTopicId] = useState('');
  /* A new row starts as this season's; only an explicit tick makes it
     camp-wide. An existing row keeps whichever it already is. */
  const [campWide, setCampWide] = useState(row !== null && row.seasonId === null);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const borrowed = source === 'borrow_member';
  /* The row's estimate, as the two boxes stand right now. Null while either
     cannot be read — then nothing is shown rather than a total of a guess. */
  const product = typedEstimate(estimate, quantity);

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
      seasonId: campWide ? null : seasonId,
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
        ? await createAcquisitionAction(input, { seasonId, topicId: isBlank(topicId) ? null : topicId })
        : await updateAcquisitionAction(row.id, input);

      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }

      show({ message: row === null ? `${name.trim()} נוסף לרשימת הרכש וללוח העבודה` : `${name.trim()} עודכן`, tone: 'ok' });
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
      subtitle={campWide ? `${CAMP_WIDE_LABEL} · לא משויך לשנה` : seasonName}
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

        <Field
          id="acq-camp-wide"
          label="שיוך לשנה"
          hint={campWide
            ? 'יופיע ברשימת הרכש של כל שנה, עד שיגיע. מתאים לדבר שהקאמפ צריך בכל ברן.'
            : `שייך ל${seasonName} בלבד. סימון התיבה הופך אותו לכלל־קאמפי — צורך של כל ברן, לא רק של השנה הזו.`}
        >
          <Checkbox
            id="acq-camp-wide"
            label="לא שייך לברן מסוים"
            checked={campWide}
            onChange={setCampWide}
          />
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
            label="מחיר ליחידה (אומדן)"
            hint="כמה אחד כזה אמור לעלות — את ההכפלה בכמות המערכת עושה. ריק פירושו שעוד לא תמחרו — לא שזה בחינם."
          >
            <MoneyInput id="acq-estimate" value={estimate} onChange={setEstimate} />
          </Field>

          <Field
            id="acq-actual"
            label="בפועל"
            hint="כמה שולם בסוף על כל הכמות — הסכום שבקבלה, לא מחיר ליחידה. ריק פירושו שעוד לא נקנה."
          >
            <MoneyInput id="acq-actual" value={actual} onChange={setActual} />
          </Field>
        </div>

        {product !== null && (
          <p className={styles.formTotal} aria-live="polite">
            {'אומדן לכל הכמות: '}
            <strong><Money agorot={product.totalAgorot} /></strong>
            {' · '}
            <bdi>{product.quantity}{' × '}<Money agorot={product.unitAgorot} /></bdi>
          </p>
        )}

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

        {creating ? (
          <Field
            id="acq-topic"
            label="נושא בלוח העבודה"
            hint={`הפריט נוצר גם כמשימה בלוח העבודה של ${seasonName} — ״לקנות…״ — ושם קובעים לה ימים וסדר. הנושא אומר תחת איזו כותרת היא תופיע.`}
          >
            <Select
              id="acq-topic"
              value={topicId}
              emptyLabel="בלי נושא"
              onChange={setTopicId}
              options={topics.map((topic) => ({ value: topic.id, label: topic.name }))}
            />
          </Field>
        ) : row.workItem !== null ? (
          <Banner
            tone="neutral"
            headline="יש לפריט הזה משימה בלוח העבודה."
            detail="השם, האחראי וההשלמה שלה נקבעים כאן; הימים, הנושא והסדר נקבעים בלוח."
            action={{ label: 'פתיחה בלוח', href: planItemHref({ season: row.workItem.seasonId }, row.workItem.id) }}
          />
        ) : (
          <p className={styles.formHint}>
            {'לפריט הזה אין משימה בלוח העבודה — הוא נכנס לפני שהשניים חוברו. אפשר '}
            <Link href={PLAN_PATH}>להוסיף משימה בלוח</Link>
            {' כרגיל.'}
          </p>
        )}

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
