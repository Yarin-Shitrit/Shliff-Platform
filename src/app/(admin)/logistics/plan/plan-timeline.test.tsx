/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildTimeline, type PlanItem, type Topic, type TimelineBar } from '@/lib/logistics/plan';
import { PlanTimeline, packBars, laneRows, monthBands } from './plan-timeline';

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
      'לתקן מקררים · 13/05',
      'לקנות קרשים · 20/05–21/05 · הושלמה',
    ]);
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
});
