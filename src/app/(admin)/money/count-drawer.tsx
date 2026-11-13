'use client';

/**
 * Counting what an account holds.
 *
 * The camp did not keep its book through last year, so the ledger cannot
 * derive today's figure. The honest way in is for a lead to count the money
 * and say when: from that day the figure is the count, every movement after
 * it moves the figure, and every movement up to it is kept as the record of
 * what is known without being taken off a balance it is already inside.
 *
 * The drawer says that in a sentence before the button, with the count the
 * account already carries if it has one — a second count replaces the
 * first, and a lead should read that before overwriting it.
 *
 * A client component because the form refuses a bad number before the round
 * trip and the consequence sentence follows the date. The date is a native
 * control inside the kit's `Field` (§5 A28: no kit date input).
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, MoneyInput } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toaster';
import { Money, DateText } from '@/components/format';
import { countAccountAction } from './actions';
import styles from './money.module.css';

type Refusal = { where: 'amount' | 'date' | 'form'; message: string };

export interface CountableAccount {
  id: string;
  name: string;
  /** What the cards show today — the figure the count replaces. */
  balanceAgorot: number;
  countedAgorot: number;
  countedOn: Date | null;
}

/** Agrees with the number, as the kit's sentences do. */
export function absorbedSentence(inside: number, after: number): string {
  const absorbed = inside === 0
    ? 'אף תנועה רשומה לא קדמה לספירה'
    : inside === 1
      ? 'תנועה אחת עד אותו יום כלולה בספירה'
      : `${inside} תנועות עד אותו יום כלולות בספירה`;
  const built = after === 0
    ? 'ורק תנועה שתאריכה אחרי אותו יום תשנה את היתרה'
    : after === 1
      ? 'ותנועה אחת מאוחרת יותר כבר משנה אותה'
      : `ו־${after} תנועות מאוחרות יותר כבר משנות אותה`;
  return `${absorbed}, ${built}.`;
}

/** The day as the date input wants it — in the camp's calendar, which is
 *  what `DateText` renders, rather than the browser's UTC date. */
function todayInput(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' })
    .formatToParts(new Date());
  const of = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${of('year')}-${of('month')}-${of('day')}`;
}

export function CountDrawer({ account, closeHref }: {
  account: CountableAccount;
  closeHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [countedOn, setCountedOn] = useState(todayInput());
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const parsed = Number(amount.trim());

  async function save() {
    setRefusal(null);
    if (amount.trim() === '' || !Number.isFinite(parsed)) {
      setRefusal({ where: 'amount', message: 'הסכום שהוזן אינו מספר. הקלידו סכום בשקלים.' });
      return;
    }
    if (countedOn.trim() === '') {
      setRefusal({ where: 'date', message: 'צריך לבחור את היום שבו נספר הכסף.' });
      return;
    }

    setPending(true);
    try {
      const result = await countAccountAction({
        accountId: account.id, balance: parsed, countedOn,
      });
      if (!result.ok) {
        setRefusal({ where: 'form', message: result.error });
        return;
      }
      const counts = result.value ?? { insideCount: 0, afterCount: 0 };
      toast.show({
        message: `הספירה של ${account.name} נשמרה. ${absorbedSentence(counts.insideCount, counts.afterCount)}`,
      });
      router.replace(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) { event.preventDefault(); save(); }

  return (
    <Drawer
      title={`ספירת ${account.name}`}
      subtitle={(
        <>
          {'היום לפי המערכת: '}
          <Money agorot={account.balanceAgorot} />
        </>
      )}
      closeHref={closeHref}
      footer={(
        <Button tone="primary" disabled={pending} onClick={save}>
          שמירת הספירה
        </Button>
      )}
    >
      <form onSubmit={onSubmit} className={styles.drawerForm}>
        <p className={styles.muted}>
          אם לא עקבתם אחרי כל ההכנסות וההוצאות, זו הדרך להתחיל מחדש: רשמו כמה כסף היה
          בחשבון בסוף היום שתבחרו. תנועות שתאריכן אחרי אותו יום יעדכנו את היתרה; תנועות
          מאותו יום עצמו ולפניו כבר כלולות בסכום.
        </p>

        <Field
          id="count-amount"
          label="כמה כסף יש בחשבון"
          hint="הסכום שספרתם בפועל — לא מה שהמערכת מציגה."
          error={refusal?.where === 'amount' ? refusal.message : undefined}
        >
          <MoneyInput id="count-amount" value={amount} onChange={setAmount} disabled={pending} />
        </Field>

        <Field
          id="count-date"
          label="נכון לתאריך"
          hint="תנועות עד היום הזה (כולל) כבר כלולות בסכום ולא ישנו אותו. תנועות אחריו ישנו אותו."
          error={refusal?.where === 'date' ? refusal.message : undefined}
        >
          <input
            id="count-date" className={styles.dateInput} type="date" value={countedOn}
            disabled={pending}
            onChange={(event) => { setCountedOn(event.target.value); }}
          />
        </Field>

        {/*
          The trap of counting today: the payment form's date is today too,
          so cash taken in this evening is filed inside a count made at noon
          and the balance does not move. Said here, where the day is chosen.
        */}
        {countedOn === todayInput() ? (
          <p className={styles.warnNote}>
            בחרתם את היום. תשלום או תנועה שיירשמו בתאריך של היום — גם אם ייכנסו אחרי
            הספירה — ייחשבו ככלולים בה ולא ישנו את היתרה. אם ייכנס או ייצא כסף עוד היום,
            ספרו שוב בסוף היום.
          </p>
        ) : null}

        {/*
          The count already on the account, said before it is replaced. With
          none there is nothing to lose, and the drawer says what the figure
          rests on instead.
        */}
        {account.countedOn === null ? (
          <p className={styles.muted}>
            {'החשבון עדיין לא נספר: היתרה שלו היא יתרת פתיחה של '}
            <Money agorot={account.countedAgorot} />
            {' ועוד כל התנועות שרשומות עליו.'}
          </p>
        ) : (
          <p className={styles.warnNote}>
            {'הספירה הקודמת — '}
            <Money agorot={account.countedAgorot} />
            {' נכון ל־'}
            <DateText at={account.countedOn} />
            {' — תוחלף. התנועות שנרשמו בין שתי הספירות יישארו רשומות, וייכללו בספירה החדשה.'}
          </p>
        )}

        <p className={styles.muted}>
          הכנסות והוצאות שכבר ידועות אפשר להמשיך לרשום גם מלפני הספירה — הן נשמרות
          כהיסטוריה של החשבון, ומה שאחרי הספירה מתעדכן אוטומטית בתנועות, בתקציב ובסקירה.
        </p>

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
      </form>
    </Drawer>
  );
}
