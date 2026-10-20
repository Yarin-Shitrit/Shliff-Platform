'use client';

/**
 * One form in two modes: `type === null` adds a kind of shift, and a type
 * edits it. A client component because a form is state. The drawer is still
 * a URL (R6): the page reads `?type=` / `?act=type` and hands it the record.
 *
 * A type is a template — its clocks and its head-count pre-fill the
 * scheduling drawer and nothing else. Changing them here changes no slot
 * already on the board, and the hint says so, because the alternative reading
 * ("fix the bar's hours in one place") is the one a lead would assume.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Field, TextInput, Textarea } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Pill } from '@/components/ui/pill';
import { useToast } from '@/components/ui/toaster';
import { DateText } from '@/components/format';
import { isBlank } from '@/lib/text/normalize';
import { parseClock } from '@/lib/logistics/shift-time';
import type { ShiftType } from '@/lib/logistics/shifts';
import {
  createShiftTypeAction, updateShiftTypeAction, setShiftTypeRetiredAction,
} from './actions';
import { CLOCKS_REQUIRED, PEOPLE_REQUIRED, TYPE_NAME_REQUIRED } from './failure-messages';
import styles from './shifts.module.css';

type Refusal = { where: 'name' | 'clocks' | 'people' | 'form'; message: string };

const NAME_ID = 'shift-type-name';

export function TypeDrawer({ type, closeHref }: { type: ShiftType | null; closeHref: string }) {
  const router = useRouter();
  const { show } = useToast();

  const [name, setName] = useState(type?.name ?? '');
  const [startsClock, setStartsClock] = useState(type?.startsClock ?? '16:00');
  const [endsClock, setEndsClock] = useState(type?.endsClock ?? '20:00');
  const [people, setPeople] = useState(String(type?.peopleNeeded ?? 2));
  const [notes, setNotes] = useState(type?.notes ?? '');
  const [pending, setPending] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  function errorFor(where: Refusal['where']): string | undefined {
    return refusal?.where === where ? refusal.message : undefined;
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setRefusal(null);

    if (isBlank(name)) { setRefusal({ where: 'name', message: TYPE_NAME_REQUIRED }); return; }
    if (!parseClock(startsClock) || !parseClock(endsClock)) {
      setRefusal({ where: 'clocks', message: CLOCKS_REQUIRED }); return;
    }
    const peopleNeeded = Number(people.trim());
    if (!Number.isInteger(peopleNeeded) || peopleNeeded < 1) {
      setRefusal({ where: 'people', message: PEOPLE_REQUIRED }); return;
    }

    const input = {
      name, startsClock, endsClock, peopleNeeded, notes: isBlank(notes) ? null : notes,
    };
    setPending(true);
    try {
      const result = type === null
        ? await createShiftTypeAction(input)
        : await updateShiftTypeAction(type.id, input);
      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
      show({ message: type === null ? `${name.trim()} נוסף לסוגי המשמרות` : `${name.trim()} עודכן`, tone: 'ok' });
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function setRetired(retired: boolean) {
    if (type === null) return;
    setRefusal(null);
    setPending(true);
    try {
      const result = await setShiftTypeRetiredAction(type.id, retired);
      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
      show({ message: retired ? `${type.name} יצא משימוש` : `${type.name} חזר לשימוש`, tone: 'ok' });
      setRetiring(false);
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const creating = type === null;
  const retired = type?.retiredAt !== null && type?.retiredAt !== undefined;

  return (
    <Drawer
      title={creating ? 'סוג משמרת חדש' : type.name}
      subtitle={creating ? 'כלל־קאמפי — אותם סוגים בכל שנה' : (
        <>
          {retired ? <Pill tone="outline">יצא משימוש</Pill> : null}
          {retired ? ' · ' : ''}
          {'עודכן לאחרונה '}
          <DateText at={type.updatedAt} />
          {type.updatedBy === null ? null : <>{' · '}{type.updatedBy}</>}
        </>
      )}
      closeHref={closeHref}
      phone="full"
      footer={(
        /* `.footActions`: one row on a laptop; on a phone the primary verb
           takes a row of its own and the rest share the next. */
        <span className={styles.footActions}>
          <Button tone="primary" onClick={() => { void save(); }} disabled={pending}>
            {creating ? 'הוספת הסוג' : 'שמירה'}
          </Button>
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>ביטול</Button>
          {creating ? null : retired ? (
            <Button tone="ghost" onClick={() => { void setRetired(false); }} disabled={pending}>
              החזרה לשימוש
            </Button>
          ) : (
            <Button tone="ghost" onClick={() => { setRetiring(true); }} disabled={pending}>
              הוצאה משימוש
            </Button>
          )}
        </span>
      )}
    >
      <form className={styles.form} onSubmit={save}>
        <Field id={NAME_ID} label="שם המשמרת" required error={errorFor('name')} hint="״בר״, ״מטבח״, ״שער״ — כפי שיופיע בלוח ובהדפסה.">
          <TextInput id={NAME_ID} value={name} onChange={setName} />
        </Field>

        <div className={styles.pair}>
          <Field id="shift-type-starts" label="שעת התחלה רגילה" required error={errorFor('clocks')}>
            <input
              className={styles.plainInput}
              id="shift-type-starts"
              type="time" step="300" value={startsClock}
              onChange={(event) => { setStartsClock(event.target.value); }}
            />
          </Field>
          <Field id="shift-type-ends" label="שעת סיום רגילה" required hint="סיום מוקדם מההתחלה פירושו למחרת, למשל 22:00–02:00.">
            <input
              className={styles.plainInput}
              id="shift-type-ends"
              type="time" step="300" value={endsClock}
              onChange={(event) => { setEndsClock(event.target.value); }}
            />
          </Field>
        </div>

        <Field
          id="shift-type-people"
          label="כמה אנשים נדרשים בדרך כלל"
          required
          error={errorFor('people')}
          hint="ממלא מראש כל שיבוץ חדש של הסוג הזה. שינוי כאן לא משנה משמרות שכבר בלוח."
        >
          <input
            className={styles.plainInput}
            id="shift-type-people"
            type="number" min="1" step="1" inputMode="numeric" value={people}
            onChange={(event) => { setPeople(event.target.value); }}
          />
        </Field>

        <Field id="shift-type-notes" label="הערות" hint="מה צריך לדעת מי שלוקח את המשמרת הזו.">
          <Textarea id="shift-type-notes" value={notes} onChange={setNotes} rows={3} />
        </Field>

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
      </form>

      {retiring && type !== null ? (
        <ConfirmDialog
          title="הוצאת סוג משמרת משימוש"
          consequence={`${type.name} ייעלם מבחירת הסוגים. המשמרות שכבר בלוח נשארות, והסוג יופיע ברשימה כ״יצא משימוש״ ואפשר להחזיר אותו.`}
          confirmLabel="הוצאה משימוש"
          onConfirm={() => { void setRetired(true); }}
          onCancel={() => { setRetiring(false); }}
        />
      ) : null}
    </Drawer>
  );
}
