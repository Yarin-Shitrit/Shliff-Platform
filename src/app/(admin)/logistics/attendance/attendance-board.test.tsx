/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import { unnamedControls } from '@/test/a11y';
import { buildBoard, type AttendanceEvent, type Mark, type PersonalMark } from '@/lib/logistics/attendance';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ setMarkAction: vi.fn(async () => ({ ok: true })) }));

import { AttendanceBoard, EventList, eventName } from './attendance-board';

const LEAD = 'lead@shliff.camp';

function day(id: string, heldOn: string, kind: AttendanceEvent['kind'] = 'work_day', title: string | null = null): AttendanceEvent {
  return {
    id, seasonId: 's1', kind, heldOn, title, notes: null, cancelledAt: null,
    createdAt: new Date('2027-03-01T00:00:00Z'), updatedAt: new Date('2027-03-01T00:00:00Z'),
    updatedBy: LEAD, presentCount: 0,
  };
}

function mark(eventId: string, personId: string, displayName: string): Mark {
  return { eventId, personId, displayName, markedBy: LEAD, createdAt: new Date('2027-03-14T18:00:00Z') };
}

const EVENTS = [day('e1', '2027-03-14'), day('e2', '2027-03-21', 'shopping', 'קניות באיקאה')];
const ROSTER = [{ personId: 'p-avi', displayName: 'אבי' }, { personId: 'p-dana', displayName: 'דנה' }];
const MARKS = [mark('e1', 'p-dana', 'דנה'), mark('e2', 'p-dana', 'דנה'), mark('e1', 'p-gone', 'יוסי')];
const PERSONAL: PersonalMark[] = [{
  id: 'm1', seasonId: 's1', personId: 'p-dana', displayName: 'דנה', doneOn: '2027-04-01',
  title: 'הביאה את הגנרטור', notes: null, markedBy: LEAD, createdAt: new Date('2027-04-01T18:00:00Z'),
}];
const PARAMS = { season: 's1' };

function mountBoard(currentEventId: string | null = null) {
  const board = buildBoard(EVENTS, MARKS, ROSTER, PERSONAL);
  return render(
    <ToastProvider>
      <AttendanceBoard board={board} params={PARAMS} currentEventId={currentEventId} />
    </ToastProvider>,
  );
}

describe('the attendance board', () => {
  it('draws a column per day, headed by its words and its date, each a link to its drawer', () => {
    mountBoard('e2');
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual([
      'שם',
      expect.stringMatching(/יום עבודה.*ראשון.*14\/03\/27/),
      expect.stringMatching(/קניות באיקאה.*ראשון.*21\/03\/27.*קניות/),
      expect.stringContaining('סימונים אישיים'),
      'סה״כ',
    ]);
    const open = within(headers[2]).getByRole('link');
    expect(open.getAttribute('href')).toBe('/logistics/attendance?season=s1&event=e2');
    expect(headers[2].getAttribute('aria-current')).toBe('true');
    expect(headers[1].getAttribute('aria-current')).toBeNull();
  });

  it('gives every roster member a row with a toggle per day and the count at the end', () => {
    mountBoard();
    const dana = screen.getByRole('row', { name: /דנה/ });
    const toggles = within(dana).getAllByRole('button');
    expect(toggles).toHaveLength(2);
    expect(toggles.map((toggle) => toggle.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
    expect(within(dana).getAllByRole('cell').at(-1)?.textContent).toBe('3');

    const avi = screen.getByRole('row', { name: /אבי/ });
    expect(within(avi).getAllByRole('button').map((toggle) => toggle.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
    expect(within(avi).getAllByRole('cell').at(-1)?.textContent).toBe('0');
  });

  it('counts the things each person did alone in a column of their own, each count opening their drawer', () => {
    mountBoard();
    const dana = within(screen.getByRole('row', { name: /דנה/ }))
      .getByRole('link', { name: 'סימונים אישיים · דנה · 1' });
    expect(dana.textContent).toBe('1');
    expect(dana.getAttribute('href')).toBe('/logistics/attendance?season=s1&person=p-dana');
    // Nothing yet: the cell still opens the drawer, and says so with a plus rather than a zero.
    const avi = within(screen.getByRole('row', { name: /אבי/ }))
      .getByRole('link', { name: 'סימונים אישיים · אבי · 0' });
    expect(avi.getAttribute('href')).toBe('/logistics/attendance?season=s1&person=p-avi');
    expect(avi.textContent).toBe('');
  });

  it('keeps a marked person who left the roster as a read-only row that says so', () => {
    mountBoard();
    const gone = screen.getByRole('row', { name: /יוסי/ });
    expect(within(gone).queryAllByRole('button')).toHaveLength(0);
    expect(gone.textContent).toMatch(/לא ברשימת השנה/);
    expect(within(gone).getAllByRole('cell').at(-1)?.textContent).toBe('1');
  });

  it('counts the other way in the last row: how many came each day', () => {
    mountBoard();
    const foot = screen.getByRole('row', { name: /נוכחים/ });
    expect(within(foot).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['2', '1', '1', '4']);
  });

  it('links every name to the person’s own page', () => {
    mountBoard();
    expect(screen.getByRole('link', { name: 'דנה' }).getAttribute('href')).toBe('/members/p-dana');
  });

  it('names every control (E4) and says nothing in English', () => {
    const { container } = mountBoard();
    expect(unnamedControls(container)).toEqual([]);
    expect(container.textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('spells a day for a toast with its words and its date', () => {
    expect(eventName(EVENTS[1])).toBe('קניות באיקאה 21/03/27');
    expect(eventName(EVENTS[0])).toBe('יום עבודה 14/03/27');
  });
});

describe('the phone’s list of days', () => {
  it('lists the days newest first, each a link to its drawer with its count', () => {
    const board = buildBoard(EVENTS, MARKS, ROSTER, PERSONAL);
    render(<EventList board={board} params={PARAMS} currentEventId="e1" />);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/logistics/attendance?season=s1&event=e2',
      '/logistics/attendance?season=s1&event=e1',
    ]);
    expect(links[0].textContent).toMatch(/קניות באיקאה.*קניות.*יום ראשון.*21\/03\/2027.*1 נוכחים/);
    expect(links[1].textContent).toMatch(/2 נוכחים/);
    expect(links[1].getAttribute('aria-current')).toBe('true');
  });
});
