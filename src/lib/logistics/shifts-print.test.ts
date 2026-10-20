import { describe, it, expect } from 'vitest';
import { schedulePrintHtml } from './shifts-print';
import { buildBoard, type ScheduleSlot, type ShiftType } from './shifts';
import { campInstant, eventWindow } from './shift-time';

const WINDOW = eventWindow(new Date('2026-06-08T00:00:00Z'));

const bar: ShiftType = {
  id: 'bar', name: 'בר', startsClock: '20:00', endsClock: '00:00', peopleNeeded: 2,
  notes: null, retiredAt: null, updatedAt: new Date(), updatedBy: null,
};

const slot: ScheduleSlot = {
  taskId: 't1', typeId: 'bar', title: 'בר',
  startsAt: campInstant('2026-06-08', { hours: 20, minutes: 0 }),
  endsAt: campInstant('2026-06-09', { hours: 0, minutes: 0 }),
  peopleNeeded: 2, accepted: 1, uncovered: true, status: 'open',
  assignees: [
    { assignmentId: 'a1', personId: 'p1', displayName: 'אופק <כהן>', status: 'accepted' },
    { assignmentId: 'a2', personId: 'p2', displayName: 'נועה', status: 'proposed' },
  ],
};

function sheet(slots: ScheduleSlot[], types: ShiftType[] = [bar]): string {
  return schedulePrintHtml({
    seasonName: 'ברן 26',
    window: WINDOW,
    board: buildBoard(slots, types, WINDOW),
    printedAt: new Date('2026-05-01T09:00:00Z'),
  });
}

/** The words a reader sees: tags and attributes stripped, the style and script gone. */
function visible(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/<script>[\s\S]*?<\/script>/, '')
    .replace(/<[^>]+>/g, ' ')
    /* An escaped `<` in a name is `&lt;` on the wire and `<` to the reader. */
    .replace(/&[a-z]+;|&#\d+;/g, '');
}

describe('the printed schedule', () => {
  it('is a right-to-left Hebrew document that asks to print itself', () => {
    const html = sheet([slot]);
    expect(html).toMatch(/^<!doctype html>\s*<html lang="he" dir="rtl">/);
    expect(html).toContain('window.print()');
    expect(html).toContain('לוח משמרות · ברן 26');
    expect(html).toContain('size: A4 landscape');
  });

  it('shows every day, every placed name, and an open place for each missing person', () => {
    const html = sheet([slot]);
    for (const day of WINDOW.days) expect(html).toContain(day.weekday);
    expect(html).toContain('20:00–00:00');
    expect(html).toContain('אופק &lt;כהן&gt;');
    // A proposed assignment is not a placing; the sheet shows the gap instead.
    expect(html).not.toContain('נועה');
    expect(html.match(/— פנוי —/g)).toHaveLength(1);
  });

  it('says nothing in English where a reader looks', () => {
    expect(visible(sheet([slot]))).not.toMatch(/[A-Za-z]/);
    expect(visible(sheet([], []))).not.toMatch(/[A-Za-z]/);
  });

  it('invites when the board is empty, and lists what falls off the event days', () => {
    // An active type is a row even with nothing in it; "empty" is no types and no shifts.
    expect(sheet([], [])).toContain('עדיין אין משמרות בלוח');
    expect(sheet([])).not.toContain('עדיין אין משמרות בלוח');
    const off = sheet([{ ...slot, taskId: 't2', startsAt: campInstant('2026-06-20', { hours: 9, minutes: 0 }), endsAt: campInstant('2026-06-20', { hours: 11, minutes: 0 }) }]);
    expect(off).toContain('מחוץ לימי האירוע');
  });
});
