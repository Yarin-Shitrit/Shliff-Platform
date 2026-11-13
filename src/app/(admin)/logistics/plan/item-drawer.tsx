'use client';

/**
 * The item drawer, in two modes.
 *
 * `item === null` adds one: what it is, under which topic or as a part of
 * which item, on which days, who owns it. An item edits the same fields and
 * is also where its state is set, where its sub-items are started, and
 * where what it waits for is declared and withdrawn.
 *
 * A client component because a form is state. The drawer is still a URL
 * (R6): the page reads `?peek=` / `?act=item` and hands it the record, the
 * topics, the items it may hang under and the roster.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, Select, TextInput, Textarea } from '@/components/ui/field';
import { Button, ButtonLink } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Icon } from '@/components/ui/icon';
import { Pill } from '@/components/ui/pill';
import { useToast } from '@/components/ui/toaster';
import { DateText } from '@/components/format';
import { isBlank } from '@/lib/text/normalize';
import { isCivilDay } from '@/lib/logistics/shift-time';
import type { PlanItem, RosterOption, Topic } from '@/lib/logistics/plan';
import { itemHref, newItemHref, type RawParams } from '@/lib/logistics/plan-views';
import { acquisitionHref } from '@/lib/logistics/acquisitions-views';
import {
  STATUS_LABELS, STATUS_TONES, WORK_STATUS_LABELS, WORK_STATUS_TONES,
} from '@/lib/logistics/labels';
import {
  addDependencyAction, createItemAction, removeDependencyAction,
  setItemStatusAction, updateItemAction,
} from './actions';
import {
  BAD_DAY, DEPENDENCY_REQUIRED, END_BEFORE_START, END_WITHOUT_START, TITLE_REQUIRED,
} from './failure-messages';
import styles from './plan.module.css';

type Refusal = { where: 'title' | 'days' | 'form' | 'dependency'; message: string };

export interface ParentOption {
  id: string;
  title: string;
  topicId: string | null;
}

export interface ItemOption {
  id: string;
  title: string;
}

export interface ItemDrawerProps {
  item: PlanItem | null;
  seasonId: string;
  closeHref: string;
  params: RawParams;
  /** Active topics only. */
  topics: Topic[];
  /** General items this one may be a part of — never itself. */
  parents: ParentOption[];
  /** Every other item of the season, for the dependency picker. */
  others: ItemOption[];
  roster: RosterOption[];
  presetTopicId?: string | null;
  presetParentId?: string | null;
}

const TITLE_ID = 'plan-item-title';

/**
 * The React key the page gives the drawer: one per thing it can be over.
 * Every way into the drawer is a link, and a link from inside it (״תת־משימה״
 * on an open item) re-renders the same component with new props. The form's
 * fields are state seeded from those props once, so without a key that
 * changes, the new part kept the open item's title and lost its parent.
 */
export function itemDrawerKey(
  item: PlanItem | null, presetParentId: string | null = null, presetTopicId: string | null = null,
): string {
  if (item !== null) return `item:${item.id}`;
  return `new:parent=${presetParentId ?? ''}:topic=${presetTopicId ?? ''}`;
}

