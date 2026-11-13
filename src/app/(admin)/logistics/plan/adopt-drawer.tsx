'use client';

/**
 * The one-time move: the board's items that are really things to buy
 * become rows in the acquisitions list, each linked to its item. The item
 * stays on the board — from now on a purchase is entered on רכש and lands
 * here on its own — renamed from the row, with its person carried over.
 *
 * A drawer rather than a sweep, because which items are purchases is a
 * decision: the ones that open with ״לקנות״ are ticked, the rest of the
 * open items are listed under them for the lead to tick, and nothing moves
 * until the button is pressed. The library refuses all-or-nothing, so the
 * drawer never reports a half-moved board.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Checkbox } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toaster';
import type { AdoptableItem } from '@/lib/logistics/plan';
import { adoptPurchaseItemsAction } from './actions';
import { NOTHING_CHOSEN } from './failure-messages';
import styles from './plan.module.css';

export interface AdoptDrawerProps {
  seasonId: string;
  seasonName: string;
  candidates: AdoptableItem[];
  closeHref: string;
  /** The acquisitions list, where the rows land. */
  listHref: string;
}

export function AdoptDrawer({ seasonId, seasonName, candidates, closeHref, listHref }: AdoptDrawerProps) {
  const router = useRouter();
  const { show } = useToast();
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(candidates.filter((item) => item.suggested).map((item) => item.id)),
  );
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const suggested = candidates.filter((item) => item.suggested);
  const rest = candidates.filter((item) => !item.suggested);

  function toggle(id: string, on: boolean) {
    setChosen((before) => {
      const next = new Set(before);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function move() {
    setRefusal(null);
    if (chosen.size === 0) { setRefusal(NOTHING_CHOSEN); return; }
    setPending(true);
    try {
      const result = await adoptPurchaseItemsAction(seasonId, [...chosen]);
      if (!result.ok) { setRefusal(result.error); return; }
      show({
        message: result.value === 1
          ? 'משימה אחת נוספה לרשימת הרכש ונשארה בלוח'
          : `${result.value} משימות נוספו לרשימת הרכש ונשארו בלוח`,
        tone: 'ok',
      });
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  function row(item: AdoptableItem) {
    const label = item.assignee === null ? item.title : `${item.title} · ${item.assignee.displayName}`;
    return (
      <li key={item.id} className={styles.adoptRow}>
        <Checkbox
          id={`adopt-${item.id}`}
          label={label}
          checked={chosen.has(item.id)}
          onChange={(on) => { toggle(item.id, on); }}
          disabled={pending}
        />
      </li>
    );
  }

  return (
    <Drawer
      title="העברת קניות לרכש"
      subtitle={seasonName}
      closeHref={closeHref}
      phone="full"
      footer={(
        <span className={styles.footActions}>
          <Button tone="primary" onClick={() => { void move(); }} disabled={pending || candidates.length === 0}>
            {chosen.size === 0 ? 'העברה לרכש' : `העברה לרכש (${chosen.size})`}
          </Button>
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>ביטול</Button>
        </span>
      )}
    >
      <div className={styles.form}>
        <p className={styles.adoptLead}>
          {'כל משימה שתסומן תיכנס ל'}
          <Link href={listHref}>רשימת הרכש</Link>
          {' כפריט ״לקנות חדש״, כמות 1, עם האחראי שלה — ותישאר בלוח, מקושרת לפריט. מעכשיו רכש נכנס מרשימת הרכש ומופיע בלוח לבד.'}
        </p>

        {candidates.length === 0 ? (
          <p className={styles.empty}>אין בלוח משימות פתוחות שעוד לא ברשימת הרכש.</p>
        ) : (
          <>
            <h3 className={styles.subhead}>{suggested.length === 0 ? 'אין משימות שמתחילות ב״לקנות״' : 'מתחילות ב״לקנות״ — מסומנות'}</h3>
            {suggested.length === 0 ? null : <ul className={styles.adoptList}>{suggested.map(row)}</ul>}
            {rest.length === 0 ? null : (
              <>
                <h3 className={styles.subhead}>עוד משימות פתוחות — לסמן רק מה שהוא קנייה</h3>
                <ul className={styles.adoptList}>{rest.map(row)}</ul>
              </>
            )}
          </>
        )}

        {refusal === null ? null : <p className={styles.formError} role="alert">{refusal}</p>}
      </div>
    </Drawer>
  );
}
