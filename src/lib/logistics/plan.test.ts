import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { persons, seasons } from '@/db/schema/camp';
import { addMember } from '@/lib/members/roster';
import {
  createTopic, updateTopic, setTopicArchived, listTopics, topicById,
  createItem, updateItem, scheduleItem, setItemStatus, planItemById,
  addDependency, removeDependency, listPlan,
  buildPlanTree, buildTimeline, timelineWindow, stepWindow, topicHue, summarizePlan, validateSchedule, datesConflict,
  planRoster, purchaseTitle, purchaseNameOf, looksLikePurchase, adoptableItems,
  type PlanItem, type Topic,
} from './plan';
import { createAcquisition, setAcquisitionStatus } from './acquisitions';

const LEAD = 'lead@shliff.camp';

const BLANK = {
  notes: null, topicId: null, parentId: null, startsOn: null, endsOn: null, assigneePersonId: null,
};

describe('the schedule rule', () => {
  it('accepts no dates, a start alone, and a start with an end', () => {
    expect(validateSchedule({ startsOn: null, endsOn: null })).toEqual({ startsOn: null, endsOn: null });
    expect(validateSchedule({ startsOn: '2026-05-10', endsOn: '' })).toEqual({ startsOn: '2026-05-10', endsOn: null });
    expect(validateSchedule({ startsOn: '2026-05-10', endsOn: '2026-05-12' }))
      .toEqual({ startsOn: '2026-05-10', endsOn: '2026-05-12' });
  });

  it('refuses a day that is not one, an end with no start, and an end before the start', () => {
    expect(() => validateSchedule({ startsOn: '10/05/2026', endsOn: null })).toThrow(/real start day/);
    expect(() => validateSchedule({ startsOn: '2026-02-30', endsOn: null })).toThrow(/real start day/);
    expect(() => validateSchedule({ startsOn: null, endsOn: '2026-05-12' })).toThrow(/before it starts/);
    expect(() => validateSchedule({ startsOn: '2026-05-12', endsOn: '2026-05-10' })).toThrow(/before it starts/);
  });
});

describe('dates against a dependency', () => {
  it('is a conflict only when both are scheduled and the first is not over first', () => {
    expect(datesConflict({ startsOn: '2026-05-10', endsOn: '2026-05-12' }, { startsOn: '2026-05-13', endsOn: null })).toBe(false);
    expect(datesConflict({ startsOn: '2026-05-10', endsOn: '2026-05-12' }, { startsOn: '2026-05-12', endsOn: null })).toBe(true);
    expect(datesConflict({ startsOn: '2026-05-10', endsOn: null }, { startsOn: '2026-05-10', endsOn: null })).toBe(true);
    expect(datesConflict({ startsOn: null, endsOn: null }, { startsOn: '2026-05-10', endsOn: null })).toBe(false);
    expect(datesConflict({ startsOn: '2026-05-10', endsOn: null }, { startsOn: null, endsOn: null })).toBe(false);
  });
});

