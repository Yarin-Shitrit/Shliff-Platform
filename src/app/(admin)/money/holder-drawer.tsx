'use client';

/**
 * Who holds an account.
 *
 * The holder is written once when an account is made, and until this drawer
 * nothing could change it. The reason it needs changing is a person on their
 * way out: `deletePerson` refuses while an account names them, because the
 * schema's `set null` would leave ״חשבון פרטי של ___״ on the card with
 * nothing saying whose money it was. So a lead says whose it is now — a
 * person from the list, or nobody — and the card follows.
 *
 * A client component because the sentence under the select follows the
 * choice, and the refusal is shown beside the form rather than lost in a
 * redirect. The people list is the roster's active records; a merged-away
 * person cannot hold money, and the library refuses them too.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toaster';
import { setAccountHolderAction } from './actions';
import styles from './money.module.css';

export const NOBODY_LABEL = 'אף אחד';

export interface HolderDrawerAccount {
  id: string;
  name: string;
  holderPersonId: string | null;
  holderName: string | null;
}

export function HolderDrawer({ account, people, closeHref }: {
  account: HolderDrawerAccount;
  people: Array<{ id: string; displayName: string }>;
  closeHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [holderId, setHolderId] = useState(account.holderPersonId ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = people.find((person) => person.id === holderId) ?? null;

  async function save() {
    setError(null);
    setPending(true);
    try {
      const result = await setAccountHolderAction({ accountId: account.id, holderPersonId: holderId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.show({
        message: chosen === null
          ? `${account.name} כבר לא רשום על אף אחד.`
          : `${account.name} רשום עכשיו על ${chosen.displayName}.`,
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
      title={`מי מחזיק/ה את ${account.name}`}
      subtitle={account.holderName === null ? 'כרגע לא רשום על אף אחד' : `כרגע רשום על ${account.holderName}`}
      closeHref={closeHref}
      footer={(
        <Button tone="primary" disabled={pending} onClick={save}>שמירה</Button>
      )}
    >
      <form onSubmit={onSubmit} className={styles.drawerForm}>
        <Field id="account-holder" label="מי מחזיק/ה">
          <Select
            id="account-holder"
            emptyLabel={NOBODY_LABEL}
            options={people.map((person) => ({ value: person.id, label: person.displayName }))}
            value={holderId}
            disabled={pending}
            onChange={setHolderId}
          />
        </Field>
        <p className={styles.muted}>
          {chosen === null
            ? 'החשבון יישאר, היתרה והתנועות לא משתנות — רק לא יהיה רשום מי מחזיק את הכסף.'
            : `החשבון יופיע בדף של ${chosen.displayName}. היתרה והתנועות לא משתנות.`}
        </p>
        {error === null ? null : <p className={styles.formError} role="alert">{error}</p>}
      </form>
    </Drawer>
  );
}
