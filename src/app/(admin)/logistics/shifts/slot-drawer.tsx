'use client';

/**
 * The scheduling drawer, in two modes.
 *
 * `slot === null` puts a type on the board: pick the kind, tick the days,
 * confirm the window and the head-count the type suggested, and one shift
 * is made per day. A slot edits that one shift — its window and head-count
 * — and is where people are put on it and taken off it.
 *
 * A client component because a form is state, and because staffing is a
 * conversation: a lead searches, ticks names, and places them in one action.
 * The drawer is still a URL (R6): the page reads `?peek=` / `?act=slot` and
 * hands it the record, the types, the days and the roster.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from '@/components/ui/drawer';
import { Checkbox, Field, Select, TextInput } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Icon } from '@/components/ui/icon';
import { Pill } from '@/components/ui/pill';
import { useToast } from '@/components/ui/toaster';
import { normalizeHebrew } from '@/lib/text/normalize';
/* `formatTime` is `HH:MM` on the camp's clock — exactly what a `time` input
   takes, and the one place the zone is read for the screen. */
import { formatTime as clockOf } from '@/lib/dates';
import {
  campDayOf, formatMinutes, formatWindow, parseClock, type EventDay,
} from '@/lib/logistics/shift-time';
import type { RosterOption, ScheduleSlot, ShiftType } from '@/lib/logistics/shifts';
import { slotHref, type RawParams } from '@/lib/logistics/shifts-views';
import {
  assignToShiftAction, cancelShiftSlotAction, scheduleShiftsAction,
  unassignFromShiftAction, updateShiftSlotAction,
} from './actions';
import {
  CLOCKS_REQUIRED, DAY_REQUIRED, PEOPLE_REQUIRED, TYPE_REQUIRED,
} from './failure-messages';
import styles from './shifts.module.css';

type Refusal = { where: 'type' | 'days' | 'clocks' | 'people' | 'form' | 'assign'; message: string };

export interface SlotDrawerProps {
  slot: ScheduleSlot | null;
  seasonId: string;
  closeHref: string;
  params: RawParams;
  /** Active types only — a retired one cannot be scheduled. */
  types: ShiftType[];
  days: EventDay[];
  /** The season's roster with its load on this schedule, lightest first. */
  roster: RosterOption[];
  presetTypeId?: string | null;
  presetDay?: string | null;
}

function loadText(option: { shifts: number; minutes: number }): string {
  if (option.shifts === 0) return 'בלי משמרת';
  return `${option.shifts === 1 ? 'משמרת אחת' : `${option.shifts} משמרות`} · ${formatMinutes(option.minutes)}`;
}

