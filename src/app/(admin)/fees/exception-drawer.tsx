'use client';

/**
 * Setting a member's dues to something other than the flat rate.
 *
 * It used to be a form rendered into every one of the thirty-five rows, in a
 * column called שינוי that also held a payment form and the payment list. It
 * is now its own action at its own URL (`?peek=<personId>&act=exception`),
 * because it is a different decision from taking money: it changes what the
 * camp is owed, and `עמירם דהן 0` with nobody remembering why is the reason
 * the reason field exists.
 *
 * A client component because the form refuses an empty reason before the
 * round trip, and because clearing an exception opens a confirmation.
 *
 * I12: nothing here inflects for gender. `persons` records none, and the
 * copy is written about the חריג and the חיוב — both masculine nouns, which
 * is grammar and not a guess about a person.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, MoneyInput, TextInput } from '@/components/ui/field';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/format';
import { isBlank } from '@/lib/text/normalize';
import type { MemberFeeRow } from '@/lib/fees/season-fees';
import type { FeeView } from '@/lib/fees/views';
import { setExceptionAction, clearExceptionAction } from './actions';
import { feesHref } from './href';
import styles from './fees.module.css';

/** Which control the refusal belongs to, so it is announced beside its field. */
type Refusal = { where: 'amount' | 'reason' | 'form'; message: string };

export function ExceptionDrawer({
  row, seasonId, seasonName, view, flatRateAgorot, decidedBy,
}: {
  row: MemberFeeRow;
  seasonId: string;
  seasonName: string;
  view: FeeView;
  flatRateAgorot: number;
  /** The signed-in lead, recorded as who decided this. */
  decidedBy: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(
    String((row.amountAgorot ?? flatRateAgorot) / 100),
  );
  const [reason, setReason] = useState(row.exceptionReason ?? '');
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [clearing, setClearing] = useState(false);

  const closeHref = feesHref({ season: seasonId, view });
  const exists = row.kind === 'exception';

  function errorFor(where: Refusal['where']): string | undefined {
    return refusal?.where === where ? refusal.message : undefined;
  }

  async function save() {
    setRefusal(null);

    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setRefusal({ where: 'amount', message: 'הסכום חייב להיות מספר שאינו שלילי.' });
      return;
    }
    if (isBlank(reason)) {
      setRefusal({
        where: 'reason',
        message: 'חריג חייב לכלול סיבה. בלי זה אי אפשר יהיה לדעת בעוד שנה למה.',
      });
      return;
    }

    setPending(true);
    try {
      const result = await setExceptionAction({
        personId: row.personId, seasonId, amount: parsed, reason,
      });
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

  async function confirmClear() {
    setClearing(false);
    setRefusal(null);
    setPending(true);
    try {
      const result = await clearExceptionAction(row.personId, seasonId);
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

  const title = exists
    ? `עריכת החריג — ${row.displayName}`
    : `הגדרת חריג — ${row.displayName}`;

  if (row.dueId === null) {
    return (
      <Drawer title={title} closeHref={closeHref}>
        <p className={styles.muted}>
          אין עדיין חיוב ל{row.displayName}. צריך להנפיק חיוב לפני שאפשר להגדיר חריג.
        </p>
      </Drawer>
    );
  }

  return (
    <>
      <Drawer
        title={title}
        subtitle={(
          <>
            {`תעריף רגיל ל${seasonName}: `}
            <Money agorot={flatRateAgorot} />
          </>
        )}
        closeHref={closeHref}
        footer={(
          <>
            <Button tone="primary" disabled={pending} onClick={save}>
              שמירת החריג
            </Button>
            {exists && (
              <Button tone="danger" disabled={pending} onClick={() => setClearing(true)}>
                ביטול החריג
              </Button>
            )}
            <span className={styles.grow} />
            {/* A17: one isolate around the whole phrase, not one around the address. */}
            <bdi className={styles.muted}>יירשם על שמך · {decidedBy}</bdi>
          </>
        )}
      >
        <Banner
          tone="neutral"
          headline="חריג מחייב סיבה."
          detail="בלי זה אי אפשר יהיה לדעת בעוד שנה למה שילמו סכום אחר."
        />

        <form onSubmit={onSubmit} className={styles.drawerForm}>
          <Field
            id="exception-amount" label="סכום" hint="אפשר גם אפס. אפס הוא פטור מלא."
            error={errorFor('amount')}
          >
            <MoneyInput id="exception-amount" value={amount} onChange={setAmount} />
          </Field>

          <Field id="exception-reason" label="סיבה" error={errorFor('reason')}>
            <TextInput
              id="exception-reason"
              placeholder="למשל: פטור מלא — הובלת ההקמה"
              value={reason}
              onChange={setReason}
            />
          </Field>

          {exists && row.decidedBy && (
            <p className={styles.muted}>
              {/* A17: one isolate around the whole phrase. */}
              <bdi>נקבע על ידי {row.decidedBy}</bdi>
            </p>
          )}

          {refusal?.where === 'form' && (
            <p className={styles.formError} role="alert">{refusal.message}</p>
          )}
        </form>
      </Drawer>

      {/*
        R8: clearing discards a recorded reason and the name beside it, and
        neither can be recovered. Rendered as the Drawer's sibling so the
        dialog is raised over the whole drawer rather than inside its body.
      */}
      {clearing && (
        <ConfirmDialog
          title="ביטול החריג"
          confirmLabel="ביטול החריג"
          onCancel={() => setClearing(false)}
          onConfirm={confirmClear}
          consequence={(
            <>
              {/*
                I12: the plan's copy read `{name} יחזור לתעריף הרגיל`, a verb
                inflected for a gender `persons` does not record. The subject
                here is the cancellation, so the only agreement left is with
                Hebrew nouns — ביטול, החיוב, הסיבה — and the member's name is
                never what a verb agrees with.
              */}
              {`ביטול החריג מחזיר את החיוב של ${row.displayName} לתעריף הרגיל של ${seasonName} — `}
              <Money agorot={flatRateAgorot} />
              {`. הסיבה שנרשמה (״${row.exceptionReason ?? ''}״) והשם שנרשם לצידה יימחקו.`}
            </>
          )}
        />
      )}
    </>
  );
}
