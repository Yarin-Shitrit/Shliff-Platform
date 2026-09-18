'use client';

/**
 * A client component because recording a payment is a form: the amount, the
 * channel and the account depend on each other while the lead is typing —
 * choosing קיזוז takes the account away and makes the note mandatory — and
 * "שמירה ומעבר לבא" has to navigate after the save resolves. None of that can
 * be expressed as a server round trip per keystroke.
 *
 * The drawer itself is a URL (R6): the server decides it is open from
 * `?peek=<personId>&act=pay` and hands this component everything it needs,
 * including the id of the next member of the run. No list lives on the client.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, MoneyInput, Select, Segmented, Textarea } from '@/components/ui/field';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Money, DateText } from '@/components/format';
import { formatShekels } from '@/lib/money';
import { formatDateShort } from '@/lib/dates';
import { isBlank } from '@/lib/text/normalize';
import { PAYMENT_CHANNELS } from '@/db/schema/camp';
import type { PaymentChannel } from '@/db/schema/camp';
import type { AccountKind } from '@/db/schema/money';
import type { MemberFeeRow } from '@/lib/fees/season-fees';
import type { PaymentRow } from '@/lib/fees/payments';
import type { FeeView } from '@/lib/fees/views';
import { recordPaymentAction, deletePaymentAction } from './actions';
import { feesHref } from './href';
import styles from './fees.module.css';

export interface AccountOption { id: string; name: string; kind: AccountKind }

/**
 * Today as an `<input type="date">` value, from the viewer's own calendar —
 * the date the native picker will open on. It is a default the lead confirms,
 * never a figure this screen stores on its own, so it is deliberately not run
 * through `src/lib/dates.ts`, which exists to read timestamps that are already
 * in the database.
 */
function todayInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Which control the refusal belongs to, so it is announced beside its field. */
type Refusal = { where: 'amount' | 'note' | 'form'; message: string };

type Saved = { amountAgorot: number; name: string; unplaced: boolean; ended: boolean };

