/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { buildTimeline, type PlanItem, type Topic, type TimelineBar } from '@/lib/logistics/plan';
import type { TimelineScale } from '@/lib/logistics/plan-views';
import { PlanTimeline, packBars, laneRows, laneBlocks, monthBands, weekCells } from './plan-timeline';

function item(over: Partial<PlanItem>): PlanItem {
  return {
    id: 'i', seasonId: 's', topicId: null, parentId: null, title: 'משימה', notes: null,
    startsOn: null, endsOn: null, status: 'open', position: 0, assignee: null, purchase: null,
    waitsFor: [], blocks: [], updatedAt: new Date('2026-01-01T00:00:00Z'), updatedBy: null,
    ...over,
  };
}

const KITCHEN: Topic = {
  id: 'k', seasonId: 's', name: 'מטבח', position: 0, notes: null, archivedAt: null,
  updatedAt: new Date('2026-01-01T00:00:00Z'), updatedBy: null,
};

function bar(id: string, start: number, span: number): TimelineBar {
  return { item: item({ id }), start, span };
}

describe('packBars', () => {
  it('puts overlapping bars on separate rows and lets the rest share', () => {
    const rows = packBars([bar('a', 0, 3), bar('b', 1, 2), bar('c', 4, 1), bar('d', 3, 1)]);
    expect(rows.map((row) => row.map((one) => one.item.id))).toEqual([['a', 'd', 'c'], ['b']]);
  });

  it('is empty for nothing', () => {
    expect(packBars([])).toEqual([]);
  });
});

describe('laneRows', () => {
  it('puts the general items first and the parts under them', () => {
    const rows = laneRows([
      { item: item({ id: 'c', parentId: 'p' }), start: 1, span: 2 },
      { item: item({ id: 'p' }), start: 0, span: 5 },
    ]);
    expect(rows.map((row) => row.map((one) => one.item.id))).toEqual([['p'], ['c']]);
  });
});

describe('laneBlocks', () => {
  it('packs the items without parts together, then one block per item with parts, its parts under it', () => {
    const blocks = laneBlocks([
      { item: item({ id: 'a' }), start: 0, span: 2 },
      { item: item({ id: 'p' }), start: 0, span: 5 },
      { item: item({ id: 'c1', parentId: 'p' }), start: 1, span: 2 },
      { item: item({ id: 'c2', parentId: 'p' }), start: 2, span: 2 },
      { item: item({ id: 'b' }), start: 3, span: 1 },
      { item: item({ id: 'orphan', parentId: 'elsewhere' }), start: 4, span: 1 },
    ]);
    expect(blocks.map((block) => [block.parentId, block.parent?.item.id ?? null, block.parts.map((row) => row.map((bar) => bar.item.id))]))
      .toEqual([
        [null, null, [['a', 'b']]],
        ['p', 'p', [['c1'], ['c2']]],
        ['elsewhere', null, [['orphan']]],
      ]);
  });
});

describe('monthBands', () => {
  it('spans each month over its days', () => {
    const timeline = buildTimeline([item({ id: 'a', startsOn: '2026-05-30', endsOn: '2026-06-02' })], [])!;
    expect(monthBands(timeline.days).map((band) => [band.label, band.span])).toEqual([['מאי', 8], ['יוני', 6]]);
  });
});

describe('weekCells', () => {
  it('cuts the days into sevens from the first column', () => {
    const timeline = buildTimeline([item({ id: 'a', startsOn: '2026-05-12', endsOn: '2026-05-21' })], [])!;
    expect(weekCells(timeline.days)).toEqual([
      { from: '2026-05-10', to: '2026-05-16', span: 7 },
      { from: '2026-05-17', to: '2026-05-23', span: 7 },
    ]);
    expect(weekCells([])).toEqual([]);
  });
});

