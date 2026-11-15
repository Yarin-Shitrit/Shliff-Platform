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
 * A season has a second rate beside it: דמי חבר, what a person pays to be a
 * camp member without going to Midburn, and what counts toward the full dues
 * once they do. It is optional — an empty box is a season without that
 * track, which is every season before the camp introduced it — and it asks
 * the same question about its own issued dues, separately, because a lead
 * correcting one rate has said nothing about the other.
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
import { setFlatRateAction, setMembershipRateAction } from './actions';
import { feesHref } from './href';
import styles from './fees.module.css';

type Refusal = { where: 'amount' | 'membership' | 'form'; message: string };

/** Agrees with the number, as the kit's sentences do. */
function issuedSentence(count: number): string {
  return count === 1 ? 'החיוב האחד שכבר הונפק בתעריף הרגיל' : `${count} החיובים שכבר הונפקו בתעריף הרגיל`;
}

function issuedMembershipSentence(count: number): string {
  return count === 1 ? 'החיוב האחד שכבר הונפק על דמי חבר' : `${count} החיובים שכבר הונפקו על דמי חבר`;
}

const NONE_ISSUED: IssuedFlatDues = { count: 0, withPayments: 0 };

export function RateDrawer({
  seasonId, seasonName, view, flatRateAgorot, issued,
  membershipRateAgorot = null, issuedMembership = NONE_ISSUED,
}: {
  seasonId: string;
  seasonName: string;
  view: FeeView;
  flatRateAgorot: number;
  issued: IssuedFlatDues;
  /** Null when the season has no membership track. */
  membershipRateAgorot?: number | null;
  /** The dues already out on the membership rate. */
  issuedMembership?: IssuedFlatDues;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(flatRateAgorot / 100));
  const [applyToIssued, setApplyToIssued] = useState(false);
  const [membership, setMembership] = useState(
    membershipRateAgorot === null ? '' : String(membershipRateAgorot / 100),
  );
  const [applyToMembership, setApplyToMembership] = useState(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const closeHref = feesHref({ season: seasonId, view });
  const parsed = Number(amount);
  const nextAgorot = Number.isFinite(parsed) && amount.trim() !== '' ? Math.round(parsed * 100) : null;

  const membershipBlank = membership.trim() === '';
  const parsedMembership = Number(membership);
  const nextMembershipAgorot = !membershipBlank && Number.isFinite(parsedMembership)
    ? Math.round(parsedMembership * 100) : null;

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
    if (!membershipBlank) {
      if (!Number.isFinite(parsedMembership)) {
        setRefusal({ where: 'membership', message: 'דמי החבר חייבים להיות מספר.' });
        return;
      }
      if (parsedMembership < 0) {
        setRefusal({ where: 'membership', message: 'דמי החבר חייבים להיות מספר שאינו שלילי.' });
        return;
      }
      if (parsedMembership > parsed) {
        setRefusal({
          where: 'membership',
          message: 'דמי החבר לא יכולים להיות גבוהים מדמי הקאמפ למידברן, כי הם נספרים על חשבונם.',
        });
        return;
      }
    }

    const membershipChanged = nextMembershipAgorot !== membershipRateAgorot;
    const saveFlat = () => setFlatRateAction(seasonId, parsed, applyToIssued);
    const saveMembership = () => setMembershipRateAction(
      seasonId, membershipBlank ? null : parsedMembership, applyToMembership,
    );
    /*
     * The two rates constrain each other (the membership sum is never the
     * larger), so the one that makes room goes first: lowering the full dues
     * under the membership sum the season still holds would be refused
     * unless the membership sum came down before it.
     */
    const membershipFirst = membershipRateAgorot !== null
      && Math.round(parsed * 100) < membershipRateAgorot;
    const steps = [saveFlat];
    if (membershipChanged || applyToMembership) {
      if (membershipFirst) steps.unshift(saveMembership);
      else steps.push(saveMembership);
    }

    setPending(true);
    try {
      for (const step of steps) {
        const result = await step();
        if (!result.ok) {
          setRefusal({ where: 'form', message: result.error });
          // An earlier step may already have been saved; show what stands.
          router.refresh();
          return;
        }
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
          {membershipRateAgorot !== null && (
            <>
              {' · דמי חבר '}
              <Money agorot={membershipRateAgorot} />
            </>
          )}
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
          hint={membershipBlank
            ? 'כל חיוב שיונפק מעכשיו יהיה בסכום הזה.'
            : 'הסכום המלא למי שמגיע למידברן. חיוב שעובר למידברן מעכשיו יעלה לסכום הזה.'}
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

        <Field
          id="membership-rate"
          label="דמי חבר קאמפ לאדם"
          hint="מה שמשלם מי שלא מגיע למידברן. כל חיוב חדש מונפק על הסכום הזה, והוא נספר על חשבון דמי הקאמפ למי שעובר למידברן. שדה ריק: אין בשנה הזאת דמי חבר, וכל חיוב מונפק על דמי הקאמפ המלאים."
          error={refusal?.where === 'membership' ? refusal.message : undefined}
        >
          <MoneyInput id="membership-rate" value={membership} onChange={setMembership} />
        </Field>

        {issuedMembership.count > 0 && membershipRateAgorot !== null && (
          <>
            <Checkbox
              id="membership-rate-apply"
              label={`לעדכן גם את ${issuedMembershipSentence(issuedMembership.count)}`}
              checked={applyToMembership}
              onChange={setApplyToMembership}
            />
            <p className={styles.muted}>
              <bdi>
                {applyToMembership
                  ? `${issuedMembershipSentence(issuedMembership.count)} ${issuedMembership.count === 1 ? 'יעבור' : 'יעברו'} ל־${nextMembershipAgorot === null ? 'הסכום החדש' : formatShekels(nextMembershipAgorot)}.`
                  : `${issuedMembershipSentence(issuedMembership.count)} ${issuedMembership.count === 1 ? 'יישאר' : 'יישארו'} על ${formatShekels(membershipRateAgorot)}.`}
              </bdi>
            </p>
            {applyToMembership && issuedMembership.withPayments > 0 && (
              <p className={styles.warnNote}>
                <bdi>
                  {issuedMembership.withPayments === 1
                    ? 'על אחד מהם כבר נרשם תשלום — היתרה שלו תשתנה.'
                    : `על ${issuedMembership.withPayments} מהם כבר נרשמו תשלומים — היתרה שלהם תשתנה.`}
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
