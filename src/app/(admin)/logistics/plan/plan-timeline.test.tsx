/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { buildTimeline, timelineWindow, type PlanItem, type Topic, type TimelineBar } from '@/lib/logistics/plan';
import { PlanTimeline, packBars, laneRows, laneBlocks, monthBands, windowLabel } from './plan-timeline';

function item(over: Partial<PlanItem>): PlanItem {
  return {
    id: 'i', seasonId: 's', topicId: null, parentId: null, title: 'משימה', notes: null,
    startsOn: null, endsOn: null, status: 'open', position: 0, assignee: null,
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

describe('windowLabel', () => {
  it('names a month, a week inside a month, and a week across two', () => {
    expect(windowLabel(timelineWindow('month', '2026-05-13')!)).toBe('מאי 2026');
    expect(windowLabel(timelineWindow('week', '2026-05-13')!)).toBe('10–16 במאי 2026');
    expect(windowLabel(timelineWindow('week', '2026-06-01')!)).toBe('31 במאי – 6 ביוני 2026');
    expect(windowLabel(timelineWindow('week', '2026-12-30')!)).toBe('27 בדצמבר 2026 – 2 בינואר 2027');
  });
});

describe('monthBands', () => {
  it('spans each month over its days', () => {
    const timeline = buildTimeline([item({ id: 'a', startsOn: '2026-05-30', endsOn: '2026-06-02' })], [])!;
    expect(monthBands(timeline.days).map((band) => [band.label, band.span])).toEqual([['מאי', 8], ['יוני', 6]]);
  });
});

describe('PlanTimeline', () => {
  const items = [
    item({ id: 'p', title: 'להכין מכולת מטבח', topicId: 'k', startsOn: '2026-05-12', endsOn: '2026-05-14' }),
    item({ id: 'c', title: 'לתקן מקררים', topicId: 'k', parentId: 'p', startsOn: '2026-05-13' }),
    item({ id: 'x', title: 'לקנות קרשים', startsOn: '2026-05-20', endsOn: '2026-05-21', status: 'done' }),
  ];
  const timeline = buildTimeline(items, [KITCHEN])!;

  function mount(today = '2026-01-01') {
    return render(<PlanTimeline timeline={timeline} params={{ season: 's1' }} today={today} currentItemId={null} />);
  }

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

  it('offers the three scales as links, the current one marked, and scrolls to today over everything', () => {
    mount('2026-05-13');
    const group = screen.getByRole('group', { name: 'קנה מידה' });
    const options = within(group).getAllByRole('link');
    expect(options.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')])).toEqual([
      ['שבוע', '/logistics/plan?season=s1&scale=week&at=2026-05-13', null],
      ['חודש', '/logistics/plan?season=s1&scale=month&at=2026-05-13', null],
      ['הכול', '/logistics/plan?season=s1', 'true'],
    ]);
    expect(screen.getByRole('button', { name: 'היום' })).toBeTruthy();
  });

  it('in a week, names the week, steps to its neighbours, and says when today is elsewhere', () => {
    const week = buildTimeline(items, [KITCHEN], timelineWindow('week', '2026-05-13'))!;
    render(<PlanTimeline timeline={week} params={{ season: 's1' }} today="2026-06-01" currentItemId={null} />);
    expect(screen.getByText('10–16 במאי 2026')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'השבוע הקודם' }).getAttribute('href'))
      .toBe('/logistics/plan?season=s1&scale=week&at=2026-05-06');
    expect(screen.getByRole('link', { name: 'השבוע הבא' }).getAttribute('href'))
      .toBe('/logistics/plan?season=s1&scale=week&at=2026-05-20');
    expect(screen.getByRole('link', { name: 'היום' }).getAttribute('href'))
      .toBe('/logistics/plan?season=s1&scale=week&at=2026-06-01');
    // Only the two kitchen items touch this week; the done one is on other days.
    const bars = screen.getAllByRole('link').filter((a) => (a.getAttribute('href') ?? '').includes('peek='));
    expect(bars).toHaveLength(2);
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });

  it('in a month, dims the padding days of the neighbouring months', () => {
    const month = buildTimeline(items, [KITCHEN], timelineWindow('month', '2026-05-13'))!;
    const { container } = render(<PlanTimeline timeline={month} params={{ season: 's1' }} today="2026-05-13" currentItemId={null} />);
    expect(screen.getByText('מאי 2026')).toBeTruthy();
    const days = screen.getAllByRole('listitem');
    expect(days).toHaveLength(42);
    const dimmed = days.filter((day) => /dayOutside/.test(day.className));
    expect(dimmed.map((day) => day.getAttribute('aria-label'))).toEqual([
      'א׳ 26/04', 'ב׳ 27/04', 'ג׳ 28/04', 'ד׳ 29/04', 'ה׳ 30/04', 'ב׳ 01/06', 'ג׳ 02/06', 'ד׳ 03/06', 'ה׳ 04/06', 'ו׳ 05/06', 'ש׳ 06/06',
    ]);
    expect(container.textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('in an empty week, keeps the days, says where the work is, and offers everything', () => {
    const empty = buildTimeline(items, [KITCHEN], timelineWindow('week', '2026-07-01'))!;
    render(<PlanTimeline timeline={empty} params={{ season: 's1' }} today="2026-07-01" currentItemId={null} />);
    expect(screen.getByText(/אין משימה על הימים של השבוע הזה/).textContent).toContain('3 המשימות שיש להן יום נמצאות על ימים אחרים');
    expect(screen.getByRole('link', { name: 'לתצוגה של הכול' }).getAttribute('href')).toBe('/logistics/plan?season=s1');
  });

  it('cuts a bar at the window’s edge and says so in the link, not by moving the item', () => {
    const long = [item({ id: 'l', title: 'להרכיב צל', startsOn: '2026-05-08', endsOn: '2026-05-19' })];
    const week = buildTimeline(long, [], timelineWindow('week', '2026-05-13'))!;
    render(<PlanTimeline timeline={week} params={{ season: 's1' }} today="2026-05-13" currentItemId={null} />);
    const bar = screen.getByRole('link', { name: 'להרכיב צל · 08/05–19/05' });
    expect(bar.getAttribute('style')).toContain('grid-column: 1 / span 7');
    expect(bar.className).toMatch(/barClipStart/);
    expect(bar.className).toMatch(/barClipEnd/);
  });
});