describe('the plan against a real database', () => {
  let db: TestDb;
  let seasonId: string;
  let otherSeasonId: string;
  let ofek: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [season] = await db.insert(seasons).values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    const [other] = await db.insert(seasons).values({ name: 'ברן 25', year: 2025, flatRate: '1500.00' }).returning();
    seasonId = season.id;
    otherSeasonId = other.id;
    const [person] = await db.insert(persons).values({ displayName: 'אופק' }).returning();
    ofek = person.id;
    await addMember(db, ofek, seasonId);
  });

  describe('topics', () => {
    it('stores a topic in the next position and says who wrote it', async () => {
      const kitchen = await createTopic(db, seasonId, { name: ' מטבח ', notes: null }, LEAD);
      const lounge = await createTopic(db, seasonId, { name: 'סלון', notes: ' עם הספסלים ' }, LEAD);
      const topics = await listTopics(db, seasonId);
      expect(topics.map((topic) => [topic.name, topic.position])).toEqual([['מטבח', 0], ['סלון', 1]]);
      expect((await topicById(db, kitchen))?.updatedBy).toBe(LEAD);
      expect((await topicById(db, lounge))?.notes).toBe('עם הספסלים');
    });

    it('refuses a nameless topic and a second active one with the same name', async () => {
      await expect(createTopic(db, seasonId, { name: ' ', notes: null }, LEAD)).rejects.toThrow(/needs a name/);
      await createTopic(db, seasonId, { name: 'מטבח', notes: null }, LEAD);
      await expect(createTopic(db, seasonId, { name: 'מטבח ', notes: null }, LEAD)).rejects.toThrow(/already exists/);
      // Another season may have its own מטבח.
      await expect(createTopic(db, otherSeasonId, { name: 'מטבח', notes: null }, LEAD)).resolves.toBeTruthy();
    });

    it('archives rather than deletes, lists archived last, and frees the name', async () => {
      const first = await createTopic(db, seasonId, { name: 'מטבח', notes: null }, LEAD);
      await createTopic(db, seasonId, { name: 'סלון', notes: null }, LEAD);
      await setTopicArchived(db, first, true, LEAD);
      expect((await listTopics(db, seasonId)).map((topic) => topic.name)).toEqual(['סלון', 'מטבח']);
      await createTopic(db, seasonId, { name: 'מטבח', notes: null }, LEAD);
      await expect(setTopicArchived(db, first, false, LEAD)).rejects.toThrow(/already exists/);
    });

    it('edits in place', async () => {
      const id = await createTopic(db, seasonId, { name: 'שירותים', notes: null }, LEAD);
      await updateTopic(db, id, { name: 'שירותים ומקלחות', notes: null }, 'other@shliff.camp');
      const topic = await topicById(db, id);
      expect(topic?.name).toBe('שירותים ומקלחות');
      expect(topic?.updatedBy).toBe('other@shliff.camp');
    });

    it('answers null for an id that is not one', async () => {
      expect(await topicById(db, 'not-a-uuid')).toBeNull();
    });
  });

  describe('items', () => {
    it('stores a general item under a topic, with its days and its person', async () => {
      const kitchen = await createTopic(db, seasonId, { name: 'מטבח', notes: null }, LEAD);
      const id = await createItem(db, seasonId, {
        ...BLANK, title: ' להכין מכולת מטבח ', topicId: kitchen,
        startsOn: '2026-05-10', endsOn: '2026-05-20', assigneePersonId: ofek,
      }, LEAD);
      const item = await planItemById(db, id);
      expect(item?.title).toBe('להכין מכולת מטבח');
      expect(item?.topicId).toBe(kitchen);
      expect(item?.startsOn).toBe('2026-05-10');
      expect(item?.endsOn).toBe('2026-05-20');
      expect(item?.assignee).toEqual({ personId: ofek, displayName: 'אופק' });
      expect(item?.status).toBe('open');
    });

    it('refuses a blank title, a foreign topic, an unknown person and bad days', async () => {
      const foreign = await createTopic(db, otherSeasonId, { name: 'מטבח', notes: null }, LEAD);
      await expect(createItem(db, seasonId, { ...BLANK, title: ' ' }, LEAD)).rejects.toThrow(/needs a title/);
      await expect(createItem(db, seasonId, { ...BLANK, title: 'א', topicId: foreign }, LEAD)).rejects.toThrow(/unknown topic/);
      await expect(createItem(db, seasonId, { ...BLANK, title: 'א', assigneePersonId: 'nobody' }, LEAD)).rejects.toThrow(/unknown person/);
      await expect(createItem(db, seasonId, { ...BLANK, title: 'א', startsOn: '2026-05-12', endsOn: '2026-05-10' }, LEAD))
        .rejects.toThrow(/before it starts/);
    });

    it('makes a sub-item take its parent’s topic and allows no third level', async () => {
      const kitchen = await createTopic(db, seasonId, { name: 'מטבח', notes: null }, LEAD);
      const container = await createItem(db, seasonId, { ...BLANK, title: 'להכין מכולת מטבח', topicId: kitchen }, LEAD);
      const fridges = await createItem(db, seasonId, { ...BLANK, title: 'לתקן מקררים', parentId: container }, LEAD);
      expect((await planItemById(db, fridges))?.topicId).toBe(kitchen);
      await expect(createItem(db, seasonId, { ...BLANK, title: 'לקנות גז', parentId: fridges }, LEAD))
        .rejects.toThrow(/sub-items of its own/);
      // A parent cannot become a sub-item while it has parts.
      const lounge = await createItem(db, seasonId, { ...BLANK, title: 'להכין סלון' }, LEAD);
      await expect(updateItem(db, container, { ...BLANK, title: 'להכין מכולת מטבח', parentId: lounge }, LEAD))
        .rejects.toThrow(/sub-items of its own/);
      await expect(updateItem(db, container, { ...BLANK, title: 'x', parentId: container }, LEAD))
        .rejects.toThrow(/own parent/);
    });

    it('refuses a parent from another season', async () => {
      const foreign = await createItem(db, otherSeasonId, { ...BLANK, title: 'אחר' }, LEAD);
      await expect(createItem(db, seasonId, { ...BLANK, title: 'א', parentId: foreign }, LEAD)).rejects.toThrow(/unknown work item/);
    });

    it('moves a parent’s sub-items with it when its topic changes', async () => {
      const kitchen = await createTopic(db, seasonId, { name: 'מטבח', notes: null }, LEAD);
      const art = await createTopic(db, seasonId, { name: 'אומנות', notes: null }, LEAD);
      const parent = await createItem(db, seasonId, { ...BLANK, title: 'מכולה', topicId: kitchen }, LEAD);
      const child = await createItem(db, seasonId, { ...BLANK, title: 'מדפים', parentId: parent }, LEAD);
      await updateItem(db, parent, { ...BLANK, title: 'מכולת אומנות', topicId: art }, LEAD);
      expect((await planItemById(db, child))?.topicId).toBe(art);
    });

    it('schedules, reschedules and clears the days without touching the rest', async () => {
      const id = await createItem(db, seasonId, { ...BLANK, title: 'לקנות קרשים', notes: 'מהמנסרה' }, LEAD);
      await scheduleItem(db, id, { startsOn: '2026-05-03', endsOn: null }, LEAD);
      expect((await planItemById(db, id))?.startsOn).toBe('2026-05-03');
      await scheduleItem(db, id, { startsOn: null, endsOn: null }, LEAD);
      const item = await planItemById(db, id);
      expect(item?.startsOn).toBeNull();
      expect(item?.notes).toBe('מהמנסרה');
      await expect(scheduleItem(db, 'not-a-uuid', { startsOn: null, endsOn: null }, LEAD)).rejects.toThrow(/unknown work item/);
    });

    it('marks done, cancelled and open again, and refuses a status it does not know', async () => {
      const id = await createItem(db, seasonId, { ...BLANK, title: 'לצבוע פטריות' }, LEAD);
      await setItemStatus(db, id, 'done', LEAD);
      expect((await planItemById(db, id))?.status).toBe('done');
      await setItemStatus(db, id, 'open', LEAD);
      expect((await planItemById(db, id))?.status).toBe('open');
      await expect(setItemStatus(db, id, 'lost' as never, LEAD)).rejects.toThrow(/unknown work item status/);
    });

    it('lets a purchase item be cancelled on the board, but takes done and open from the purchase', async () => {
      const acquisitionId = await createAcquisition(db, {
        seasonId, name: 'מכולה', category: 'general', quantityNeeded: 1, source: 'buy_new',
        estimatedCost: null, actualCost: null, assigneePersonId: null, lenderPersonId: null, budgetLineId: null,
      }, LEAD);
      const [linked] = (await listPlan(db, seasonId)).filter((item) => item.purchase !== null);
      expect(linked.purchase).toEqual({ id: acquisitionId, status: 'to_search' });

      await expect(setItemStatus(db, linked.id, 'done', LEAD)).rejects.toThrow(/done when its purchase arrives/);
      expect((await planItemById(db, linked.id))?.status).toBe('open');

      await setItemStatus(db, linked.id, 'cancelled', LEAD);
      expect((await planItemById(db, linked.id))?.status).toBe('cancelled');
      // Reopening asks the purchase: not arrived, so open.
      await setItemStatus(db, linked.id, 'open', LEAD);
      expect((await planItemById(db, linked.id))?.status).toBe('open');
      // Arrived in the meantime: reopening lands on done, because it is.
      await setItemStatus(db, linked.id, 'cancelled', LEAD);
      await setAcquisitionStatus(db, acquisitionId, 'arrived', LEAD);
      await setItemStatus(db, linked.id, 'open', LEAD);
      expect((await planItemById(db, linked.id))?.status).toBe('done');
    });

    it('lists sub-items in creation order under their parent', async () => {
      const parent = await createItem(db, seasonId, { ...BLANK, title: 'להכין סלון' }, LEAD);
      await createItem(db, seasonId, { ...BLANK, title: 'לקנות קרשים', parentId: parent }, LEAD);
      await createItem(db, seasonId, { ...BLANK, title: 'יום בניית ספסלים', parentId: parent }, LEAD);
      await createItem(db, seasonId, { ...BLANK, title: 'יום צביעת ספסלים', parentId: parent }, LEAD);
      const groups = buildPlanTree(await listPlan(db, seasonId), await listTopics(db, seasonId));
      expect(groups).toHaveLength(1);
      expect(groups[0].topic).toBeNull();
      expect(groups[0].branches[0].children.map((child) => child.title))
        .toEqual(['לקנות קרשים', 'יום בניית ספסלים', 'יום צביעת ספסלים']);
    });
  });

  describe('dependencies', () => {
    let boards: string;
    let build: string;
    let paint: string;

    beforeEach(async () => {
      boards = await createItem(db, seasonId, { ...BLANK, title: 'לקנות קרשים', startsOn: '2026-05-03', endsOn: null }, LEAD);
      build = await createItem(db, seasonId, { ...BLANK, title: 'יום בניית ספסלים', startsOn: '2026-05-09', endsOn: null }, LEAD);
      paint = await createItem(db, seasonId, { ...BLANK, title: 'יום צביעת ספסלים', startsOn: '2026-05-09', endsOn: null }, LEAD);
    });

    it('records both sides of an order, and flags one the dates contradict', async () => {
      await addDependency(db, boards, build);
      await addDependency(db, build, paint);
      const items = await listPlan(db, seasonId);
      const byTitle = new Map(items.map((item) => [item.title, item]));

      expect(byTitle.get('יום בניית ספסלים')?.waitsFor.map((dep) => [dep.title, dep.conflict]))
        .toEqual([['לקנות קרשים', false]]);
      expect(byTitle.get('לקנות קרשים')?.blocks.map((dep) => dep.title)).toEqual(['יום בניית ספסלים']);
      // Painting the same day the benches are built: reported, not moved.
      expect(byTitle.get('יום צביעת ספסלים')?.waitsFor[0].conflict).toBe(true);
      expect(byTitle.get('יום צביעת ספסלים')?.startsOn).toBe('2026-05-09');
      expect(summarizePlan(items).conflicts).toBe(1);
    });

    it('refuses an item waiting for itself, a repeat, a ring, and a pair across seasons', async () => {
      await expect(addDependency(db, boards, boards)).rejects.toThrow(/itself/);
      await addDependency(db, boards, build);
      await expect(addDependency(db, boards, build)).rejects.toThrow(/already exists/);
      await addDependency(db, build, paint);
      await expect(addDependency(db, paint, boards)).rejects.toThrow(/cycle/);
      await expect(addDependency(db, build, boards)).rejects.toThrow(/cycle/);
      const foreign = await createItem(db, otherSeasonId, { ...BLANK, title: 'אחר' }, LEAD);
      await expect(addDependency(db, boards, foreign)).rejects.toThrow(/cross seasons/);
      await expect(addDependency(db, boards, 'nope')).rejects.toThrow(/unknown work item/);
    });

    it('removes one and only one', async () => {
      const id = await addDependency(db, boards, build);
      await addDependency(db, build, paint);
      await removeDependency(db, id);
      const items = await listPlan(db, seasonId);
      expect(items.find((item) => item.id === build)?.waitsFor).toEqual([]);
      expect(items.find((item) => item.id === paint)?.waitsFor).toHaveLength(1);
      await expect(removeDependency(db, id)).rejects.toThrow(/unknown dependency/);
    });
  });

  it('offers the season’s roster by name', async () => {
    const [noa] = await db.insert(persons).values({ displayName: 'נועה' }).returning();
    await addMember(db, noa.id, seasonId);
    const [stranger] = await db.insert(persons).values({ displayName: 'אורח' }).returning();
    await addMember(db, stranger.id, otherSeasonId);
    expect((await planRoster(db, seasonId)).map((option) => option.displayName)).toEqual(['אופק', 'נועה']);
  });
});

