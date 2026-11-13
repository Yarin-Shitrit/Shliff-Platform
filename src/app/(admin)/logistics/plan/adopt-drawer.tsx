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
import { SOURCE_LABELS } from '@/lib/logistics/labels';
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

/** An item the move would refuse is never ticked and cannot be. */
function movable(item: AdoptableItem): boolean {
  return (item.outcome?.refusal ?? null) === null;
}

/**
 * What will happen to this one item, said under it before the button: the
 * name and the way of getting it the row will carry, the board's new title
 * when it changes, that it joins a row already in the list instead of
 * making a second — or why it cannot move from here.
 */
function outcomeLine(item: AdoptableItem): string | null {
  const outcome = item.outcome;
  if (outcome === undefined) return null;
  if (outcome.refusal === 'needs_lender') {
    return 'השאלה צריכה שם של המשאיל/ה, ולכן היא לא עוברת מכאן. מוסיפים את הפריט ברשימת הרכש והוא מופיע בלוח לבד; את המשימה הזו אפשר אז לבטל.';
  }
  if (outcome.refusal === 'ambiguous') {
    return `ברשימת הרכש יש יותר מפריט אחד בשם ״${outcome.name}״, ואי אפשר לדעת לאיזה מהם לקשר. אחרי שינוי השם של אחד מהם שם, המשימה תוכל לעבור.`;
  }
  if (outcome.existing !== null) {
    return `״${outcome.existing.name}״ כבר ברשימת הרכש — המשימה תקושר לפריט הקיים, ולא ייווצר פריט נוסף.`;
  }
  const retitled = outcome.boardTitle === item.title.trim() ? '' : ` · בלוח תיקרא ״${outcome.boardTitle}״`;
  return `תיכנס כ״${outcome.name}״ · ${SOURCE_LABELS[outcome.source]}${retitled}`;
}

export function AdoptDrawer({ seasonId, seasonName, candidates, closeHref, listHref }: AdoptDrawerProps) {
  const router = useRouter();
  const { show } = useToast();
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(candidates.filter((item) => item.suggested && movable(item)).map((item) => item.id)),
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
    const line = outcomeLine(item);
    return (
      <li key={item.id} className={styles.adoptRow}>
        <Checkbox
          id={`adopt-${item.id}`}
          label={label}
          checked={chosen.has(item.id)}
          onChange={(on) => { toggle(item.id, on); }}
          disabled={pending || !movable(item)}
        />
        {line === null ? null : <span className={styles.adoptOutcome}><bdi>{line}</bdi></span>}
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
          {' כפריט בכמות 1, עם האחראי שלה — ותישאר בלוח, מקושרת לפריט. מתחת לכל משימה כתוב איך היא תיכנס. מעכשיו רכש נכנס מרשימת הרכש ומופיע בלוח לבד.'}
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