export function PaymentDrawer({
  row, seasonId, view, accounts, recordedBy, nextPersonId, prevPersonId, position,
}: {
  row: MemberFeeRow;
  seasonId: string;
  view: FeeView;
  accounts: AccountOption[];
  recordedBy: string;
  /** Precomputed on the server by `nextPayable`; null ends the run. */
  nextPersonId: string | null;
  prevPersonId: string | null;
  position: { index: number; total: number };
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(String((row.outstandingAgorot || 0) / 100));
  const [channel, setChannel] = useState<PaymentChannel>(PAYMENT_CHANNELS[0]);
  const [paidOn, setPaidOn] = useState(todayInputValue());
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [removing, setRemoving] = useState<PaymentRow | null>(null);

  const closeHref = feesHref({ season: seasonId, view });
  const isOffset = channel === 'קיזוז';
  const chosen = accounts.find((account) => account.id === accountId) ?? null;

  function errorFor(where: Refusal['where']): string | undefined {
    return refusal?.where === where ? refusal.message : undefined;
  }

  function pickChannel(next: string) {
    setChannel(next as PaymentChannel);
    // קיזוז moves no cash, so it must never carry an account. Clearing it here
    // rather than at submit keeps the screen honest about what will be saved.
    if (next === 'קיזוז') setAccountId('');
  }

  async function save(step: boolean) {
    setRefusal(null);
    setSaved(null);

    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setRefusal({ where: 'amount', message: 'סכום התשלום חייב להיות מספר חיובי.' });
      return;
    }
    if (isOffset && isBlank(note)) {
      setRefusal({
        where: 'note',
        message: 'קיזוז חייב לכלול הערה שמסבירה מול מה הוא קוזז — אחרת אי אפשר לדעת בעתיד.',
      });
      return;
    }

    setPending(true);
    try {
      const result = await recordPaymentAction({
        dueId: row.dueId!,
        amount: parsed,
        channel,
        paidOn,
        note: isBlank(note) ? undefined : note,
        accountId: accountId === '' ? undefined : accountId,
      });
      if (!result.ok) {
        setRefusal({ where: 'form', message: result.error });
        return;
      }

      setSaved({
        amountAgorot: Math.round(parsed * 100),
        name: row.displayName,
        unplaced: !isOffset && accountId === '',
        ended: step && nextPersonId === null,
      });
      setNote('');

      if (step && nextPersonId) {
        router.replace(feesHref({ season: seasonId, view, pay: nextPersonId }));
      }
      // The action revalidated `/fees`; this repaints the table underneath.
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function confirmRemove() {
    const target = removing;
    setRemoving(null);
    if (!target) return;
    setRefusal(null);
    setPending(true);
    try {
      const result = await deletePaymentAction(target.id);
      if (!result.ok) {
        setRefusal({ where: 'form', message: result.error });
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) { event.preventDefault(); save(false); }

  const title = `רישום תשלום — ${row.displayName}`;

  if (row.dueId === null) {
    return (
      <Drawer title={title} closeHref={closeHref}>
        <p className={styles.muted}>
          אין עדיין חיוב ל{row.displayName}. צריך להנפיק חיוב לפני שאפשר לרשום תשלום.
        </p>
      </Drawer>
    );
  }

  return (
    <Drawer
      title={title}
      subtitle={(
        <>
          {row.kind === 'exception' ? 'חריג' : 'תעריף רגיל'}
          {' · נותר '}
          <Money agorot={row.outstandingAgorot} />
        </>
      )}
      closeHref={closeHref}
      stepper={{
        position: position.index,
        total: position.total,
        previousHref: prevPersonId
          ? feesHref({ season: seasonId, view, pay: prevPersonId }) : null,
        nextHref: nextPersonId
          ? feesHref({ season: seasonId, view, pay: nextPersonId }) : null,
      }}
      footer={(
        <>
          <Button tone="primary" disabled={pending} onClick={() => save(false)}>
            רישום התשלום
          </Button>
          <Button disabled={pending} onClick={() => save(true)}>
            שמירה ומעבר לבא
          </Button>
          <span className={styles.grow} />
          {/* A17: one isolate around the whole phrase, not one around the address. */}
          <bdi className={styles.muted}>יירשם על שמך · {recordedBy}</bdi>
        </>
      )}
    >
      <form id="payment-form" onSubmit={onSubmit} className={styles.drawerForm}>
        <div className={styles.twoUp}>
          <Field
            id="pay-amount" label="סכום" hint="מלא את היתרה. אפשר גם סכום חלקי."
            error={errorFor('amount')}
          >
            <MoneyInput id="pay-amount" value={amount} onChange={setAmount} />
          </Field>
          <Field id="pay-date" label="תאריך התשלום" hint="היום">
            <input
              className={styles.dateInput}
              id="pay-date" type="date"
              value={paidOn} onChange={(event) => setPaidOn(event.target.value)}
            />
          </Field>
        </div>

        <Field id="pay-channel" label="אמצעי תשלום" as="group">
          <Segmented
            id="pay-channel" name="channel"
            options={PAYMENT_CHANNELS.map((one) => ({ value: one, label: one }))}
            value={channel}
            onChange={pickChannel}
          />
        </Field>

        <Field
          id="pay-account"
          label="לאיזו קופה הכסף נכנס"
          hint={isOffset
            ? 'קיזוז אינו מזיז מזומן, ולכן אינו נכנס לקופה.'
            : 'בלי קופה הסכום ייספר בגבייה אבל לא ביתרה של אף חשבון.'}
        >
          <Select
            id="pay-account"
            emptyLabel="בלי קופה"
            options={accounts.map((account) => ({ value: account.id, label: account.name }))}
            value={accountId}
            disabled={isOffset}
            onChange={setAccountId}
          />
        </Field>
        {chosen?.kind === 'personal' && (
          <p className={styles.warnNote}>זה חשבון פרטי של חבר קאמפ, לא קופה של הקאמפ.</p>
        )}

        <Field id="pay-note" label="הערה" error={errorFor('note')}>
          <Textarea
            id="pay-note" rows={2}
            placeholder="לא חובה — חוץ מקיזוז, שם חייבים לכתוב מול מה קוזז"
            value={note} onChange={setNote}
          />
        </Field>

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
        {saved && (
          <p className={styles.saved} role="status">
            <bdi>
              {`נרשמו ${formatShekels(saved.amountAgorot)} עבור ${saved.name}.`}
            </bdi>
            {saved.unplaced ? ' הסכום נספר בגבייה אבל לא נכנס ליתרה של אף קופה.' : null}
            {saved.ended ? ' זה היה האחרון ברשימה.' : null}
          </p>
        )}
      </form>

      <section className={styles.previous}>
        <h3 className={styles.previousHead}>תשלומים קודמים</h3>
        {row.payments.length === 0 ? (
          <p className={styles.muted}>אין עדיין תשלומים.</p>
        ) : (
          <ul className={styles.previousList}>
            {row.payments.map((entry) => (
              <li key={entry.id}>
                <Money agorot={entry.amountAgorot} />
                <span>{entry.channel}</span>
                <DateText at={entry.paidOn} />
                {entry.note && <span className={styles.muted}>{entry.note}</span>}
                {entry.accountId === null && entry.channel !== 'קיזוז' && (
                  <span className={styles.muted}>בלי קופה</span>
                )}
                <span className={styles.rowEnd}>
                  {/*
                    The visible word comes first and the rest of the accessible
                    name is only visually hidden, so the name a screen reader
                    announces starts with the label a sighted lead reads — and
                    four `הסרה` buttons in one list are still told apart.
                  */}
                  <Button
                    tone="ghost" size="sm" disabled={pending}
                    onClick={() => setRemoving(entry)}
                  >
                    <>
                      הסרה
                      <span className="sr-only">
                        {` — תשלום של ${formatShekels(entry.amountAgorot)}`}
                        {` מ־${formatDateShort(entry.paidOn)}`}
                      </span>
                    </>
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* R8: removing a payment moves money out of two places at once, and the
          lead must read both before it happens. */}
      {removing && (
        <ConfirmDialog
          title="מחיקת תשלום"
          confirmLabel="מחיקת התשלום"
          onCancel={() => setRemoving(null)}
          onConfirm={confirmRemove}
          consequence={(
            <>
              {'תשלום של '}<Money agorot={removing.amountAgorot} />
              {` ב${removing.channel} מ־`}<DateText at={removing.paidOn} />
              {` עבור ${row.displayName} יימחק. הסכום ירד מהגבייה`}
              {removing.accountId
                ? `, ומהיתרה של ${accounts.find((one) => one.id === removing.accountId)?.name ?? 'הקופה'}.`
                : '.'}
            </>
          )}
        />
      )}

      <Banner
        tone="neutral"
        headline="רוצים לשנות את הסכום עצמו ולא לרשום תשלום?"
        detail="זה חריג, והוא מחייב סיבה — כדי שבעוד שנה יהיה אפשר לדעת למה."
        action={{
          label: 'הגדרת חריג',
          href: feesHref({ season: seasonId, view, exception: row.personId }),
        }}
      />
    </Drawer>
  );
}
