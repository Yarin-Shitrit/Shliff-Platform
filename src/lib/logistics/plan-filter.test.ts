import { describe, it, expect } from 'vitest';
import { buildPlanTree, filterCounts, filterPlan, matchesFilter, type PlanItem } from './plan';
import { filterHref, parsePlanQuery, planHref, PLAN_FILTERS, PLAN_FILTER_LABELS } from './plan-views';

function item(over: Partial<PlanItem>): PlanItem {
  return {
    id: 'i', seasonId: 's', topicId: null, parentId: null, title: 'משימה', notes: null,
    startsOn: null, endsOn: null, status: 'open', position: 0, assignee: null, purchase: null,
    waitsFor: [], blocks: [], updatedAt: new Date('2026-01-01T00:00:00Z'), updatedBy: null,
    ...over,
  };
}

const TODAY = '2026-11-20';
const NOA = { personId: 'n', displayName: 'נועה' };

const ITEMS: PlanItem[] = [
  item({ id: 'lounge', title: 'להכין סלון', startsOn: '2026-11-18', endsOn: '2026-12-03', assignee: NOA }),
  item({ id: 'paint', title: 'צביעה', parentId: 'lounge', position: 1 }),
  item({ id: 'benches', title: 'ספסלים', parentId: 'lounge', startsOn: '2026-11-28', assignee: NOA, position: 2 }),
  item({ id: 'tarp', title: 'תיקון ברזנט', startsOn: '2026-11-16', endsOn: '2026-11-18', position: 3 }),
  item({ id: 'old', title: 'נגמרה בלי יום', status: 'done', position: 4 }),
  item({ id: 'gone', title: 'בוטלה', status: 'cancelled', startsOn: '2026-11-01', position: 5 }),
];

describe('matchesFilter', () => {
  it('lets everything through ״הכול״, closed items included', () => {
    expect(ITEMS.every((one) => matchesFilter(one, 'all', TODAY))).toBe(true);
  });

  it('asks every other question of open items only', () => {
    const closed = ITEMS.filter((one) => one.status !== 'open');
    for (const filter of ['unscheduled', 'overdue', 'unassigned'] as const) {
      expect(closed.some((one) => matchesFilter(one, filter, TODAY)), filter).toBe(false);
    }
  });

  it('reads no day, a passed last day, and nobody responsible', () => {
    const ids = (filter: Parameters<typeof matchesFilter>[1]) =>
      ITEMS.filter((one) => matchesFilter(one, filter, TODAY)).map((one) => one.id);
    expect(ids('unscheduled')).toEqual(['paint']);
    expect(ids('overdue')).toEqual(['tarp']);
    expect(ids('unassigned')).toEqual(['paint', 'tarp']);
  });
});

describe('filterPlan', () => {
  it('hands back the very list under ״הכול״', () => {
    expect(filterPlan(ITEMS, 'all', TODAY)).toBe(ITEMS);
  });

  it('keeps the general item of a part that matches, so the part is read under it', () => {
    const kept = filterPlan(ITEMS, 'unscheduled', TODAY);
    expect(kept.map((one) => one.id)).toEqual(['lounge', 'paint']);

    const [group] = buildPlanTree(kept, []);
    expect(group.branches).toHaveLength(1);
    expect(group.branches[0].item.id).toBe('lounge');
    expect(group.branches[0].children.map((child) => child.id)).toEqual(['paint']);
  });

  it('does not drag a general item’s other parts in with it', () => {
    expect(filterPlan(ITEMS, 'unscheduled', TODAY).some((one) => one.id === 'benches')).toBe(false);
  });

  it('is empty when nothing answers', () => {
    expect(filterPlan([item({ id: 'a', startsOn: '2026-12-01', assignee: NOA })], 'overdue', TODAY)).toEqual([]);
  });
});

describe('filterCounts', () => {
  it('counts what each chip would show, without the parents kept for context', () => {
    expect(filterCounts(ITEMS, TODAY)).toEqual({ all: 6, unscheduled: 1, overdue: 1, unassigned: 2 });
  });
});

describe('the filter in the URL', () => {
  it('reads ?show=, and falls back to everything on nonsense', () => {
    expect(parsePlanQuery({ show: 'overdue' }).filter).toBe('overdue');
    expect(parsePlanQuery({ show: 'everything' }).filter).toBe('all');
    expect(parsePlanQuery({}).filter).toBe('all');
  });

  it('spells ״הכול״ by its absence and lands on the list', () => {
    expect(filterHref({ season: 's' }, 'unscheduled')).toBe('/logistics/plan?season=s&show=unscheduled#list');
    expect(filterHref({ season: 's', show: 'overdue' }, 'all')).toBe('/logistics/plan?season=s#list');
  });

  it('survives a drawer opening and closing, like the season and the scale', () => {
    expect(planHref({ season: 's', show: 'overdue' }, { peek: 'i1' })).toBe('/logistics/plan?season=s&show=overdue&peek=i1');
    expect(planHref({ season: 's', show: 'overdue', peek: 'i1' }, {})).toBe('/logistics/plan?season=s&show=overdue');
  });

  it('has a Hebrew word for every filter', () => {
    for (const filter of PLAN_FILTERS) {
      expect(PLAN_FILTER_LABELS[filter]).toMatch(/[א-ת]/);
      expect(PLAN_FILTER_LABELS[filter]).not.toMatch(/[A-Za-z]/);
    }
  });
});
