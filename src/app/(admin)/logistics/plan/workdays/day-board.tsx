'use client';

/**
 * One work day as a board: its tasks with their crews in the middle, and on
 * either side what can land on them — the plan's tasks the day does not hold
 * yet, and the people on none of its tasks. Both sources sit beside the
 * tasks on a wide screen, so neither drag has to cross a scroll.
 *
 * Two moves, each made two ways. A task is pulled onto the day by dragging
 * it from the pool onto the day's tasks, or by its ״ליום הזה״ button; a
 * person is put on a task by dragging their chip onto its card, or through
 * the task's drawer. The buttons are the whole of the feature — the drag is
 * the same write with a faster hand, and a finger on a phone has no drag.
 *
 * Every write happens at once and says so, with the undo being the same
 * write the other way (E2). The page's refresh brings the real state back
 * under the board. Nothing here resolves a clash: someone pulled onto a
 * second task of the day is reported by the page's banner, not refused.
 *
 * The native drag carries only an id under a type of its own, so a text or
 * a file dropped here lands nowhere.
 */

import { useState } from 'react';
import type { DragEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toaster';
import { cx } from '@/components/ui/cx';
import { WORK_STATUS_LABELS, WORK_STATUS_TONES } from '@/lib/logistics/labels';
import { daysWords } from '@/lib/logistics/workdays-views';
import { placeTaskAction, setCrewMemberAction } from './actions';
import styles from './workdays.module.css';

export interface BoardCrew {
  personId: string;
  displayName: string;
  /** False for someone on the task who has left the season's roster. */
  onRoster: boolean;
  /** On another of this day's tasks as well. Said on the chip, in a word. */
  doubled?: boolean;
}

export interface BoardTask {
  id: string;
  title: string;
  /** The task's drawer on לוח עבודה. */
  href: string;
  /** The drawer that sets who is on it; null when this account only reads. */
  crewHref: string | null;
  topicName: string | null;
  parentTitle: string | null;
  assigneeName: string | null;
  done: boolean;
  /** The days it has, for the undo of taking it off this one. */
  startsOn: string;
  endsOn: string | null;
  crew: BoardCrew[];
}

export interface BoardPerson {
  personId: string;
  displayName: string;
  /** Their page under אנשים. */
  href: string;
}

export interface PoolTask {
  id: string;
  title: string;
  topicName: string | null;
  parentTitle: string | null;
  startsOn: string | null;
  endsOn: string | null;
}

export interface BoardDay {
  id: string;
  label: string;
  /** `YYYY-MM-DD`. */
  heldOn: string;
  /** `יום עבודה · יום שבת 14/03/2026`, for the heading. */
  words: string;
}

/** The drag's own types: nothing else dropped on the board is read. */
const TASK_TYPE = 'application/x-shliff-task';
const PERSON_TYPE = 'application/x-shliff-person';

const FILTER_ID = 'pool-filter';

function carries(event: DragEvent, type: string): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(type);
}

