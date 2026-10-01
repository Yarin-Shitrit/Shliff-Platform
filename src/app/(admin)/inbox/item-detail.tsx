import type { ReactElement } from 'react';
import Link from 'next/link';
import type { InboxItem, InboxGroup } from '@/lib/inbox/items';
import { Banner } from '@/components/ui/banner';
import { Money } from '@/components/format';
import type { BlockArchetype } from '@/lib/classify/types';
// Plan 11's record, and the only one. A second copy here is how the register
// and the imports screen start calling the same table two different things —
// and the raw archetype is an English identifier, which may not reach a
// Hebrew screen at all.
import { ARCHETYPE_LABELS } from '../imports/labels';
import { EvidenceGrid } from './evidence-grid';
import type { Evidence } from '@/lib/data/evidence';
import { SuggestionList } from './suggestion-list';
import { CopyCompare } from './copy-compare';
import { ActionBar } from './action-bar';
import { InboxKeyboard } from './keyboard';
import { itemHref } from './item-rail';
import styles from './inbox.module.css';

/**
 * R10, stated on screen. There is no single-letter shortcut at all — on a
 * Hebrew layout `event.key` for `Z` is `ז`, so a letter is a different key on
 * every keyboard — and undo lives in the toast, where it is visible. The
 * mock's footer line promised a `Z`; this is the corrected one.
 */
const FOOTER =
  'אחרי כל החלטה הפריט הבא נפתח מעצמו · 1–5 פעולה · ↑↓ מעבר · ביטול בהודעה שמופיעה אחרי הפעולה';

/**
 * The mock's sentence, with its opening clause moved to the headline instead
 * of being printed twice — `Banner` renders the headline itself, so keeping
 * `קישור אינו מיזוג` at the front of the detail said it once in each half.
 */
const LINK_IS_NOT_MERGE =
  'הוא מצמיד את האיות הזה לאדם קיים ואפשר לבטל אותו. מיזוג של שני אנשים נעשה מדף האדם, ואינו הפיך.';

function digitMap(item: InboxItem): Record<string, string> {
  const map: Record<string, string> = {};
  for (const action of item.actions) {
    if (action.digit === null) continue;
    map[`Digit${action.digit}`] = `inbox-action-${action.digit}`;
  }
  return map;
}