export function SlotDrawer({
  slot, seasonId, closeHref, params, types, days, roster,
  presetTypeId = null, presetDay = null,
}: SlotDrawerProps) {
  const router = useRouter();
  const { show } = useToast();

  const presetType = types.find((type) => type.id === presetTypeId) ?? null;
  const [typeId, setTypeId] = useState(presetType?.id ?? '');
  const [pickedDays, setPickedDays] = useState<string[]>(() =>
    presetDay !== null && days.some((day) => day.day === presetDay) ? [presetDay] : []);
  const [startsClock, setStartsClock] = useState(
    slot ? clockOf(slot.startsAt) : (presetType?.startsClock ?? ''),
  );
  const [endsClock, setEndsClock] = useState(
    slot ? clockOf(slot.endsAt) : (presetType?.endsClock ?? ''),
  );
  const [people, setPeople] = useState(String(slot?.peopleNeeded ?? presetType?.peopleNeeded ?? ''));
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  function errorFor(where: Refusal['where']): string | undefined {
    return refusal?.where === where ? refusal.message : undefined;
  }

  /** Choosing a type fills the window and the count from it — every time,
   *  so the hint can promise exactly that and nothing is half-kept. */
  function chooseType(id: string) {
    setTypeId(id);
    const type = types.find((candidate) => candidate.id === id);
    if (type) {
      setStartsClock(type.startsClock);
      setEndsClock(type.endsClock);
      setPeople(String(type.peopleNeeded));
    }
  }

  function toggleDay(day: string, checked: boolean) {
    setPickedDays((current) => checked
      ? [...new Set([...current, day])]
      : current.filter((one) => one !== day));
  }

  function checkWindow(): { peopleNeeded: number } | null {
    if (!parseClock(startsClock) || !parseClock(endsClock)) {
      setRefusal({ where: 'clocks', message: CLOCKS_REQUIRED }); return null;
    }
    const peopleNeeded = Number(people.trim());
    if (!Number.isInteger(peopleNeeded) || peopleNeeded < 1) {
      setRefusal({ where: 'people', message: PEOPLE_REQUIRED }); return null;
    }
    return { peopleNeeded };
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setRefusal(null);

    if (slot === null && typeId === '') { setRefusal({ where: 'type', message: TYPE_REQUIRED }); return; }
    if (slot === null && pickedDays.length === 0) { setRefusal({ where: 'days', message: DAY_REQUIRED }); return; }
    const checked = checkWindow();
    if (checked === null) return;

    setPending(true);
    try {
      if (slot === null) {
        const result = await scheduleShiftsAction({
          seasonId, shiftTypeId: typeId, days: pickedDays, startsClock, endsClock,
          peopleNeeded: checked.peopleNeeded,
        });
        if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
        const made = result.value ?? [];
        show({
          message: made.length === 1 ? 'המשמרת נוספה ללוח' : `${made.length} משמרות נוספו ללוח`,
          tone: 'ok',
        });
        /* One shift: open it, because the next thing a lead does is put
           people on it. Several: back to the board, where they all are. */
        router.push(made.length === 1 ? slotHref(params, made[0]) : closeHref);
        router.refresh();
        return;
      }

      const result = await updateShiftSlotAction(seasonId, slot.taskId, {
        startsClock, endsClock, peopleNeeded: checked.peopleNeeded,
      });
      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
      show({ message: 'המשמרת עודכנה', tone: 'ok' });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function assign() {
    if (slot === null || picked.length === 0) return;
    setRefusal(null);
    setPending(true);
    try {
      const result = await assignToShiftAction(slot.taskId, picked);
      setPicked([]);
      setQuery('');
      if (!result.ok) { setRefusal({ where: 'assign', message: result.error }); }
      else show({ message: picked.length === 1 ? 'שובץ למשמרת' : `${picked.length} שובצו למשמרת`, tone: 'ok' });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function unassign(assignmentId: string, displayName: string) {
    setRefusal(null);
    setPending(true);
    try {
      const result = await unassignFromShiftAction(assignmentId);
      if (!result.ok) { setRefusal({ where: 'assign', message: result.error }); return; }
      show({ message: `${displayName} הוסר מהמשמרת`, tone: 'ok' });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function cancel() {
    if (slot === null) return;
    setRefusal(null);
    setPending(true);
    try {
      const result = await cancelShiftSlotAction(slot.taskId);
      if (!result.ok) { setRefusal({ where: 'form', message: result.error }); return; }
      show({ message: 'המשמרת בוטלה', tone: 'ok' });
      setCancelling(false);
      router.push(closeHref);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const creating = slot === null;
  const slotDay = slot === null ? null : days.find((day) => day.day === campDayOf(slot.startsAt)) ?? null;
  const onShift = new Set(slot?.assignees.map((one) => one.personId) ?? []);
  const wanted = normalizeHebrew(query);
  const candidates = roster.filter((member) =>
    !onShift.has(member.personId)
    && (wanted === '' || normalizeHebrew(member.displayName).includes(wanted)));

  return (
    <Drawer
      title={creating ? 'שיבוץ משמרות ללוח' : slot.title}
      subtitle={creating ? 'משמרת אחת לכל יום שמסומן' : (
        <>
          {slotDay === null ? null : <>{slotDay.weekday}{' '}<bdi dir="ltr">{slotDay.dayMonth}</bdi>{' · '}</>}
          <bdi dir="ltr">{formatWindow(slot.startsAt, slot.endsAt)}</bdi>
          {' · '}
          <Pill tone={slot.uncovered ? 'warn' : 'ok'}>
            {`${slot.accepted} מתוך ${slot.peopleNeeded} מאוישים`}
          </Pill>
        </>
      )}
      closeHref={closeHref}
      width={500}
      phone="full"
      footer={(
        /* `.footActions`: one row on a laptop; on a phone the primary verb
           takes a row of its own and the rest share the next. */
        <span className={styles.footActions}>
          <Button tone="primary" onClick={() => { void save(); }} disabled={pending}>
            {creating ? 'הוספה ללוח' : 'שמירת השעות והכמות'}
          </Button>
          <Button onClick={() => { router.push(closeHref); }} disabled={pending}>
            {creating ? 'ביטול' : 'סגירה'}
          </Button>
          {creating ? null : (
            <Button tone="ghost" onClick={() => { setCancelling(true); }} disabled={pending}>
              ביטול המשמרת
            </Button>
          )}
        </span>
      )}
    >
      <form className={styles.form} onSubmit={save}>
        {creating ? (
          <>
            <Field
              id="slot-type"
              label="סוג משמרת"
              required
              error={errorFor('type')}
              hint={types.length === 0
                ? 'עדיין אין סוגי משמרות. קודם מוסיפים סוג, ואז משבצים אותו ללוח.'
                : 'השעות והכמות מתמלאות מהסוג; אפשר לשנות אותן לשיבוץ הזה בלבד.'}
            >
              <Select
                id="slot-type"
                value={typeId}
                emptyLabel="—"
                onChange={chooseType}
                options={types.map((type) => ({
                  value: type.id,
                  label: `${type.name} · ${type.startsClock}–${type.endsClock} · ${type.peopleNeeded}`,
                }))}
              />
            </Field>

            <Field id="slot-days" label="באילו ימים" as="group" required error={errorFor('days')}>
              <div className={styles.days} role="group" aria-labelledby="slot-days-label">
                {days.map((day) => (
                  <Checkbox
                    key={day.day}
                    id={`slot-day-${day.index}`}
                    label={`${day.weekday} ${day.dayMonth}`}
                    checked={pickedDays.includes(day.day)}
                    onChange={(checked) => { toggleDay(day.day, checked); }}
                    disabled={pending}
                  />
                ))}
              </div>
            </Field>
          </>
        ) : null}

        <div className={styles.pair}>
          <Field id="slot-starts" label="התחלה" required error={errorFor('clocks')}>
            <input
              className={styles.plainInput}
              id="slot-starts"
              type="time" step="300" value={startsClock}
              onChange={(event) => { setStartsClock(event.target.value); }}
            />
          </Field>
          <Field id="slot-ends" label="סיום" required hint="סיום מוקדם מההתחלה פירושו למחרת.">
            <input
              className={styles.plainInput}
              id="slot-ends"
              type="time" step="300" value={endsClock}
              onChange={(event) => { setEndsClock(event.target.value); }}
            />
          </Field>
        </div>

        <Field id="slot-people" label="כמה אנשים נדרשים" required error={errorFor('people')}>
          <input
            className={styles.plainInput}
            id="slot-people"
            type="number" min="1" step="1" inputMode="numeric" value={people}
            onChange={(event) => { setPeople(event.target.value); }}
          />
        </Field>

        {refusal?.where === 'form' && (
          <p className={styles.formError} role="alert">{refusal.message}</p>
        )}
      </form>

      {slot === null ? null : (
        <section className={`${styles.form} ${styles.divider}`} aria-label="מי במשמרת">
          <h3 className={styles.subhead}>מי במשמרת</h3>
          {slot.assignees.length === 0 ? (
            <p className={styles.empty}>עדיין אף אחד. בוחרים מהרשימה למטה.</p>
          ) : (
            <ul className={styles.people}>
              {slot.assignees.map((one) => (
                <li key={one.assignmentId} className={styles.person}>
                  <span>{one.displayName}</span>
                  {one.status === 'proposed' ? <Pill tone="neutral">בהמתנה לאישור</Pill> : null}
                  <Button
                    tone="ghost" size="sm"
                    iconLabel={`הסרת ${one.displayName} מהמשמרת`}
                    onClick={() => { void unassign(one.assignmentId, one.displayName); }}
                    disabled={pending}
                  >
                    <Icon name="x" size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <h3 className={styles.subhead}>הוספת אנשים</h3>
          {roster.length === 0 ? (
            <p className={styles.empty}>אין חברים ברשימת השנה הזו. חברים נוספים במסך אנשים.</p>
          ) : (
            <>
              <Field id="slot-search" label="חיפוש ברשימת החברים" labelHidden>
                <TextInput id="slot-search" value={query} onChange={setQuery} icon="search" />
              </Field>
              <div className={styles.candidates}>
                {candidates.length === 0 ? (
                  <p className={styles.empty}>אין חבר שמתאים לחיפוש.</p>
                ) : candidates.map((member) => (
                  <div key={member.personId} className={styles.candidate}>
                    <Checkbox
                      id={`slot-pick-${member.personId}`}
                      label={member.displayName}
                      checked={picked.includes(member.personId)}
                      onChange={(checked) => {
                        setPicked((current) => checked
                          ? [...new Set([...current, member.personId])]
                          : current.filter((id) => id !== member.personId));
                      }}
                      disabled={pending}
                    />
                    <span className={styles.personLoad}><bdi>{loadText(member)}</bdi></span>
                  </div>
                ))}
              </div>
              <div className={styles.actions}>
                <Button tone="primary" size="sm" onClick={() => { void assign(); }} disabled={pending || picked.length === 0}>
                  {picked.length <= 1 ? 'שיבוץ למשמרת' : `שיבוץ ${picked.length} למשמרת`}
                </Button>
              </div>
            </>
          )}
          {refusal?.where === 'assign' && (
            <p className={styles.formError} role="alert">{refusal.message}</p>
          )}
        </section>
      )}

      {cancelling && slot !== null ? (
        <ConfirmDialog
          title="ביטול משמרת"
          consequence={`${slot.title} ב${slotDay?.weekday ?? ''} ${formatWindow(slot.startsAt, slot.endsAt)} תרד מהלוח. השיבוצים שלה נשארים רשומים במשימות כמשמרת שבוטלה.`}
          confirmLabel="ביטול המשמרת"
          cancelLabel="השארה בלוח"
          tone="danger"
          onConfirm={() => { void cancel(); }}
          onCancel={() => { setCancelling(false); }}
        />
      ) : null}
    </Drawer>
  );
}
