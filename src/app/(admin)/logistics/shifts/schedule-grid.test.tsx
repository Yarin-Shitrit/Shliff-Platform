/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    render(<ScheduleGrid board={buildBoard([slot], [bar], WINDOW)} days={WINDOW.days} params={{ season: 's1' }} currentTaskId={null} />);
    expect(screen.getByRole('table').textContent ?? '').not.toMatch(/[A-Za-z]/);
  });
});
