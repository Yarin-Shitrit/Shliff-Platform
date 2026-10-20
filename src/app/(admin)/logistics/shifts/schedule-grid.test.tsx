/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { buildBoard, type ScheduleSlot, type ShiftType } from '@/lib/logistics/shifts';
import { campInstant, eventWindow } from '@/lib/logistics/shift-time';
import { ScheduleGrid } from './schedule-grid';

const WINDOW = eventWindow(new Date('2026-06-08T00:00:00Z'));

const bar: ShiftType = {
  id: 'bar', name: 'בר', startsClock: '20:00', endsClock: '00:00', peopleNeeded: 2,
  notes: null, retiredAt: null, updatedAt: new Date(), updatedBy: null,
};

const slot: ScheduleSlot = {
  taskId: 't1', typeId: 'bar', title: 'בר',
  startsAt: campInstant('2026-06-08', { hours: 20, minutes: 0 }),
  endsAt: campInstant('2026-06-09', { hours: 0, minutes: 0 }),
  peopleNeeded: 3, accepted: 1, uncovered: true, status: 'open',
  assignees: [
    { assignmentId: 'a1', personId: 'p1', displayName: 'אופק', status: 'accepted' },
    { assignmentId: 'a2', personId: 'p2', displayName: 'נועה', status: 'proposed' },
  ],
};

describe('the schedule board', () => {
  it('is a table of types by days, with the slot a link to its drawer', () => {
    render(<ScheduleGrid board={buildBoard([slot], [bar], WINDOW)} days={WINDOW.days} params={{ season: 's1' }} currentTaskId="t1" />);
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'סוג משמרת', 'יום שני08/06', 'יום שלישי09/06', 'יום רביעי10/06', 'יום חמישי11/06', 'יום שישי12/06', 'יום שבת13/06',
    ]);
    const card = screen.getByRole('link', { name: 'בר 20:00–00:00' });
    expect(card.getAttribute('href')).toBe('/logistics/shifts?season=s1&peek=t1');
    expect(card.getAttribute('aria-current')).toBe('true');
    // A proposed name is not shown as placed; the gap is counted instead.
    expect(card.textContent).toContain('אופק');
    expect(card.textContent).not.toContain('נועה');
    expect(card.textContent).toContain('2 מקומות פנויים');
  });

  it('links every empty cell of an active type to scheduling that type on that day', () => {
    render(<ScheduleGrid board={buildBoard([], [bar], WINDOW)} days={WINDOW.days} params={{ season: 's1' }} currentTaskId={null} />);
    const add = screen.getByRole('link', { name: 'שיבוץ בר ביום שלישי' });
    expect(add.getAttribute('href')).toBe('/logistics/shifts?season=s1&act=slot&type=bar&day=2026-06-09');
    expect(screen.getAllByRole('link', { name: /^שיבוץ בר/ })).toHaveLength(6);
  });

  it('says nothing in English', () => {
    const { container } = render(<ScheduleGrid board={buildBoard([slot], [bar], WINDOW)} days={WINDOW.days} params={{ season: 's1' }} currentTaskId={null} today="2026-06-08" />);
    expect(container.textContent ?? '').not.toMatch(/[A-Za-z]/);
  });
});

/**
 * On a phone the same table is regrouped by day with CSS alone (the one-DOM
 * rule the kit's table follows). What that reflow needs from the markup is
 * pinned here: the roles it would otherwise drop, the day each header and
 * cell carries, and a card that names its own kind once its row header is
 * out of sight.
 */
describe('the board, as the phone regroups it', () => {
  it('writes its table roles out, so laying it out as a grid cannot lose them', () => {
    const { container } = render(<ScheduleGrid board={buildBoard([slot], [bar], WINDOW)} days={WINDOW.days} params={{ season: 's1' }} currentTaskId={null} />);
    expect(screen.getByRole('table').getAttribute('role')).toBe('table');
    expect(container.querySelectorAll('thead[role="rowgroup"], tbody[role="rowgroup"]')).toHaveLength(2);
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['בר']);
    expect(screen.getAllByRole('cell')).toHaveLength(6);
  });

  it('says on every day header and every cell which day it is, which is what the phone groups by', () => {
    const { container } = render(<ScheduleGrid board={buildBoard([slot], [bar], WINDOW)} days={WINDOW.days} params={{ season: 's1' }} currentTaskId={null} />);
    const headers = [...container.querySelectorAll('thead th[data-day]')].map((th) => th.getAttribute('data-day'));
    const cells = [...container.querySelectorAll('td[data-day]')].map((td) => td.getAttribute('data-day'));
    expect(headers).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(cells).toEqual(['0', '1', '2', '3', '4', '5']);
    // The corner header is the one with no day: it names the rows, not a column.
    expect(container.querySelectorAll('thead th:not([data-day])')).toHaveLength(1);
  });

  it('names the kind on the card and on the add link, where the row header will not be beside them', () => {
    render(<ScheduleGrid board={buildBoard([slot], [bar], WINDOW)} days={WINDOW.days} params={{ season: 's1' }} currentTaskId={null} />);
    const card = screen.getByRole('link', { name: 'בר 20:00–00:00' });
    expect(card.textContent?.startsWith('בר')).toBe(true);
    const add = screen.getByRole('link', { name: 'שיבוץ בר ביום שלישי' });
    expect(add.textContent).toBe('שיבוץ בר');
  });

  it('offers a jump to each day, landing on that day\'s heading', () => {
    const { container } = render(<ScheduleGrid board={buildBoard([slot], [bar], WINDOW)} days={WINDOW.days} params={{ season: 's1' }} currentTaskId={null} />);
    const strip = screen.getByRole('navigation', { name: 'מעבר ליום' });
    const jumps = within(strip).getAllByRole('link');
    expect(jumps.map((a) => a.getAttribute('href'))).toEqual([
      '#shift-day-0', '#shift-day-1', '#shift-day-2', '#shift-day-3', '#shift-day-4', '#shift-day-5',
    ]);
    expect(jumps.map((a) => a.textContent)).toEqual([
      'שני08/06', 'שלישי09/06', 'רביעי10/06', 'חמישי11/06', 'שישי12/06', 'שבת13/06',
    ]);
    for (const jump of jumps) {
      const target = container.querySelector(jump.getAttribute('href')!);
      expect(target?.tagName).toBe('TH');
    }
  });

  it('marks today on its heading and on its chip, while the event is on', () => {
    render(<ScheduleGrid board={buildBoard([slot], [bar], WINDOW)} days={WINDOW.days} params={{ season: 's1' }} currentTaskId={null} today="2026-06-10" />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((th) => th.getAttribute('aria-current'))).toEqual([null, null, null, 'date', null, null, null]);
    expect(headers[3].textContent).toContain('היום');
    const strip = screen.getByRole('navigation', { name: 'מעבר ליום' });
    const jumps = within(strip).getAllByRole('link');
    expect(jumps.map((a) => a.getAttribute('aria-current'))).toEqual([null, null, 'date', null, null, null]);
  });

  it('marks nothing when today is not one of the event\'s days', () => {
    const { container } = render(<ScheduleGrid board={buildBoard([slot], [bar], WINDOW)} days={WINDOW.days} params={{ season: 's1' }} currentTaskId={null} today="2026-01-01" />);
    expect(container.querySelectorAll('[aria-current="date"]')).toHaveLength(0);
    expect(container.textContent).not.toContain('היום');
  });
});
