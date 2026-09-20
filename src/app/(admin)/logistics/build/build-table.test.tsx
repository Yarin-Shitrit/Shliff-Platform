/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { BuildTask, MaterialRow } from '@/lib/logistics/build';
import { BuildTable, groupOf } from './build-table';

function material(over: Partial<MaterialRow> = {}): MaterialRow {
  return {
    id: 'm1', taskId: 't1', name: 'משטחי עץ', quantityNeeded: 8,
    state: 'in_stock',
    inventory: { id: 'inv-1', locationText: 'מאחורי המכולה', condition: 'ready', quantity: 8 },
    acquisition: null,
    ...over,
  };
}

function task(over: Partial<BuildTask> = {}): BuildTask {
  return {
    taskId: 't1', title: 'בניית ספסלים', status: 'open',
    dueOn: new Date('2026-07-12T00:00:00Z'),
    peopleNeeded: 2, accepted: 1, uncovered: true,
    assignees: [{ assignmentId: 'as1', personId: 'p1', displayName: 'איתי כהן', status: 'accepted' }],
    materials: [material()],
    materialState: 'ready',
    ...over,
  };
}

function mount(tasks: BuildTask[]) {
  const counts: Record<string, number> = {};
  for (const one of tasks) counts[groupOf(one)] = (counts[groupOf(one)] ?? 0) + 1;
  return render(<BuildTable tasks={tasks} groupCounts={counts} empty={<p>אין משימות</p>} />);
}

describe('BuildTable', () => {
  it('names every column in Hebrew and nothing in English', () => {
    mount([task()]);
    for (const header of within(screen.getByRole('table')).getAllByRole('columnheader')) {
      expect(header.textContent ?? '').not.toMatch(/[A-Za-z]/);
    }
  });

  it('draws a task and the things it needs under it', () => {
    mount([task()]);
    expect(screen.getByText('בניית ספסלים')).toBeTruthy();
    expect(screen.getByText('משטחי עץ')).toBeTruthy();
  });

  it('says every material state in words', () => {
    // R3. Four states, four sentences — a reader who cannot tell the tones
    // apart loses nothing.
    mount([task({
      materials: [
        material({ id: 'm1', state: 'in_stock' }),
        material({ id: 'm2', name: 'ברגים', state: 'missing', inventory: null }),
        material({
          id: 'm3', name: 'מברגה', state: 'obtained', inventory: null,
          acquisition: { id: 'a1', status: 'ordered' },
        }),
        material({
          id: 'm4', name: 'משאבה', state: 'needs_repair',
          inventory: { id: 'inv-2', locationText: 'משטח 2', condition: 'needs_repair', quantity: 1 },
        }),
      ],
      materialState: 'missing',
    })]);

    expect(screen.getByText('במחסן')).toBeTruthy();
    expect(screen.getByText('צריך להשיג')).toBeTruthy();
    expect(screen.getByText('הושג')).toBeTruthy();
    expect(screen.getByText('במחסן · דורש תיקון')).toBeTruthy();
  });

  it('sends every material to the screen that can change it', () => {
    // D1. A material on a shelf links to that shelf; one on order links to
    // the order. Neither is a figure a reader can act on where it stands.
    mount([task({
      materials: [
        material({ id: 'm1' }),
        material({
          id: 'm2', name: 'ברגים', state: 'obtained', inventory: null,
          acquisition: { id: 'a1', status: 'ordered' },
        }),
      ],
    })]);

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((href) => href.includes('/logistics/warehouse') && href.includes('inv-1'))).toBe(true);
    expect(hrefs.some((href) => href.includes('/logistics/acquisitions') && href.includes('a1'))).toBe(true);
  });

  it('gives a material with neither link a dash, not a dead link', () => {
    mount([task({
      materials: [material({ id: 'm2', name: 'דבק', state: 'missing', inventory: null })],
      materialState: 'missing',
    })]);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('counts what a task is missing, rather than saying "blocked"', () => {
    // "חסר חומר אחד" tells a lead how much work is left; "blocked" does not.
    mount([task({
      materials: [
        material({ id: 'm1', state: 'missing', inventory: null }),
        material({ id: 'm2', name: 'ברגים', state: 'missing', inventory: null }),
      ],
      materialState: 'missing',
    })]);
    expect(screen.getByText('חסרים 2 חומרים')).toBeTruthy();
  });

  it('separates a task with no list from one whose list is satisfied', () => {
    // They read identically if collapsed, and only one of them needs anybody
    // to do anything.
    mount([task({ materials: [], materialState: 'none' })]);
    expect(screen.getByText('לא נרשמו חומרים')).toBeTruthy();
  });

  it('draws the places nobody is assigned to yet', () => {
    mount([task()]);
    // peopleNeeded 2, accepted 1 → one empty slot, drawn rather than implied.
    expect(screen.getByRole('group', { name: /משובצים/ })).toBeTruthy();
  });

  it('shows the empty state it was handed rather than an empty grid', () => {
    mount([]);
    expect(screen.getByText('אין משימות')).toBeTruthy();
  });
});