export function DayBoard({
  day, tasks, free, pool, rosterSize, seasonName, canEdit, planHref, attendanceHref,
}: {
  day: BoardDay;
  tasks: readonly BoardTask[];
  /** Roster members on none of the day's tasks, by name. */
  free: readonly BoardPerson[];
  /** The plan's open tasks the day does not hold: no day first, then another day. */
  pool: { unscheduled: readonly PoolTask[]; elsewhere: readonly PoolTask[] };
  rosterSize: number;
  seasonName: string;
  canEdit: boolean;
  planHref: string;
  /** This day on לוח הנוכחות; null when this account cannot open it. */
  attendanceHref: string | null;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [filter, setFilter] = useState('');
  /* What is being dragged, so every place it can land says so. */
  const [dragging, setDragging] = useState<'task' | 'person' | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [writing, setWriting] = useState<string | null>(null);

  const dayWhen = daysWords(day.heldOn, null);

  // ── Tasks onto the day and off it ───────────────────────────────────

  async function pull(task: PoolTask) {
    const before = { startsOn: task.startsOn, endsOn: task.endsOn };
    setWriting(task.id);
    try {
      const result = await placeTaskAction(task.id, { startsOn: day.heldOn, endsOn: null });
      if (!result.ok) { show({ message: result.error, tone: 'bad' }); return; }
      show({
        message: task.startsOn === null
          ? `${task.title} שויכה ל${day.label} · ${dayWhen}`
          : `${task.title} עברה ל${day.label} · ${dayWhen} · הייתה ב${daysWords(task.startsOn, task.endsOn)}`,
        tone: 'ok',
        undo: { label: 'ביטול', run: () => placeTaskAction(task.id, before) },
      });
      router.refresh();
    } finally {
      setWriting(null);
    }
  }

  async function remove(task: BoardTask) {
    const before = { startsOn: task.startsOn, endsOn: task.endsOn };
    const span = task.endsOn !== null && task.endsOn !== task.startsOn;
    setWriting(task.id);
    try {
      const result = await placeTaskAction(task.id, { startsOn: null, endsOn: null });
      if (!result.ok) { show({ message: result.error, tone: 'bad' }); return; }
      show({
        message: span
          ? `${task.title} הוסרה מ${day.label} · הימים ${daysWords(task.startsOn, task.endsOn)} נמחקו, והיא בלי יום`
          : `${task.title} הוסרה מ${day.label} · עכשיו בלי יום`,
        tone: 'ok',
        undo: { label: 'ביטול', run: () => placeTaskAction(task.id, before) },
      });
      router.refresh();
    } finally {
      setWriting(null);
    }
  }

  // ── People onto a task and off it ───────────────────────────────────

  async function setCrew(task: BoardTask, person: { personId: string; displayName: string }, on: boolean) {
    setWriting(`${task.id}:${person.personId}`);
    try {
      const result = await setCrewMemberAction(task.id, person.personId, on);
      if (!result.ok) { show({ message: result.error, tone: 'bad' }); return; }
      show({
        message: on
          ? `${person.displayName} · נוסף שיבוץ ל${task.title}`
          : `${person.displayName} · הוסר השיבוץ ל${task.title}`,
        tone: 'ok',
        undo: { label: 'ביטול', run: () => setCrewMemberAction(task.id, person.personId, !on) },
      });
      router.refresh();
    } finally {
      setWriting(null);
    }
  }

  // ── The drag ────────────────────────────────────────────────────────

  function startTask(event: DragEvent<HTMLElement>, id: string) {
    event.dataTransfer.setData(TASK_TYPE, id);
    event.dataTransfer.effectAllowed = 'move';
    setDragging('task');
  }

  function startPerson(event: DragEvent<HTMLElement>, id: string) {
    event.dataTransfer.setData(PERSON_TYPE, id);
    event.dataTransfer.effectAllowed = 'copy';
    setDragging('person');
  }

  function end() {
    setDragging(null);
    setOver(null);
  }

  /* `getData` is empty until the drop in most browsers; `types` is not. */
  function allowTask(event: DragEvent<HTMLElement>) {
    if (!canEdit || !carries(event, TASK_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (over !== 'day') setOver('day');
  }

  function dropTask(event: DragEvent<HTMLElement>) {
    if (!carries(event, TASK_TYPE)) return;
    event.preventDefault();
    const id = event.dataTransfer.getData(TASK_TYPE);
    end();
    const task = [...pool.unscheduled, ...pool.elsewhere].find((one) => one.id === id);
    if (task) void pull(task);
  }

  function allowPerson(event: DragEvent<HTMLElement>, task: BoardTask) {
    if (!canEdit || !carries(event, PERSON_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (over !== task.id) setOver(task.id);
  }

  function dropPerson(event: DragEvent<HTMLElement>, task: BoardTask) {
    if (!carries(event, PERSON_TYPE)) return;
    event.preventDefault();
    /* A card inside the day's list: the day must not read this drop as a task. */
    event.stopPropagation();
    const id = event.dataTransfer.getData(PERSON_TYPE);
    end();
    const person = free.find((one) => one.personId === id);
    if (!person) return;
    if (task.crew.some((one) => one.personId === id)) return;
    void setCrew(task, person, true);
  }

  function leave(event: DragEvent<HTMLElement>) {
    /* Leaving for a child of the same target is not leaving. */
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setOver(null);
  }

  // ── The pool ────────────────────────────────────────────────────────

  const wanted = filter.trim();
  const matches = (task: PoolTask) => wanted === '' || task.title.includes(wanted)
    || (task.topicName ?? '').includes(wanted) || (task.parentTitle ?? '').includes(wanted);
  const unscheduled = pool.unscheduled.filter(matches);
  const elsewhere = pool.elsewhere.filter(matches);
  const poolSize = pool.unscheduled.length + pool.elsewhere.length;

  function poolRows(rows: readonly PoolTask[], heading: string, hint: string) {
    if (rows.length === 0) return null;
    return (
      <div className={styles.poolGroup}>
        <h3 className={styles.poolHeading}>
          <bdi>{heading}</bdi>
          <span className={styles.sectionHint}>{hint}</span>
        </h3>
        <ul className={styles.poolList}>
          {rows.map((task) => (
            <li
              key={task.id}
              className={styles.poolRow}
              draggable
              onDragStart={(event) => startTask(event, task.id)}
              onDragEnd={end}
            >
              <Icon name="updown" size={14} />
              <span className={styles.poolWords}>
                <span className={styles.poolTitle}>{task.title}</span>
                <span className={styles.poolMeta}>
                  <bdi>{task.topicName ?? 'בלי נושא'}</bdi>
                  {task.parentTitle === null ? null : <>{' · '}<bdi>{`חלק של ${task.parentTitle}`}</bdi></>}
                  {task.startsOn === null ? null : <>{' · '}<bdi>{daysWords(task.startsOn, task.endsOn)}</bdi></>}
                </span>
              </span>
              <Button size="sm" disabled={writing === task.id} onClick={() => { void pull(task); }}>
                <Icon name="arrowl" size={14} />
                ליום הזה
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className={cx(styles.board, !canEdit && styles.boardRead)}>
      <div className={styles.boardMain}>
        <section
          className={cx(
            styles.section, styles.dayZone,
            dragging === 'task' && styles.zoneReady,
            dragging === 'task' && over === 'day' && styles.zoneOver,
          )}
          id="tasks"
          aria-label="המשימות של היום"
          onDragOver={allowTask}
          onDragEnter={allowTask}
          onDragLeave={leave}
          onDrop={dropTask}
        >
          <div className={styles.sectionHead}>
            <h2><bdi>{day.words}</bdi></h2>
            <span className={styles.spacer} />
            {attendanceHref === null ? null : (
              <ButtonLink size="sm" tone="ghost" href={attendanceHref}>
                <Icon name="check" size={14} />
                נוכחות ביום הזה
              </ButtonLink>
            )}
          </div>

          {dragging === 'task' ? (
            <p className={styles.zoneHint} aria-live="polite">משחררים כאן, והמשימה עוברת ליום הזה.</p>
          ) : null}

          {tasks.length === 0 ? (
            <>
              <EmptyState
                kind="none-of-this-kind"
                noun="משימות ביום הזה"
                action={{ label: 'מעבר ללוח העבודה', href: planHref }}
              />
              <p className={styles.note}>
                {canEdit
                  ? 'מושכים משימה מהרשימה שלצד אל כאן, או לוחצים ״ליום הזה״ לידה. גם לחיצה ימנית על משימה בלוח העבודה משייכת אותה ליום.'
                  : 'בלוח העבודה, לחיצה ימנית על משימה משייכת אותה ליום עבודה, והיא מופיעה כאן.'}
              </p>
            </>
          ) : (
            <ul className={styles.cards}>
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className={cx(
                    styles.card,
                    dragging === 'person' && styles.cardReady,
                    dragging === 'person' && over === task.id && styles.cardOver,
                  )}
                  onDragOver={(event) => allowPerson(event, task)}
                  onDragEnter={(event) => allowPerson(event, task)}
                  onDragLeave={leave}
                  onDrop={(event) => dropPerson(event, task)}
                >
                  <div className={styles.cardHead}>
                    <h3 className={styles.cardTitle}>
                      <Link href={task.href}>{task.title}</Link>
                    </h3>
                    <span className={styles.cardMeta}>
                      <bdi>{task.topicName ?? 'בלי נושא'}</bdi>
                      {task.parentTitle === null ? null : <>{' · '}<bdi>{`חלק של ${task.parentTitle}`}</bdi></>}
                      {' · '}
                      <bdi>{task.assigneeName === null ? 'אחראי: לא נקבע' : `אחראי: ${task.assigneeName}`}</bdi>
                    </span>
                    {task.done ? (
                      <span><Pill tone={WORK_STATUS_TONES.done} dot>{WORK_STATUS_LABELS.done}</Pill></span>
                    ) : task.crew.length === 0 ? (
                      <span><Pill tone="warn">בלי צוות</Pill></span>
                    ) : null}
                  </div>

                  {task.crew.length === 0 ? (
                    <p className={styles.note}>
                      {canEdit ? 'עדיין לא שובץ אף אחד. גוררים שם מרשימת ״בלי משימה ביום הזה״, או לוחצים ״שיבוץ אנשים״.' : 'עדיין לא שובץ אף אחד למשימה הזו.'}
                    </p>
                  ) : (
                    <ul className={styles.crew} aria-label={`משובצים ל${task.title}`}>
                      {task.crew.map((person) => (
                        <li
                          key={person.personId}
                          className={cx(
                            styles.person, !person.onRoster && styles.personOff, person.doubled && styles.personDoubled,
                          )}
                        >
                          <Avatar name={person.displayName} size="sm" decorative />
                          {person.displayName}
                          {person.onRoster ? null : ' · לא ברשימת השנה'}
                          {person.doubled ? <span className={styles.doubledWord}>{' · כפול'}</span> : null}
                          {canEdit ? (
                            <button
                              type="button"
                              className={styles.personOffBtn}
                              aria-label={`הסרת ${person.displayName} מ${task.title}`}
                              disabled={writing === `${task.id}:${person.personId}`}
                              onClick={() => { void setCrew(task, person, false); }}
                            >
                              <Icon name="x" size={14} />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}

                  {canEdit && task.crewHref !== null ? (
                    <div className={styles.cardFoot}>
                      <ButtonLink size="sm" href={task.crewHref}>
                        <Icon name="plus" size={14} />
                        {task.crew.length === 0 ? 'שיבוץ אנשים' : `שינוי השיבוץ · ${task.crew.length}`}
                      </ButtonLink>
                      <Button size="sm" tone="ghost" disabled={writing === task.id} onClick={() => { void remove(task); }}>
                        <Icon name="x" size={14} />
                        הסרה מהיום
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={cx(styles.section, styles.free)} id="free" aria-label="בלי משימה ביום הזה">
          <div className={styles.sectionHead}>
            <h2>בלי משימה ביום הזה</h2>
            <span className={styles.sectionHint}>
              <bdi>{`${free.length} מתוך ${rosterSize} ברשימת ${seasonName}`}</bdi>
              {canEdit && free.length > 0 ? ' · גוררים שם אל משימה של היום' : ''}
            </span>
          </div>
          {rosterSize === 0 ? (
            <EmptyState
              kind="nothing-this-season"
              noun="חברים ברשימה"
              seasonName={seasonName}
              action={{ label: 'מעבר לאנשים', href: '/members' }}
            />
          ) : free.length === 0 ? (
            <p className={styles.note}>כל מי שברשימה משובץ למשימה כלשהי ביום הזה.</p>
          ) : (
            <ul className={cx(styles.crew, styles.freeList)}>
              {free.map((person) => (
                <li
                  key={person.personId}
                  className={cx(styles.person, canEdit && styles.personDrag)}
                  draggable={canEdit}
                  onDragStart={canEdit ? (event) => startPerson(event, person.personId) : undefined}
                  onDragEnd={canEdit ? end : undefined}
                >
                  <Avatar name={person.displayName} size="sm" decorative />
                  <Link href={person.href}>{person.displayName}</Link>
                </li>
              ))}
            </ul>
          )}
      </section>

      {canEdit ? (
        <aside className={styles.pool} aria-label="משימות שאפשר למשוך ליום הזה">
          <div className={styles.sectionHead}>
            <h2>משימות למשוך ליום</h2>
            <span className={styles.sectionHint}>
              <bdi>{poolSize === 0 ? 'אין' : poolSize === 1 ? 'משימה אחת' : `${poolSize} משימות`}</bdi>
              {' · פתוחות בלוח העבודה ולא ביום הזה'}
            </span>
          </div>
          {poolSize === 0 ? (
            <>
              <EmptyState
                kind="none-of-this-kind"
                noun="משימות פתוחות מחוץ ליום הזה"
                action={{ label: 'הוספת משימה בלוח העבודה', href: planHref }}
              />
            </>
          ) : (
            <>
              <Field id={FILTER_ID} label="חיפוש משימה">
                <TextInput id={FILTER_ID} value={filter} onChange={setFilter} icon="search" />
              </Field>
              {unscheduled.length === 0 && elsewhere.length === 0 ? (
                <p className={styles.note}>אין משימה שהשם, הנושא או המשימה הכללית שלה מכילים את מה שנכתב.</p>
              ) : (
                <>
                  {poolRows(unscheduled, 'בלי יום', 'עוד לא על ציר הזמן')}
                  {poolRows(elsewhere, 'ביום אחר', 'משיכה לכאן מעבירה אותן')}
                </>
              )}
            </>
          )}
        </aside>
      ) : null}
    </div>
  );
}