export function ItemDrawer({
  item, seasonId, closeHref, params, topics, parents, others, roster,
  presetTopicId = null, presetParentId = null,
}: ItemDrawerProps) {
  const router = useRouter();
  const { show } = useToast();

  const presetParent = parents.find((parent) => parent.id === presetParentId) ?? null;
  const [title, setTitle] = useState(item?.title ?? '');
  const [parentId, setParentId] = useState(item?.parentId ?? presetParent?.id ?? '');
  const [topicId, setTopicId] = useState(item?.topicId ?? presetParent?.topicId ?? presetTopicId ?? '');
  const [startsOn, setStartsOn] = useState(item?.startsOn ?? '');
  const [endsOn, setEndsOn] = useState(item?.endsOn ?? '');
  const [assignee, setAssignee] = useState(item?.assignee?.personId ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [beforeId, setBeforeId] = useState('');
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  function errorFor(where: Refusal['where']): string | undefined {
    return refusal?.where === where ? refusal.message : undefined;
  }

  /** Choosing a parent fixes the topic to the parent's: a part has no
   *  heading of its own. */
  function chooseParent(id: string) {
    setParentId(id);
    const parent = parents.find((candidate) => candidate.id === id);
    if (parent) setTopicId(parent.topicId ?? '');
  }

  function checkDays(): boolean {
    const starts = startsOn.trim();
    const ends = endsOn.trim();
    if (starts !== '' && !isCivilDay(starts)) { setRefusal({ where: 'days', message: BAD_DAY }); return false; }
    if (ends !== '' && !isCivilDay(ends)) { setRefusal({ where: 'days', message: BAD_DAY }); return false; }
    if (ends !== '' && starts === '') { setRefusal({ where: 'days', message: END_WITHOUT_START }); return false; }
    if (ends !== '' && ends < starts) { setRefusal({ where: 'days', message: END_BEFORE_START }); return false; }
    return true;
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setRefusal(null);
    if (isBlank(title)) { setRefusal({ where: 'title', message: TITLE_REQUIRED }); return; }
    if (!checkDays()) return;

    const input = {
      title,
      notes: isBlank(notes) ? null : notes,
      topicId: topicId || null,
      parentId: parentId || null,
      startsOn: startsOn.trim() || null,
      endsOn: endsOn.trim() || null,
      assigneePersonId: assignee || null,
    };
    setPending(true);
    try {
      const result = item === null
        ? await createItemAction(seasonId, input)
        : await updateItemAction(item.id, input);
      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
      show({ message: item === null ? `${title.trim()} נוספה ללוח` : `${title.trim()} עודכנה`, tone: 'ok' });
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function setStatus(status: PlanItem['status']) {
    if (item === null) return;
    setRefusal(null);
    setPending(true);
    try {
      const result = await setItemStatusAction(item.id, status);
      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
      show({ message: `${item.title} · ${WORK_STATUS_LABELS[status]}`, tone: 'ok' });
      setCancelling(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function addBefore() {
    if (item === null) return;
    setRefusal(null);
    if (beforeId === '') { setRefusal({ where: 'dependency', message: DEPENDENCY_REQUIRED }); return; }
    setPending(true);
    try {
      const result = await addDependencyAction(beforeId, item.id);
      if (!result.ok) { setRefusal({ where: 'dependency', message: result.error }); return; }
      setBeforeId('');
      show({ message: 'הקשר נשמר', tone: 'ok' });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function removeBefore(dependencyId: string) {
    setRefusal(null);
    setPending(true);
    try {
      const result = await removeDependencyAction(dependencyId);
      if (!result.ok) { setRefusal({ where: 'dependency', message: result.error }); return; }
      show({ message: 'הקשר הוסר', tone: 'ok' });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const creating = item === null;
  const isSub = parentId !== '';
  const waitingIds = new Set(item?.waitsFor.map((dep) => dep.itemId) ?? []);
  const candidates = others.filter((other) => !waitingIds.has(other.id));
  /* A purchase's line: its name, its person and its done/open state are the
     row's on רכש, and the fields that hold them point there. */
  const purchase = item?.purchase ?? null;
  const purchaseHref = purchase === null ? null : acquisitionHref(params, purchase.id);

  return (
    <Drawer
      title={creating ? (presetParent === null ? 'משימה חדשה' : `תת־משימה של ${presetParent.title}`) : item.title}
      subtitle={creating ? 'מה צריך להכין, ומתי' : (
        <>
          <Pill tone={WORK_STATUS_TONES[item.status]} dot>{WORK_STATUS_LABELS[item.status]}</Pill>
          {purchase === null ? null : (
            <>{' · '}<Pill tone={STATUS_TONES[purchase.status]} dot>{`רכש · ${STATUS_LABELS[purchase.status]}`}</Pill></>
          )}
          {' · עודכן '}
          <DateText at={item.updatedAt} />
          {item.updatedBy === null ? null : <>{' · '}{item.updatedBy}</>}
        </>
      )}
      closeHref={closeHref}
      phone="full"
      footer={(
        <span className={styles.footActions}>
          <Button tone="primary" onClick={() => { void save(); }} disabled={pending}>
            {creating ? 'הוספה ללוח' : 'שמירה'}
          </Button>
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>ביטול</Button>
          {creating ? null : purchaseHref !== null && item.status !== 'cancelled' ? (
            <ButtonLink tone="ghost" href={purchaseHref}>
              <Icon name="link" size={14} />
              הסטטוס ברשימת הרכש
            </ButtonLink>
          ) : item.status === 'open' ? (
            <Button tone="ghost" onClick={() => { void setStatus('done'); }} disabled={pending}>
              <Icon name="check" size={14} />
              סימון כהושלמה
            </Button>
          ) : (
            <Button tone="ghost" onClick={() => { void setStatus('open'); }} disabled={pending}>
              פתיחה מחדש
            </Button>
          )}
        </span>
      )}
    >
      <form className={styles.form} onSubmit={save}>
        <Field
          id={TITLE_ID}
          label="מה צריך לעשות"
          required
          error={errorFor('title')}
          hint={purchaseHref === null
            ? '״להכין מכולת מטבח״, ״לתקן מקררים״, ״יום עבודה של בניית ספסלים״.'
            : <>{'השם נקבע לפי הפריט '}<Link href={purchaseHref}>ברשימת הרכש</Link>{' — שינוי השם, הכמות או דרך ההשגה נעשה שם.'}</>}
        >
          <TextInput id={TITLE_ID} value={title} onChange={setTitle} disabled={purchaseHref !== null} />
        </Field>

        <Field
          id="plan-item-parent"
          label="חלק ממשימה"
          hint={parents.length === 0
            ? 'אין עדיין משימות כלליות לפרק. משימה כללית היא כותרת כמו ״להכין סלון״; אחר כך מוסיפים לה חלקים.'
            : 'תת־משימה של משימה כללית. חלק יושב תחת הנושא של המשימה שלו.'}
        >
          <Select
            id="plan-item-parent"
            value={parentId}
            onChange={chooseParent}
            emptyLabel="משימה כללית — לא חלק של משימה אחרת"
            options={parents.map((parent) => ({ value: parent.id, label: parent.title }))}
          />
        </Field>

        <Field
          id="plan-item-topic"
          label="נושא"
          hint={isSub ? 'נקבע לפי המשימה שזה חלק ממנה.' : 'תחת איזו כותרת המשימה מופיעה בלוח.'}
        >
          <Select
            id="plan-item-topic"
            value={topicId}
            onChange={setTopicId}
            disabled={isSub}
            emptyLabel="בלי נושא"
            options={topics.map((topic) => ({ value: topic.id, label: topic.name }))}
          />
        </Field>

        <div className={styles.pair}>
          <Field id="plan-item-starts" label="מתחילים ביום" error={errorFor('days')} hint="ריק פירושו שעדיין לא נקבע.">
            <input
              className={styles.plainInput}
              id="plan-item-starts"
              type="date" value={startsOn}
              onChange={(event) => { setStartsOn(event.target.value); }}
            />
          </Field>
          <Field id="plan-item-ends" label="מסיימים ביום" hint="ריק פירושו יום אחד.">
            <input
              className={styles.plainInput}
              id="plan-item-ends"
              type="date" value={endsOn}
              onChange={(event) => { setEndsOn(event.target.value); }}
            />
          </Field>
        </div>

        <Field
          id="plan-item-assignee"
          label="אחראי"
          hint={purchaseHref === null
            ? 'מי מרשימת השנה מוביל את זה.'
            : <>{'מי שאחראי להשיג, לפי הפריט '}<Link href={purchaseHref}>ברשימת הרכש</Link>{'.'}</>}
        >
          <Select
            id="plan-item-assignee"
            value={assignee}
            onChange={setAssignee}
            disabled={purchaseHref !== null}
            emptyLabel="עדיין לא נקבע"
            options={roster.map((person) => ({ value: person.personId, label: person.displayName }))}
          />
        </Field>

        <Field id="plan-item-notes" label="הערות">
          <Textarea id="plan-item-notes" value={notes} onChange={setNotes} rows={3} />
        </Field>

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
      </form>

      {item === null ? null : (
        <>
          <div className={styles.divider} />
          <section aria-label="סדר" className={styles.form}>
            <h3 className={styles.subhead}>חייבת להסתיים קודם</h3>
            {item.waitsFor.length === 0 ? (
              <p className={styles.empty}>לא נקבע מה צריך להיות מוכן לפני המשימה הזו.</p>
            ) : (
              <ul className={styles.links}>
                {item.waitsFor.map((dep) => (
                  <li key={dep.dependencyId} className={styles.linkRow}>
                    <span>
                      <Link href={itemHref(params, dep.itemId)}>{dep.title}</Link>
                      {dep.conflict ? (
                        <>{' '}<Pill tone="warn">לא מסתיימת קודם</Pill></>
                      ) : dep.status === 'done' ? (
                        <>{' '}<Pill tone="ok">הושלמה</Pill></>
                      ) : null}
                    </span>
                    <Button
                      size="sm" tone="ghost" iconLabel={`הסרת הקשר ל${dep.title}`}
                      disabled={pending}
                      onClick={() => { void removeBefore(dep.dependencyId); }}
                    >
                      <Icon name="x" size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {candidates.length === 0 ? null : (
              <div className={styles.addRow}>
                <Field id="plan-item-before" label="הוספת משימה שחייבת להסתיים קודם" error={errorFor('dependency')}>
                  <Select
                    id="plan-item-before"
                    value={beforeId}
                    onChange={setBeforeId}
                    emptyLabel="בחירת משימה"
                    options={candidates.map((other) => ({ value: other.id, label: other.title }))}
                  />
                </Field>
                <Button size="sm" onClick={() => { void addBefore(); }} disabled={pending}>
                  <Icon name="plus" size={14} />
                  הוספה
                </Button>
              </div>
            )}
            {refusal?.where === 'dependency' && candidates.length === 0 ? (
              <p className={styles.formError} role="alert">{refusal.message}</p>
            ) : null}

            {item.blocks.length === 0 ? null : (
              <>
                <h3 className={styles.subhead}>מחכות למשימה הזו</h3>
                <ul className={styles.links}>
                  {item.blocks.map((dep) => (
                    <li key={dep.dependencyId} className={styles.linkRow}>
                      <span>
                        <Link href={itemHref(params, dep.itemId)}>{dep.title}</Link>
                        {dep.conflict ? <>{' '}<Pill tone="warn">מתחילה לפני שזו נגמרת</Pill></> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <div className={styles.divider} />
          <div className={styles.actions}>
            {item.parentId === null ? (
              <ButtonLink size="sm" href={newItemHref(params, { parentId: item.id })}>
                <Icon name="plus" size={14} />
                תת־משימה
              </ButtonLink>
            ) : null}
            {item.status === 'cancelled' ? null : (
              <Button size="sm" tone="ghost" onClick={() => { setCancelling(true); }} disabled={pending}>
                ביטול המשימה
              </Button>
            )}
          </div>
        </>
      )}

      {cancelling && item !== null ? (
        <ConfirmDialog
          title="ביטול משימה"
          consequence={`${item.title} תסומן כבוטלה: היא יורדת מציר הזמן ונשארת ברשימה. תת־המשימות שלה נשארות כמו שהן, ואפשר לפתוח אותה מחדש.`}
          confirmLabel="ביטול המשימה"
          onConfirm={() => { void setStatus('cancelled'); }}
          onCancel={() => { setCancelling(false); }}
        />
      ) : null}
    </Drawer>
  );
}