function item(over: Partial<PlanItem>): PlanItem {
  return {
    id: 'i', seasonId: 's', topicId: null, parentId: null, title: 'x', notes: null,
    startsOn: null, endsOn: null, status: 'open', position: 0, assignee: null, purchase: null,
    waitsFor: [], blocks: [], updatedAt: new Date('2026-01-01T00:00:00Z'), updatedBy: null,
    ...over,
  };
}

function topic(over: Partial<Topic>): Topic {
  return {
    id: 't', seasonId: 's', name: 'נושא', position: 0, notes: null, archivedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'), updatedBy: null, ...over,
  };
}

describe('the tree', () => {
  it('keeps an empty active topic as a heading, drops an empty archived one, and puts no-topic last', () => {
    const kitchen = topic({ id: 'k', name: 'מטבח', position: 1 });
    const lounge = topic({ id: 'l', name: 'סלון', position: 0 });
    const old = topic({ id: 'o', name: 'ישן', position: 2, archivedAt: new Date() });
    const groups = buildPlanTree([
      item({ id: 'a', title: 'ללא נושא' }),
      item({ id: 'b', title: 'מכולה', topicId: 'k' }),
    ], [kitchen, lounge, old]);
    expect(groups.map((group) => group.topic?.name ?? null)).toEqual(['סלון', 'מטבח', null]);
    expect(groups[0].branches).toEqual([]);
  });

  it('keeps an archived topic while it still holds something', () => {
    const old = topic({ id: 'o', name: 'ישן', archivedAt: new Date() });
    const groups = buildPlanTree([item({ id: 'a', topicId: 'o' })], [old]);
    expect(groups[0].topic?.name).toBe('ישן');
  });

  it('gives each topic a colour slot by its place, wrapping after six, and none to no topic', () => {
    const topics = Array.from({ length: 8 }, (_, index) => topic({ id: `t${index}`, position: index }));
    expect(topics.map((one) => topicHue(topics, one.id))).toEqual([1, 2, 3, 4, 5, 6, 1, 2]);
    expect(topicHue(topics, null)).toBeNull();
    expect(topicHue(topics, 'nobody')).toBeNull();
    const groups = buildPlanTree([item({ id: 'a' })], topics.slice(0, 2));
    expect(groups.map((group) => group.hue)).toEqual([1, 2, null]);
  });
});