describe('PlanTimeline', () => {
  const items = [
    item({ id: 'p', title: 'להכין מכולת מטבח', topicId: 'k', startsOn: '2026-05-12', endsOn: '2026-05-14' }),
    item({ id: 'c', title: 'לתקן מקררים', topicId: 'k', parentId: 'p', startsOn: '2026-05-13' }),
    item({ id: 'x', title: 'לקנות קרשים', startsOn: '2026-05-20', endsOn: '2026-05-21', status: 'done' }),
  ];
  const timeline = buildTimeline(items, [KITCHEN])!;

  function mount(today = '2026-01-01', scale: TimelineScale = 'day') {
    return render(
      <PlanTimeline timeline={timeline} scale={scale} params={scale === 'day' ? { season: 's1' } : { season: 's1', scale }} today={today} currentItemId={null} />,
    );
  }
  const bars = () => screen.getAllByRole('link').filter((a) => (a.getAttribute('href') ?? '').includes('peek='));

  it('lays one bar per scheduled item, each a link that says what and when', () => {
    mount();
    const links = screen.getAllByRole('link').filter((a) => (a.getAttribute('href') ?? '').includes('peek='));
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'להכין מכולת מטבח · 12/05–14/05',
      'לתקן מקררים · חלק של להכין מכולת מטבח · 13/05',
      'לקנות קרשים · 20/05–21/05 · הושלמה',
    ]);
    // The parent's bar counts its parts.
    expect(links[0].textContent).toContain('חלק אחד');
    expect(links[0].getAttribute('href')).toBe('/logistics/plan?season=s1&peek=p');
    // The grid column is the day's index plus one, spanning the days.
    expect(links[0].getAttribute('style')).toContain('grid-column: 3 / span 3');
  });

  it('draws a lane per topic, the topic a link to its drawer, the no-topic lane last', () => {
    mount();
    expect(screen.getByRole('link', { name: 'מטבח' }).getAttribute('href')).toBe('/logistics/plan?season=s1&topic=k');
    expect(screen.getByText('בלי נושא')).toBeTruthy();
  });

  it('heads the days with the month band and marks today', () => {
    mount('2026-05-13');
    expect(screen.getByText('מאי')).toBeTruthy();
    const days = screen.getAllByRole('listitem');
    expect(days).toHaveLength(timeline.days.length);
    const today = days.find((day) => day.getAttribute('aria-current') === 'date');
    expect(today?.getAttribute('aria-label')).toBe('ד׳ 13/05');
  });

  it('says nothing in English', () => {
    const { container } = mount();
    expect(container.textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('wears the topic’s colour on its lane, and none on the no-topic lane', () => {
    const { container } = mount();
    const lanes = [...container.querySelectorAll('[class*="lane"]')].filter((el) => /(^| )_?lane/.test(el.className) && !/laneLabel|laneCount|laneName/.test(el.className));
    expect(lanes[0].className).toContain('hue1');
    expect(lanes[1].className).not.toMatch(/hue\d/);
  });



  it('offers the three resolutions as links, the current one marked, ״ימים״ as the bare URL', () => {
    mount('2026-05-13', 'week');
    const group = screen.getByRole('group', { name: 'רזולוציה' });
    const options = within(group).getAllByRole('link');
    expect(options.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')])).toEqual([
      ['ימים', '/logistics/plan?season=s1', null],
      ['שבועות', '/logistics/plan?season=s1&scale=week', 'true'],
      ['חודשים', '/logistics/plan?season=s1&scale=month', null],
    ]);
    expect(screen.getByRole('button', { name: 'היום' })).toBeTruthy();
  });

  /*
   * The resolution changes the header and the width of a day, never the
   * bars: the same three items sit on the same day-columns at all three.
   */
  it('keeps every bar on its own days at every resolution', () => {
    const columns: Record<string, (string | null)[]> = {};
    for (const scale of ['day', 'week', 'month'] as const) {
      const view = mount('2026-05-13', scale);
      columns[scale] = bars().map((a) => a.getAttribute('style'));
      view.unmount();
    }
    expect(columns.day).toHaveLength(3);
    expect(columns.day[0]).toContain('grid-column: 3 / span 3');
    expect(columns.week).toEqual(columns.day);
    expect(columns.month).toEqual(columns.day);
  });

  it('at ״שבועות״ heads the columns with weeks, each over its seven days, and marks this week', () => {
    const { container } = mount('2026-05-13', 'week');
    // The span is 2026-05-10 … 2026-05-23: two whole weeks.
    const weeks = within(screen.getByRole('list', { name: 'שבועות' })).getAllByRole('listitem');
    expect(weeks.map((cell) => [cell.getAttribute('aria-label'), cell.getAttribute('style'), cell.getAttribute('aria-current')])).toEqual([
      ['שבוע 10/05–16/05', 'grid-column: span 7;', 'date'],
      ['שבוע 17/05–23/05', 'grid-column: span 7;', null],
    ]);
    expect(screen.queryByRole('list', { name: 'ימים' })).toBeNull();
    expect(container.querySelector('[class*="scaleWeek"]')).not.toBeNull();
    expect(container.textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('at ״חודשים״ the months are the columns, named with their year, and this month is marked', () => {
    const long = buildTimeline([
      item({ id: 'a', title: 'להזמין מכולה', startsOn: '2026-03-03' }),
      item({ id: 'b', title: 'להרכיב צל', startsOn: '2026-06-18', endsOn: '2026-06-20' }),
    ], [])!;
    const { container } = render(
      <PlanTimeline timeline={long} scale="month" params={{ season: 's1', scale: 'month' }} today="2026-04-10" currentItemId={null} />,
    );
    const months = within(screen.getByRole('list', { name: 'חודשים' })).getAllByRole('listitem');
    // 2026-03-01 … 2026-06-20: March 31 days, April 30, May 31, June's first 20.
    expect(months.map((cell) => [cell.textContent, cell.getAttribute('style'), cell.getAttribute('aria-current')])).toEqual([
      ['מרץ 2026', 'grid-column: span 31;', null],
      ['אפריל 2026', 'grid-column: span 30;', 'date'],
      ['מאי 2026', 'grid-column: span 31;', null],
      ['יוני 2026', 'grid-column: span 20;', null],
    ]);
    expect(screen.queryByRole('list', { name: 'ימים' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'שבועות' })).toBeNull();
    expect(container.querySelector('[class*="scaleMonth"]')).not.toBeNull();
    // Both items are drawn, three and a half months apart.
    expect(screen.getByRole('link', { name: 'להזמין מכולה · 03/03 · עבר התאריך' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'להרכיב צל · 18/06–20/06' })).toBeTruthy();
  });

  it('gives a bar its extras only when it has the room for them at that resolution', () => {
    // The parent spans three days: room for its parts count at ״ימים״, not at ״חודשים״.
    const day = mount('2026-01-01', 'day');
    expect(bars()[0].textContent).toContain('חלק אחד');
    day.unmount();
    mount('2026-01-01', 'month');
    expect(bars()[0].textContent).toBe('להכין מכולת מטבח');
  });
});
