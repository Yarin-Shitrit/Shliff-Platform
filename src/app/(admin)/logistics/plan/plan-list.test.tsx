/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PlanGroup, PlanItem, Topic } from '@/lib/logistics/plan';
import { PlanList } from './plan-list';

function item(over: Partial<PlanItem>): PlanItem {
  return {
    id: 'i', seasonId: 's', topicId: null, parentId: null, title: 'משימה', notes: null,
    startsOn: null, endsOn: null, status: 'open', position: 0, assignee: null,
    waitsFor: [], blocks: [], updatedAt: new Date('2026-01-01T00:00:00Z'), updatedBy: null,
    ...over,
  };
}

function topic(over: Partial<Topic>): Topic {
  return {
    id: 't', seasonId: 's', name: 'סלון', position: 0, notes: null, archivedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'), updatedBy: null, ...over,
  };
}

const PARAMS = { season: 's1' };

function mount(groups: PlanGroup[]) {
  return render(<PlanList groups={groups} params={PARAMS} today="2026-05-11" currentItemId={null} />);
}

describe('PlanList', () => {
  it('names every column in Hebrew and nothing in English', () => {
    mount([{ topic: topic({}), branches: [{ item: item({ id: 'a' }), children: [] }] }]);
    for (const header of within(screen.getByRole('table')).getAllByRole('columnheader')) {
      expect(header.textContent ?? '').not.toMatch(/[A-Za-z]/);
    }
  });

  it('draws a general item and its parts under it, each a link to its drawer', () => {
    mount([{
      topic: topic({}),
      branches: [{
        item: item({ id: 'p', title: 'להכין סלון' }),
        children: [
          item({ id: 'c1', title: 'לקנות קרשים', parentId: 'p' }),
          item({ id: 'c2', title: 'יום בניית ספסלים', parentId: 'p' }),
        ],
      }],
    }]);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    // Header, then the parent, then its two parts in order.
    expect(rows.slice(1).map((row) => row.textContent)).toEqual([
      expect.stringContaining('להכין סלון'),
      expect.stringContaining('לקנות קרשים'),
      expect.stringContaining('יום בניית ספסלים'),
    ]);
    expect(screen.getByRole('link', { name: 'לקנות קרשים' }).getAttribute('href'))
      .toBe('/logistics/plan?season=s1&peek=c1');
  });

  it('says in words when an item has no day, and links to where one is set', () => {
    mount([{ topic: null, branches: [{ item: item({ id: 'a', title: 'לצבוע פטריות' }), children: [] }] }]);
    const link = screen.getByRole('link', { name: 'לקבוע יום' });
    expect(link.getAttribute('href')).toBe('/logistics/plan?season=s1&peek=a');
  });

  it('shows a day range in the table form', () => {
    mount([{ topic: null, branches: [{ item: item({ id: 'a', startsOn: '2026-05-10', endsOn: '2026-05-12' }), children: [] }] }]);
    expect(screen.getByText('10/05/26')).toBeTruthy();
    expect(screen.getByText('12/05/26')).toBeTruthy();
  });

  it('names what an item waits for, and says when the dates contradict it', () => {
    mount([{
      topic: null,
      branches: [{
        item: item({
          id: 'b', title: 'יום צביעת ספסלים',
          waitsFor: [{
            dependencyId: 'd', itemId: 'a', title: 'יום בניית ספסלים', status: 'open',
            startsOn: '2026-05-09', endsOn: null, conflict: true,
          }],
        }),
        children: [],
      }],
    }]);
    expect(screen.getByRole('link', { name: 'יום בניית ספסלים' })).toBeTruthy();
    expect(screen.getByText(/לא מסתיימת קודם/)).toBeTruthy();
  });

  it('invites under an empty topic rather than drawing an empty grid', () => {
    mount([{ topic: topic({ id: 't1', name: 'מטבח' }), branches: [] }]);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/עדיין אין משימות תחת/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'הוספת משימה' }).getAttribute('href'))
      .toBe('/logistics/plan?season=s1&act=item&topic=t1');
  });

  it('heads a topic with a link to its drawer, and the no-topic group with plain text', () => {
    mount([
      { topic: topic({ id: 't1', name: 'מטבח' }), branches: [{ item: item({ id: 'a', topicId: 't1' }), children: [] }] },
      { topic: null, branches: [{ item: item({ id: 'b' }), children: [] }] },
    ]);
    expect(screen.getByRole('link', { name: 'מטבח' }).getAttribute('href')).toBe('/logistics/plan?season=s1&topic=t1');
    expect(screen.getByRole('heading', { name: 'בלי נושא' })).toBeTruthy();
  });

  it('says in words when an item is overdue or underway, from the day it is given', () => {
    mount([{
      topic: null,
      branches: [
        { item: item({ id: 'a', title: 'איחור', startsOn: '2026-05-01', endsOn: '2026-05-03' }), children: [] },
        { item: item({ id: 'b', title: 'עכשיו', startsOn: '2026-05-10', endsOn: '2026-05-12' }), children: [] },
        { item: item({ id: 'c', title: 'נגמר', startsOn: '2026-05-01', status: 'done' }), children: [] },
      ],
    }]);
    expect(screen.getByText('עבר התאריך')).toBeTruthy();
    expect(screen.getByText('בעבודה')).toBeTruthy();
  });

  it('measures each topic in words and a meter', () => {
    mount([{
      topic: topic({ id: 't1', name: 'מטבח' }),
      branches: [
        { item: item({ id: 'a', status: 'done' }), children: [item({ id: 'b', parentId: 'a' }), item({ id: 'c', parentId: 'a', status: 'cancelled' })] },
      ],
    }]);
    expect(screen.getByRole('img', { name: '1 מתוך 2 הושלמו' })).toBeTruthy();
  });

  it('says every state in a word', () => {
    mount([{
      topic: null,
      branches: [
        { item: item({ id: 'a', status: 'open' }), children: [] },
        { item: item({ id: 'b', status: 'done' }), children: [] },
        { item: item({ id: 'c', status: 'cancelled' }), children: [] },
      ],
    }]);
    expect(screen.getByText('פתוחה')).toBeTruthy();
    expect(screen.getByText('הושלמה')).toBeTruthy();
    expect(screen.getByText('בוטלה')).toBeTruthy();
  });
});