describe('the timeline’s window', () => {
  it('is the Sunday-to-Saturday week around a day', () => {
    // 2026-05-13 is a Wednesday.
    expect(timelineWindow('week', '2026-05-13')).toEqual({
      scale: 'week', at: '2026-05-13', from: '2026-05-10', to: '2026-05-16', month: null,
    });
  });

  it('is the month around a day, padded out to whole weeks', () => {
    // May 2026 starts on a Friday and ends on a Sunday.
    expect(timelineWindow('month', '2026-05-13')).toEqual({
      scale: 'month', at: '2026-05-13', from: '2026-04-26', to: '2026-06-06', month: '2026-05',
    });
  });

  it('is nothing for everything', () => {
    expect(timelineWindow('all', '2026-05-13')).toBeNull();
  });

  it('steps a week by seven days and a month to the first of the next, even from a 31st', () => {
    const week = timelineWindow('week', '2026-05-13')!;
    expect(stepWindow(week, 1)).toBe('2026-05-20');
    expect(stepWindow(week, -1)).toBe('2026-05-06');
    const month = timelineWindow('month', '2026-05-31')!;
    expect(stepWindow(month, 1)).toBe('2026-06-01');
    expect(stepWindow(month, -1)).toBe('2026-04-01');
    expect(stepWindow(timelineWindow('month', '2026-12-05')!, 1)).toBe('2027-01-01');
  });
});

