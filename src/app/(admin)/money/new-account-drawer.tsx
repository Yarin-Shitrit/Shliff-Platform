'use client';

/**
 * A new place money sits, with what it holds today.
 *
 * The one decision the system cannot make is whether the figure typed is a
 * *count* — what the account holds as of a day, with everything before it
 * already inside — or an *opening* that every movement builds on. Both are
 * the same number in the same box, so the drawer asks, in one checkbox,
 * and says in a sentence what each answer does.
 *
 * No holder picker: a personal account's holder is linked from the person's
 * side, and `AccountCard` already copes with a personal account whose
 * holder is not linked yet. The kinds are the schema's four, labelled by
 * the same table the card uses.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, MoneyInput, TextInput, Select, Checkbox } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toaster';
import type { AccountKind } from '@/db/schema/money';
import { ACCOUNT_KIND_LABELS } from '@/lib/money/labels';
import { isBlank } from '@/lib/text/normalize';
import { createAccountAction } from './actions';
import styles from './money.module.css';

type Refusal = { where: 'name' | 'amount' | 'date' | 'form'; message: string };

const KIND_OPTIONS = (Object.keys(ACCOUNT_KIND_LABELS) as AccountKind[])
  .map((kind) => ({ value: kind, label: ACCOUNT_KIND_LABELS[kind] }));

function todayInput(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' })
    .formatToParts(new Date());
  const of = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${of('year')}-${of('month')}-${of('day')}`;
}

export function NewAccountDrawer({ closeHref }: { closeHref: string }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('cash');
  const [amount, setAmount] = useState('');
  const [counted, setCounted] = useState(true);
  const [countedOn, setCountedOn] = useState(todayInput());
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const parsed = amount.trim() === '' ? 0 : Number(amount.trim());

  async function save() {
    setRefusal(null);
    if (isBlank(name)) {
      setRefusal({ where: 'name', message: 'לחשבון חייב להיות שם' });
      return;
    }
    if (!Number.isFinite(parsed)) {
      setRefusal({ where: 'amount', message: 'הסכום שהוזן אינו מספר. הקלידו סכום בשקלים.' });
      return;
    }
    if (counted && countedOn.trim() === '') {
      setRefusal({ where: 'date', message: 'צריך לבחור את היום שבו נספר הכסף.' });
      return;
    }

    setPending(true);
    try {
      const result = await createAccountAction({
        name, kind, balance: parsed, countedOn: counted ? countedOn : undefined,
      });
      if (!result.ok) {
        setRefusal({ where: 'form', message: result.error });
        return;
      }
      toast.show({ message: `החשבון ${name.trim()} נוסף.` });
      router.replace(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) { event.preventDefault(); save(); }

  return (
    <Drawer
      title="חשבון חדש"
      subtitle="מקום שבו יושב כסף של הקאמפ"
      closeHref={closeHref}
      footer={(
        <Button tone="primary" disabled={pending} onClick={save}>
          הוספת החשבון
        </Button>
      )}
    >
      <form onSubmit={onSubmit} className={styles.drawerForm}>
        <Field
          id="account-name"
          label="שם"
          error={refusal?.where === 'name' ? refusal.message : undefined}
        >
          <TextInput id="account-name" value={name} onChange={setName} disabled={pending} />
        </Field>

        <Field id="account-kind" label="סוג">
          <Select
            id="account-kind" options={KIND_OPTIONS} value={kind} disabled={pending}
            onChange={(value) => { setKind(value as AccountKind); }}
          />
        </Field>

        <Field
          id="account-amount"
          label="כמה כסף יש בחשבון"
          hint="ריק פירושו אפס."
          error={refusal?.where === 'amount' ? refusal.message : undefined}
        >
          <MoneyInput id="account-amount" value={amount} onChange={setAmount} disabled={pending} />
        </Field>

        <Checkbox
          id="account-counted"
          label="זו ספירה של מה שיש בחשבון נכון לתאריך"
          checked={counted}
          disabled={pending}
          onChange={setCounted}
        />

        {counted ? (
          <>
            <Field
              id="account-date"
              label="נכון לתאריך"
              error={refusal?.where === 'date' ? refusal.message : undefined}
            >
              <input
                id="account-date" className={styles.dateInput} type="date" value={countedOn}
                disabled={pending}
                onChange={(event) => { setCountedOn(event.target.value); }}
              />
            </Field>
            <p className={styles.muted}>
              תנועות עד היום הזה (כולל) ייחשבו ככלולות בסכום ולא ישנו אותו. תנועות אחריו ישנו אותו.
            </p>
          </>
        ) : (
          <p className={styles.muted}>
            יתרת פתיחה: כל תנועה שתירשם על החשבון, מכל תאריך, תשנה את היתרה.
          </p>
        )}

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
      </form>
    </Drawer>
  );
}
