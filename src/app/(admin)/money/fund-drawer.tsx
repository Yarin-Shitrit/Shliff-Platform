'use client';

/**
 * Whose money an account holds: the camp's or the gift's.
 *
 * The camp keeps two pots that never mix — dues pay for the camp, the parties
 * raise money for the gift — and the only place that is recorded is on the
 * account. An account made before the two were told apart has no pot, and the
 * overview counts it in neither balance until a lead says which. This drawer
 * is where they say it, and where a wrong answer is corrected.
 *
 * Nothing is chosen for an account with no pot. The system cannot tell the
 * camp's money from the gift's by an account's name or its kind, and a
 * pre-selected answer would be a guess the lead only has to not notice.
 *
 * A client component because the sentence under the choice follows it, and
 * the refusal is shown beside the form rather than lost in a redirect.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, Segmented } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toaster';
import type { AccountFund } from '@/db/schema/money';
import {
  ACCOUNT_FUNDS, ACCOUNT_FUND_NAMES, ACCOUNT_FUND_PURPOSE, isAccountFund,
} from '@/lib/money/labels';
import { setAccountFundAction } from './actions';
import styles from './money.module.css';

export const FUND_FIELD_LABEL = 'של מי הכסף';
export const FUND_REQUIRED = 'צריך לבחור של מי הכסף: של הקאמפ או של הגיפט.';

export const FUND_OPTIONS = ACCOUNT_FUNDS.map((fund) => ({
  value: fund, label: ACCOUNT_FUND_NAMES[fund],
}));

export interface FundDrawerAccount {
  id: string;
  name: string;
  fund: AccountFund | null;
}

export function FundDrawer({ account, closeHref }: {
  account: FundDrawerAccount;
  closeHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [fund, setFund] = useState<AccountFund | null>(account.fund);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (fund === null) {
      setError(FUND_REQUIRED);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const result = await setAccountFundAction({ accountId: account.id, fund });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.show({ message: `${account.name} נספר עכשיו ביתרת ${ACCOUNT_FUND_NAMES[fund]}.` });
      router.replace(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) { event.preventDefault(); save(); }

  return (
    <Drawer
      title={`של מי הכסף ב${account.name}`}
      subtitle={account.fund === null
        ? 'עוד לא נקבע'
        : `כרגע: של ${ACCOUNT_FUND_NAMES[account.fund]}`}
      closeHref={closeHref}
      footer={(
        <Button tone="primary" disabled={pending} onClick={save}>שמירה</Button>
      )}
    >
      <form onSubmit={onSubmit} className={styles.drawerForm}>
        <Field id="account-fund" label={FUND_FIELD_LABEL} as="group">
          <Segmented
            id="account-fund"
            name="account-fund"
            options={FUND_OPTIONS}
            value={fund ?? ''}
            disabled={pending}
            onChange={(value) => { if (isAccountFund(value)) setFund(value); }}
          />
        </Field>
        <p className={styles.muted}>
          {fund === null
            ? 'לקאמפ ולגיפט יש כסף נפרד. עד שייקבע של מי החשבון, היתרה שלו לא נספרת באף אחת משתי היתרות.'
            : `${ACCOUNT_FUND_PURPOSE[fund]}. היתרה של החשבון תיספר ביתרת ${ACCOUNT_FUND_NAMES[fund]}.`}
        </p>
        <p className={styles.muted}>
          השיוך לא מזיז כסף ולא משנה אף תנועה — רק קובע באיזו יתרה החשבון נספר.
        </p>
        {error === null ? null : <p className={styles.formError} role="alert">{error}</p>}
      </form>
    </Drawer>
  );
}