function Panels(
  { item, evidence }: { item: InboxItem; evidence: Evidence | null },
): ReactElement {
  switch (item.kind) {
    case 'unlinked-name':
      return (
        <>
          <SuggestionList suggestions={item.suggestions} actions={item.actions} />
          {item.rowCount > 0 ? (
            <p className={styles.muted}>
              {/* A17: the phrase is one isolate, so a test can query it whole. */}
              <bdi>{item.rowCount} שורות שכבר נכתבו נושאות את האיות הזה.</bdi>
              {' '}
              <Link href="/money/debts">מעבר לחובות</Link>
            </p>
          ) : null}
          <Banner
            tone="info"
            label="מה עושה קישור"
            headline="קישור אינו מיזוג"
            detail={LINK_IS_NOT_MERGE}
          />
        </>
      );

    case 'sheet-collision':
      return <CopyCompare item={item} />;

    case 'sheet-season':
      return (
        <section className={styles.panel}>
          <div className={styles.sectionTitle}>מה מחכה לגיליון הזה</div>
          {item.waiting.length === 0 ? (
            <p className={styles.muted}>אין טבלאות בגיליון הזה.</p>
          ) : (
            <ul className={styles.waiting}>
              {item.waiting.map((block) => (
                <li key={block.blockId}>
                  <bdi>
                    {ARCHETYPE_LABELS[block.archetype as BlockArchetype] ?? block.archetype}
                    {' · '}
                    {block.rows} שורות שנכתבו
                  </bdi>
                </li>
              ))}
            </ul>
          )}
          {item.refusesWithoutSeason ? (
            <Banner
              tone="warn"
              label="למה זה חוסם"
              headline="בלי שנה אי אפשר לכתוב את השורות האלה"
              detail="תקציב וסבב כרטיסים חייבים שנה, והמערכת לא ממציאה אחת."
            />
          ) : null}
        </section>
      );

    case 'block-undecided':
      return <EvidenceGrid evidence={evidence} />;

    case 'unnamed-debt':
      return (
        <>
          {item.obligation.sourceBlockId === null || item.obligation.sourceRow === null ? (
            <p className={styles.muted}>נרשם ידנית — אין שורה בגיליון מאחורי החוב הזה.</p>
          ) : (
            <EvidenceGrid evidence={evidence} />
          )}
          <p className={styles.amount}>
            <Money agorot={item.obligation.outstandingAgorot} />
          </p>
          <Banner
            tone="warn"
            label="למה אי אפשר לסגור"
            headline="חוב בלי שם אי אפשר לסגור ואי אפשר לבטל"
            detail="עד שיירשם למי החוב, אי אפשר לסמן אותו כמסולק — ואין דרך להסיר אותו מהרשימה."
          />
        </>
      );

    case 'refused-row':
      return (
        <>
          <EvidenceGrid evidence={evidence} />
          <Banner
            tone="info"
            label="למה השורה סורבה"
            headline={item.refusal.message}
            detail="זו לא החלטה שממתינה לכם — המערכת עשתה את מה שנכון, והשורה מוצגת כדי שתדעו."
          />
        </>
      );

    case 'arithmetic-flag':
      return (
        <section className={styles.panel}>
          <div className={styles.sectionTitle}>החשבון שלא מסתדר</div>
          <dl className={styles.figures}>
            <div>
              <dt>כמות</dt>
              <dd><bdi>{item.line.quantityText ?? '—'}</bdi></dd>
            </div>
            <div>
              <dt>מחיר ליחידה</dt>
              <dd>
                {item.line.unitCostAgorot === null
                  ? '—' : <Money agorot={item.line.unitCostAgorot} />}
              </dd>
            </div>
            <div>
              <dt>סה״כ בגיליון</dt>
              <dd><Money agorot={item.line.totalAgorot} /></dd>
            </div>
          </dl>
          <Banner
            tone="info"
            label="מה המערכת עשתה עם זה"
            headline="הסכום נשמר כפי שנכתב בגיליון"
            detail="המערכת לא מתקנת חשבון של אדם. השורה מסומנת כדי שמישהו יבדוק, והסכום שנכתב הוא שנשמר."
          />
        </section>
      );
  }
}

export function ItemDetail({
  item, evidence, position, total, nextId, prevId, tab, kind, seasons = [],
}: {
  item: InboxItem | null;
  /** Read by the page, which is the one thing in this tree that may await. */
  evidence: Evidence | null;
  /** Read by the page as well: the choices a `set-season` control offers. */
  seasons?: ReadonlyArray<{ id: string; name: string }>;
  position: number;
  total: number;
  nextId: string | null;
  prevId: string | null;
  tab: 'decide' | 'notice' | 'done';
  kind: InboxGroup | 'all';
}): ReactElement | null {
  if (item === null) return null;

  const nextHref = nextId === null ? null : itemHref(tab, kind, nextId);
  const prevHref = prevId === null ? null : itemHref(tab, kind, prevId);

  return (
    <section className={styles.detail} aria-label="הפריט הפתוח">
      <header className={styles.detailHead}>
        <h2 className={styles.detailTitle}>{item.title}</h2>
        <p className={styles.position}>
          {/* A17: one isolate for the whole phrase. */}
          <bdi>{position} מתוך {total}</bdi>
        </p>
        <nav className={styles.stepper} aria-label="מעבר בין פריטים">
          {prevHref === null
            ? null
            : <Link href={prevHref} rel="prev">הקודם</Link>}
          {nextHref === null
            ? null
            : <Link href={nextHref} rel="next">הבא</Link>}
        </nav>
      </header>

      <p className={styles.detailLine}>{item.detail}</p>

      <Panels item={item} evidence={evidence} />

      <ActionBar
        itemId={item.id}
        itemKind={item.kind}
        actions={item.actions}
        nextHref={nextHref}
        alias={item.kind === 'unlinked-name' ? item.alias : ''}
        seasons={seasons}
      />

      <InboxKeyboard digits={digitMap(item)} prevHref={prevHref} nextHref={nextHref} />

      <p className={styles.footer}>{FOOTER}</p>
    </section>
  );
}
