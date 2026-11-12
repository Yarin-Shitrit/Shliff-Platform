'use client';

/**
 * Changing what the season charges per person.
 *
 * `seasons.flat_rate` is read by every future issue; a due already out keeps
 * its own amount. Which of the two a lead means — "I typed it wrong
 * yesterday, fix everyone" or "from now on it is more, the ones who paid
 * are done" — is not something the system can know, so the drawer asks, in
 * one checkbox, and says in a sentence what each answer does to the dues
 * already issued, with their count. Exceptions are never touched either way
 * and the drawer says so: they are decisions with a reason and a name.
 *
 * A client component because the form refuses a bad number before the round
 * trip and the consequence sentence follows the checkbox.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, MoneyInput, Checkbox } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/format';
import { formatShekels } from '@/lib/money';
import type { IssuedFlatDues } from '@/lib/fees/dues';
import type { FeeView } from '@/lib/fees/views';
import { setFlatRateAction } from './actions';
import { feesHref } from './href';
import styles from './fees.module.css';

type Refusal = { where: 'amount' | 'form'; message: string };

/** Agrees with the number, as the kit's sentences do. */
function issuedSentence(count: number): string {
  return count === 1 ? 'החיוב האחד שכבר הונפק בתעריף הרגיל' : `${count} החיובים שכבר הונפקו בתעריף הרגיל`;
}

export function RateDrawer({
  seasonId, seasonName, view, flatRateAgorot, issued,
}: {
  seasonId: string;
  seasonName: string;
  view: FeeView;
  flatRateAgorot: number;
  issued: IssuedFlatDues;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(flatRateAgorot / 100));
  const [applyToIssued, setApplyToIssued] = useState(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const closeHref = feesHref({ season: seasonId, view });
  const parsed = Number(amount);
  const nextAgorot = Number.isFinite(parsed) && amount.trim() !== '' ? Math.round(parsed * 100) : null;

  async function save() {
    setRefusal(null);
    if (amount.trim() === '' || !Number.isFinite(parsed)) {
      setRefusal({ where: 'amount', message: 'דמי הקאמפ חייבים להיות מספר.' });
      return;
    }
    if (parsed < 0) {
      setRefusal({ where: 'amount', message: 'דמי הקאמפ חייבים להיות מספר שאינו שלילי.' });
      return;
    }

    setPending(true);
    try {
      const result = await setFlatRateAction(seasonId, parsed, applyToIssued);
      if (!result.ok) {
        setRefusal({ where: 'form', message: result.error });
        return;
      }
      router.replace(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) { event.preventDefault(); save(); }

  return (
    <Drawer
      title={`התעריף של ${seasonName}`}
      subtitle={(
        <>
          {'היום: '}
          <Money agorot={flatRateAgorot} />
          {' לאדם'}
        </>
      )}
      closeHref={closeHref}
      footer={(
        <Button tone="primary" disabled={pending} onClick={save}>
          שמירת התעריף
        </Button>
      )}
    >
      <form onSubmit={onSubmit} className={styles.drawerForm}>
        <Field
          id="flat-rate"
          label="דמי קאמפ לאדם"
          hint="כל חיוב שיונפק מעכשיו יהיה בסכום הזה."
          error={refusal?.where === 'amount' ? refusal.message : undefined}
        >
          <MoneyInput id="flat-rate" value={amount} onChange={setAmount} />
        </Field>

        {/*
          The decision about the dues already out, stated both ways. With
          nothing issued there is nothing to decide, and the drawer says that
          instead of showing a checkbox over zero.
        */}
        {issued.count === 0 ? (
          <p className={styles.muted}>עדיין לא הונפק אף חיוב בתעריף הרגיל, כך שאין מה לעדכן.</p>
        ) : (
          <>
            <Checkbox
              id="flat-rate-apply"
              label={`לעדכן גם את ${issuedSentence(issued.count)}`}
              checked={applyToIssued}
              onChange={setApplyToIssued}
            />
            {/* A17: one isolate around the whole phrase. */}
            <p className={styles.muted}>
              <bdi>
                {applyToIssued
                  ? `${issuedSentence(issued.count)} ${issued.count === 1 ? 'יעבור' : 'יעברו'} ל־${nextAgorot === null ? 'הסכום החדש' : formatShekels(nextAgorot)}.`
                  : `${issuedSentence(issued.count)} ${issued.count === 1 ? 'יישאר' : 'יישארו'} על ${formatShekels(flatRateAgorot)}.`}
              </bdi>
            </p>
            {applyToIssued && issued.withPayments > 0 && (
              <p className={styles.warnNote}>
                <bdi>
                  {issued.withPayments === 1
                    ? 'על אחד מהם כבר נרשם תשלום — היתרה שלו תשתנה.'
                    : `על ${issued.withPayments} מהם כבר נרשמו תשלומים — היתרה שלהם תשתנה.`}
                </bdi>
              </p>
            )}
          </>
        )}

        <p className={styles.muted}>חריגים לא משתנים: כל חריג הוא החלטה עם סיבה ושם לצידה.</p>

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
      </form>
    </Drawer>
  );
}