describe('the timeline', () => {
  it('is null with nothing scheduled, rather than a strip around today', () => {
    expect(buildTimeline([item({ id: 'a' }), item({ id: 'b', startsOn: '2026-05-10', status: 'cancelled' })], [])).toBeNull();
  });

  it('runs from the Sunday before the first start to the Saturday after the last end', () => {
    // 2026-05-12 is a Tuesday; 2026-05-21 a Thursday.
    const timeline = buildTimeline([
      item({ id: 'a', startsOn: '2026-05-12', endsOn: '2026-05-14' }),
      item({ id: 'b', startsOn: '2026-05-20', endsOn: '2026-05-21' }),
    ], [])!;
    expect(timeline.days[0].day).toBe('2026-05-10');
    expect(timeline.days[0].weekday).toBe(0);
    expect(timeline.days.at(-1)?.day).toBe('2026-05-23');
    expect(timeline.days).toHaveLength(14);
    expect(timeline.lanes[0].bars.map((bar) => [bar.item.id, bar.start, bar.span]))
      .toEqual([['a', 2, 3], ['b', 10, 2]]);
    expect(timeline.placed).toBe(2);
  });

  it('writes the month on the first column and on every first of a month', () => {
    const timeline = buildTimeline([item({ id: 'a', startsOn: '2026-05-30', endsOn: '2026-06-02' })], [])!;
    const marked = timeline.days.filter((day) => day.monthStart).map((day) => day.day);
    expect(marked).toEqual(['2026-05-24', '2026-06-01']);
  });

  it('draws a sub-item as its own bar on the topic’s lane and skips an undated parent', () => {
    const kitchen = topic({ id: 'k', name: 'מטבח' });
    const timeline = buildTimeline([
      item({ id: 'p', title: 'מכולה', topicId: 'k' }),
      item({ id: 'c', title: 'מקררים', topicId: 'k', parentId: 'p', startsOn: '2026-05-12' }),
    ], [kitchen])!;
    expect(timeline.lanes).toHaveLength(1);
    expect(timeline.lanes[0].topic?.name).toBe('מטבח');
    expect(timeline.lanes[0].hue).toBe(1);
    expect(timeline.lanes[0].bars.map((bar) => bar.item.id)).toEqual(['c']);
    // The part still says whose it is, though its parent is not drawn.
    expect(timeline.lanes[0].bars[0].parentTitle).toBe('מכולה');
    expect(timeline.window).toBeNull();
    expect(timeline.scheduled).toBe(1);
  });

  it('inside a window, draws only what touches it, cut to its edges, and still counts the rest', () => {
    const items = [
      item({ id: 'before', startsOn: '2026-05-01', endsOn: '2026-05-04' }),
      item({ id: 'across', startsOn: '2026-05-08', endsOn: '2026-05-19' }),
      item({ id: 'inside', startsOn: '2026-05-12' }),
      item({ id: 'after', startsOn: '2026-05-25' }),
    ];
    const timeline = buildTimeline(items, [], timelineWindow('week', '2026-05-13'))!;
    expect(timeline.days.map((day) => day.day)).toEqual([
      '2026-05-10', '2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15', '2026-05-16',
    ]);
    expect(timeline.lanes[0].bars.map((bar) => [bar.item.id, bar.start, bar.span, bar.clippedStart ?? false, bar.clippedEnd ?? false]))
      .toEqual([['across', 0, 7, true, true], ['inside', 2, 1, false, false]]);
    // The items' own days are untouched: the bar is cut, not the plan.
    expect(items[1].startsOn).toBe('2026-05-08');
    expect(timeline.placed).toBe(2);
    expect(timeline.scheduled).toBe(4);
    expect(timeline.window?.scale).toBe('week');
  });

  it('inside a window with nothing in it, is a timeline with days and no lanes, never null', () => {
    const timeline = buildTimeline([item({ id: 'a', startsOn: '2026-05-25' })], [], timelineWindow('week', '2026-05-13'))!;
    expect(timeline).not.toBeNull();
    expect(timeline.lanes).toEqual([]);
    expect(timeline.days).toHaveLength(7);
    expect(timeline.scheduled).toBe(1);
  });
});

