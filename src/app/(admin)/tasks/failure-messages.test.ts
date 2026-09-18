import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createPerson, mergePersons } from '@/lib/members/link';
import { createTask, listTasks } from '@/lib/work/tasks';
import { assignPerson } from '@/lib/work/coverage';
import {
  assignFailureMessage, createTaskFailureMessage, actionFailureMessage,
  ASSIGN_ERRORS, CREATE_TASK_ERRORS,
} from './failure-messages';

const LEAD = 'lead@shliff.camp';

describe('assignFailureMessage', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('names the duplicate for what it is', () => {
    expect(assignFailureMessage(new Error(
      'duplicate key value violates unique constraint "task_assignments_task_person_key"',
    ))).toBe('האדם כבר משובץ למשימה הזו');
  });

  /**
   * The shape the database actually produces. Drizzle's own message is the
   * SQL it tried to run; the constraint name is only on the cause. Unwrap
   * `innermost` in the module and this is the case that goes red — the bare
   * Error above passes either way, which is why it cannot stand alone.
   */
  it('reads the refusal through the wrapper Drizzle throws', () => {
    const wrapped = new Error(
      'Failed query: insert into "task_assignments" ("id", "task_id") values (default, $1)',
      {
        cause: new Error(
          'duplicate key value violates unique constraint "task_assignments_task_person_key"',
        ),
      },
    );
    expect(assignFailureMessage(wrapped)).toBe('האדם כבר משובץ למשימה הזו');
  });

  it('stops telling a lead to re-assign someone who was merged away', () => {
    expect(assignFailureMessage(new Error(
      'that person was merged into another — assign the survivor',
    ))).toBe('האדם הזה מוזג לאדם אחר — שבצו את מי שנשאר');
  });

  it('says so when the person is gone', () => {
    expect(assignFailureMessage(new Error('unknown person 8f1e')))
      .toBe('לא מצאנו את האדם הזה');
  });

  it('falls back to Hebrew and logs, rather than echoing English', () => {
    expect(assignFailureMessage(new Error('connection terminated unexpectedly')))
      .toBe('השיבוץ נכשל. נסו שוב.');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('createTaskFailureMessage', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('maps each of the domain\'s refusals', () => {
    expect(createTaskFailureMessage(new Error('a task needs a title')))
      .toBe('כותרת לא יכולה להיות ריקה.');
    expect(createTaskFailureMessage(new Error('a shift needs a time window')))
      .toBe('משמרת חייבת לכלול שעת התחלה ושעת סיום.');
    expect(createTaskFailureMessage(new Error('a shift may not end before it starts')))
      .toBe('משמרת לא יכולה להסתיים לפני שהתחילה.');
    expect(createTaskFailureMessage(new Error('an event task must name its event')))
      .toBe('משימה באירוע חייבת להיות משויכת לאירוע.');
    expect(createTaskFailureMessage(new Error('a task needs at least one person')))
      .toBe('צריך לפחות אדם אחד למשימה.');
  });

  it('falls back in Hebrew', () => {
    expect(createTaskFailureMessage(new Error('null value in column "season_id"')))
      .toBe('יצירת המשימה נכשלה. נסו שוב.');
  });
});

describe('actionFailureMessage', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('never returns the error it was given', () => {
    expect(actionFailureMessage(new Error('relation "tasks" does not exist'), 'נכשל.'))
      .toBe('נכשל.');
  });
});

/**
 * Integration §5 A7: the map is consulted first and by PREFIX, so an entry
 * keyed on a fragment that appears mid-message would never fire. Nothing else
 * in this file would catch that — every unit case above passes the exact
 * thrown string, which is also its own prefix.
 */
describe('the maps are keyed by English prefix', () => {
  it('keys every entry on a Latin prefix, never on the Hebrew it maps to', () => {
    for (const [prefix, hebrew] of [...ASSIGN_ERRORS, ...CREATE_TASK_ERRORS]) {
      expect(prefix).toMatch(/^[A-Za-z]/);
      expect(hebrew).toMatch(/[֐-׿]/);
    }
  });
});

/**
 * The mapping above matches on the domain's own wording. These run the real
 * functions so that changing that wording breaks the mapping loudly here
 * rather than silently on the screen.
 */
describe('the wording the mapping matches on', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 })).id;
  });

  it('is what assignPerson throws for a merged person', async () => {
    const survivor = await createPerson(db, 'אופק כהן', LEAD);
    const merged = await createPerson(db, 'אופק', LEAD);
    await mergePersons(db, merged, survivor, LEAD);
    await createTask(db, { seasonId, kind: 'build', title: 'הובלה' });
    const taskId = (await listTasks(db, seasonId))[0].taskId;
    await expect(assignPerson(db, taskId, merged, LEAD)).rejects.toThrow();
    const error = await assignPerson(db, taskId, merged, LEAD).catch((e) => e);
    expect(assignFailureMessage(error)).toBe('האדם הזה מוזג לאדם אחר — שבצו את מי שנשאר');
  });

  it('is what the unique constraint reports for a second assignment', async () => {
    const person = await createPerson(db, 'נועה לוי', LEAD);
    await createTask(db, { seasonId, kind: 'build', title: 'הובלה' });
    const taskId = (await listTasks(db, seasonId))[0].taskId;
    await assignPerson(db, taskId, person, LEAD);
    const error = await assignPerson(db, taskId, person, LEAD).catch((e) => e);
    expect(assignFailureMessage(error)).toBe('האדם כבר משובץ למשימה הזו');
  });

  it('is what assignPerson throws for a person who is not there', async () => {
    await createTask(db, { seasonId, kind: 'build', title: 'הובלה' });
    const taskId = (await listTasks(db, seasonId))[0].taskId;
    const error = await assignPerson(db, taskId, crypto.randomUUID(), LEAD).catch((e) => e);
    expect(assignFailureMessage(error)).toBe('לא מצאנו את האדם הזה');
  });

  it('is what createTask throws for a shift with no window', async () => {
    const error = await createTask(db, { seasonId, kind: 'shift', title: 'משמרת בר' })
      .catch((e) => e);
    expect(createTaskFailureMessage(error))
      .toBe('משמרת חייבת לכלול שעת התחלה ושעת סיום.');
  });
});
