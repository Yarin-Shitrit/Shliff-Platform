'use client';

/**
 * Closing a season's balances: the starting point.
 *
 * After a year the book was not kept, the lead's word is that everyone has
 * received and paid what they were owed. This drawer zeroes what the
 * screens still show as open for one season — every unpaid due, every open
 * named debt — in one act, with one note, keeping every row (see
 * `closeSeasonBalances` on why it is a write-off and not a delete).
 *
 * The decision is stated in numbers before the button: how many people, how
 * much, how many debts each way, and what will *not* close — the debts that
 * name nobody, and the members never billed. Two checkboxes, because dues
 * and debts are different facts and a lead may mean one without the other.
 *
 * A client component because the sentence under each box follows it, and
 * the refusal lands in place.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Checkbox } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/banner';
import { useToast } from '@/components/ui/toaster';
import { Money } from '@/components/format';
import { formatShekels } from '@/lib/money';
import type { SeasonClosePreview, CloseSeasonResult } from '@/lib/fees/close-season';
import type { FeeView } from '@/lib/fees/views';
import { closeSeasonAction } from './actions';
import { feesHref } from './href';
import styles from './fees.module.css';

/** Agrees with the number, as the kit's sentences do. */
export function peopleSentence(count: number): string {
  return count === 1 ? 'אדם אחד' : `${count} אנשים`;
}

export function debtsSentence(count: number): string {
  return count === 1 ? 'חוב אחד' : `${count} חובות`;
}

export function closedSentence(result: CloseSeasonResult, seasonName: string): string {
  const parts: string[] = [];
  if (result.duesClosed > 0) {
    parts.push(`${peopleSentence(result.duesClosed)} עם ${formatShekels(result.duesAgorot)} של דמי קאמפ פתוחים`);
  }
  if (result.obligationsClosed > 0) {
    parts.push(`${debtsSentence(result.obligationsClosed)} בסך ${formatShekels(result.obligationsAgorot)}`);
  }
  const left = result.unnamedLeft === 0
    ? ''
    : ` ${debtsSentence(result.unnamedLeft)} בלי שם ${result.unnamedLeft === 1 ? 'נשאר פתוח' : 'נשארו פתוחים'}.`;
  return `היתרות של ${seasonName} אופסו: ${parts.join(', ')}.${left}`;
}

export function CloseSeasonDrawer({ preview, view, latest }: {
  preview: SeasonClosePreview;
  view: FeeView;
  /** True when this is the newest season — closing it is probably a mistake. */
  latest: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [dues, setDues] = useState(preview.dues.count > 0);
  const [obligations, setObligations] = useState(preview.obligations.count > 0);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const closeHref = feesHref({ season: preview.seasonId, view });
  const nothingOpen = preview.dues.count === 0 && preview.obligations.count === 0;
  const nothingChosen = !dues && !obligations;

  async function save() {
    setRefusal(null);
    if (nothingChosen) {
      setRefusal('בחרו מה לסגור: חיובים, חובות, או שניהם.');
      return;
    }
    setPending(true);
    try {
      const result = await closeSeasonAction(preview.seasonId, { dues, obligations });
      if (!result.ok) {
        setRefusal(result.error);
        return;
      }
      if (result.value) toast.show({ message: closedSentence(result.value, preview.seasonName) });
      router.replace(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) { event.preventDefault(); save(); }

  return (
    <Drawer
      title={`סגירת היתרות של ${preview.seasonName}`}
      subtitle="נקודת התחלה: מה שעדיין רשום כפתוח מהשנה הזו יאופס"
      closeHref={closeHref}
      footer={(
        <Button tone="primary" disabled={pending || nothingOpen} onClick={save}>
          {`איפוס היתרות של ${preview.seasonName}`}
        </Button>
      )}
    >
      <form onSubmit={onSubmit} className={styles.drawerForm}>
        <p className={styles.muted}>
          כולם קיבלו ושילמו את המגיע להם? אז מה שהמערכת עדיין מציגה כפתוח הוא לא חוב
          אמיתי. האיפוס רושם על כל יתרה פתוחה קיזוז עם הערה שאומרת למה, כך שהחיובים,
          התשלומים והחובות נשארים רשומים והיתרה קוראת אפס. שום כסף לא זז ושום קופה לא
          משתנה.
        </p>

        {latest ? (
          <Banner
            tone="warn"
            headline={`${preview.seasonName} היא השנה החדשה ביותר.`}
            detail="איפוס שלה יסגור גם חיובים שעדיין אמורים להיגבות. אם התכוונתם לשנה שעברה, בחרו אותה בבורר השנה בסרגל הצד."
          />
        ) : null}

        {nothingOpen ? (
          <p className={styles.muted}>
            {`אין יתרות פתוחות ב${preview.seasonName}: אף אחד לא חייב דמי קאמפ ואין חוב פתוח עם שם.`}
          </p>
        ) : (
          <>
            <Checkbox
              id="close-dues"
              label={preview.dues.count === 0
                ? 'דמי קאמפ — אף אחד לא חייב'
                : `דמי קאמפ — ${peopleSentence(preview.dues.count)} עדיין חייבים ${formatShekels(preview.dues.totalAgorot)}`}
              checked={dues}
              disabled={pending || preview.dues.count === 0}
              onChange={setDues}
            />
            {preview.dues.count > 0 ? (
              <ul className={styles.closeList} aria-label="מי עדיין חייב">
                {preview.dues.rows.map((row) => (
                  <li key={row.dueId}>
                    <bdi>{row.displayName}</bdi> · <Money agorot={row.outstandingAgorot} />
                  </li>
                ))}
              </ul>
            ) : null}

            <Checkbox
              id="close-obligations"
              label={preview.obligations.count === 0
                ? 'חובות — אין חוב פתוח עם שם'
                : `חובות — ${debtsSentence(preview.obligations.count)} (אנחנו חייבים ${formatShekels(preview.obligations.campOwesAgorot)}, חייבים לנו ${formatShekels(preview.obligations.owedToCampAgorot)})`}
              checked={obligations}
              disabled={pending || preview.obligations.count === 0}
              onChange={setObligations}
            />
            {preview.obligations.count > 0 ? (
              <ul className={styles.closeList} aria-label="החובות שייסגרו">
                {preview.obligations.rows.map((row) => (
                  <li key={row.id}>
                    <bdi>{row.displayParty}</bdi> · {row.description} · <Money agorot={row.outstandingAgorot} />
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}

        {/* What stays as it is, said before the button rather than found
          * afterwards: a debt with no name cannot be closed, and a member
          * never billed has nothing to close. */}
        {preview.unnamed > 0 ? (
          <p className={styles.warnNote}>
            {`${debtsSentence(preview.unnamed)} בלי שם ${preview.unnamed === 1 ? 'יישאר פתוח' : 'יישארו פתוחים'}: אי אפשר לסגור חוב בלי לדעת למי מגיע הכסף. רשמו שם בדף החובות.`}
          </p>
        ) : null}
        {preview.unissued > 0 ? (
          <p className={styles.muted}>
            {`${peopleSentence(preview.unissued)} ברשימה בלי חיוב בכלל — אין להם מה לאפס.`}
          </p>
        ) : null}

        {refusal !== null && (
          <p className={styles.formError} role="alert">{refusal}</p>
        )}
      </form>
    </Drawer>
  );
}