describe('the totals', () => {
  it('counts open, done, placed and unplaced, and leaves cancelled out', () => {
    const totals = summarizePlan([
      item({ id: 'a', startsOn: '2026-05-10' }),
      item({ id: 'b' }),
      item({ id: 'c', status: 'done' }),
      item({ id: 'd', status: 'cancelled', startsOn: '2026-05-10' }),
    ]);
    expect(totals).toEqual({ open: 2, done: 1, scheduled: 1, unscheduled: 1, conflicts: 0 });
  });
});

describe('the words of a purchase', () => {
  it('writes the title from the way of getting it, the name and the count', () => {
    expect(purchaseTitle('buy_new', ' מכולה ', 1)).toBe('לקנות מכולה');
    expect(purchaseTitle('buy_new', 'כיסא', 12)).toBe('לקנות כיסא (12)');
    expect(purchaseTitle('second_hand', 'מקרר', 1)).toBe('להשיג מקרר');
    expect(purchaseTitle('borrow_member', 'אוהל', 2)).toBe('להשאיל אוהל (2)');
  });

  it('recognises a buying item by its first word, however it is spelled', () => {
    for (const title of ['לקנות מכולה', ' לרכוש קרשים', 'קניית גז', 'רכישת מקרר', 'לקנות  2 מקררים']) {
      expect(looksLikePurchase(title), title).toBe(true);
    }
    for (const title of ['להכין מכולת מטבח', 'יום בניית ספסלים', 'לקנותם', 'מכולה לקנות', '']) {
      expect(looksLikePurchase(title), title).toBe(false);
    }
  });

  it('takes the verb off for the row’s name, and keeps a title that is only a verb', () => {
    expect(purchaseNameOf('לקנות מכולה')).toBe('מכולה');
    expect(purchaseNameOf('קניית קרשים לספסלים')).toBe('קרשים לספסלים');
    expect(purchaseNameOf('גז למטבח')).toBe('גז למטבח');
    expect(purchaseNameOf('לקנות')).toBe('לקנות');
  });

  it('offers every open item not yet in the list, suggesting the ones that read as buying', () => {
    const offered = adoptableItems([
      item({ id: 'a', title: 'לקנות מכולה', assignee: { personId: 'p', displayName: 'אופק' } }),
      item({ id: 'b', title: 'להכין סלון' }),
      item({ id: 'c', title: 'לקנות גז', purchase: { id: 'x', status: 'ordered' } }),
      item({ id: 'd', title: 'לקנות קרשים', status: 'done' }),
      item({ id: 'e', title: 'לקנות אוהל', status: 'cancelled' }),
    ]);
    expect(offered.map((one) => [one.id, one.suggested])).toEqual([['a', true], ['b', false]]);
    expect(offered[0].assignee?.displayName).toBe('אופק');
  });
});
