/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { TentShade } from '@/lib/site/editor/shade-timeline';
import { SunCard, type SunCardProps } from './sun-card';
import { shadeDurationText } from './tent-ranking';

const NOV2 = '2026-11-02';
const DATE_HREF = '/site?season=s26&act=season-date';

function tentShade(id: string, label: string, shadedMinutes: number): TentShade {
  return { id, label, shadedMinutes, fullMinutes: shadedMinutes, partialMinutes: 0, days: [] };
}

const RANKED = [
  tentShade('t1', 'אוהל 1', 270),
  tentShade('t2', 'אוהל 2', 75),
  tentShade('t3', 'אוהל 3', 45),
  tentShade('t4', 'אוהל 4', 0),
];

function renderCard(over: Partial<SunCardProps> = {}) {
  const rankTents = vi.fn<(dates: readonly string[], endHour: number) => TentShade[]>(() => RANKED);
  const onPickIds = vi.fn();
  const props: SunCardProps = {
    hour: 12,
    onHour: vi.fn(),
    summary: { under: 3, full: 1, partial: 1, sun: 1 },
    northDeg: 0,
    plotHref: '/site?season=s26&act=plot',
    dateHref: DATE_HREF,
    sunDate: NOV2,
    day: NOV2,
    onDay: vi.fn(),
    samples: [],
    hasNets: true,
    rankTents,
    onPickIds,
    ...over,
  };
  render(<SunCard {...props} />);
  return { rankTents: (over.rankTents ?? rankTents) as typeof rankTents, onPickIds };
}

const disclosure = () => screen.getByRole('button', { name: 'האוהלים המוצלים ביותר' });
const list = () => within(screen.getByRole('list', { name: 'האוהלים המוצלים ביותר' }));
const rows = () => list().getAllByRole('button').map((row) => row.textContent);

/** A paragraph whose whole text is `text` — figures sit in their own `<bdi>`. */
function paragraph(text: string): HTMLElement {
  return screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === text);
}

describe('how long, in words', () => {
  it('says hours and minutes, one of each in the singular', () => {
    expect(shadeDurationText(270)).toBe('4 שעות ו־30 דקות בצל');
    expect(shadeDurationText(75)).toBe('שעה ו־15 דקות בצל');
    expect(shadeDurationText(45)).toBe('45 דקות בצל');
    expect(shadeDurationText(120)).toBe('2 שעות בצל');
    expect(shadeDurationText(61)).toBe('שעה ודקה בצל');
    // Part shade counts half, so half minutes happen: said to the nearest minute.
    expect(shadeDurationText(37.5)).toBe('38 דקות בצל');
    expect(shadeDurationText(0)).toBe('אין צל');
    expect(shadeDurationText(0.4)).toBe('אין צל');
  });
});

describe('the most shaded tents', () => {
  it('stays folded, and works nothing out, until it is opened', () => {
    const { rankTents } = renderCard();
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'האוהלים המוצלים ביותר' })).toBeNull();
    expect(rankTents).not.toHaveBeenCalled();
  });

  it('ranks the tents for the day on screen, from sunrise to 15:00, part shade counted half', () => {
    const { rankTents } = renderCard();
    fireEvent.click(disclosure());
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    expect(rankTents).toHaveBeenLastCalledWith([NOV2], 15);
    expect(rows()).toEqual([
      'אוהל 14 שעות ו־30 דקות בצל',
      'אוהל 2שעה ו־15 דקות בצל',
      'אוהל 345 דקות בצל',
      'אוהל 4אין צל',
    ]);
    expect(paragraph('ביום 2.11, מהזריחה עד 15:00. צל חלקי נספר כחצי.')).toBeTruthy();
    const figures = [...list().getAllByRole('button')[0].querySelectorAll('bdi')].map((node) => node.textContent);
    expect(figures).toEqual(['אוהל 1', '4 שעות ו־30 דקות בצל']);
  });

  it('selects a tent from its row — a figure links to what changes it', () => {
    const { onPickIds } = renderCard();
    fireEvent.click(disclosure());
    fireEvent.click(list().getByRole('button', { name: /^אוהל 2/ }));
    expect(onPickIds).toHaveBeenCalledWith(['t2']);
  });

  it('counts to the hour chosen, and to sunset when that comes first', () => {
    const { rankTents } = renderCard();
    fireEvent.click(disclosure());
    const until = within(screen.getByRole('radiogroup', { name: 'סוף הספירה' }));
    expect(until.getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual(['13:00', '15:00', '17:00']);
    expect((until.getByRole('radio', { name: '15:00' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(until.getByRole('radio', { name: '13:00' }));
    expect(rankTents).toHaveBeenLastCalledWith([NOV2], 13);
    expect(paragraph('ביום 2.11, מהזריחה עד 13:00. צל חלקי נספר כחצי.')).toBeTruthy();
    // 2 November's sunset is 16:50:56: 17:00 is past it.
    fireEvent.click(until.getByRole('radio', { name: '17:00' }));
    expect(rankTents).toHaveBeenLastCalledWith([NOV2], 17);
    expect(paragraph('ביום 2.11, מהזריחה עד השקיעה. צל חלקי נספר כחצי.')).toBeTruthy();
  });

  it('ranks every day of the burn when the burn is what plays', () => {
    const { rankTents } = renderCard({ endDay: '2026-11-04' });
    fireEvent.click(screen.getByRole('radio', { name: 'כל ימי הברן' }));
    fireEvent.click(disclosure());
    expect(rankTents).toHaveBeenLastCalledWith(['2026-11-02', '2026-11-03', '2026-11-04'], 15);
    expect(paragraph('בכל 3 ימי הברן, מהזריחה עד 15:00 בכל יום. צל חלקי נספר כחצי.')).toBeTruthy();
  });

  it('shows five tents, and the rest on asking', () => {
    const many = Array.from({ length: 7 }, (_, index) => tentShade(`t${index}`, `אוהל ${index + 1}`, 60 - index));
    renderCard({ rankTents: vi.fn(() => many) });
    fireEvent.click(disclosure());
    expect(rows()).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'כל 7 האוהלים' }));
    expect(rows()).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'חמשת הראשונים בלבד' }));
    expect(rows()).toHaveLength(5);
  });

  it('invites a tent when the map has none', () => {
    renderCard({ rankTents: vi.fn(() => []) });
    fireEvent.click(disclosure());
    expect(paragraph('אין עדיין אוהלים במפה. גרירה של אוהל מהספרייה תוסיף אחד, וכאן יופיע כמה זמן הוא בצל.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'האוהלים המוצלים ביותר' })).toBeNull();
  });

  it('invites a net when the map has none', () => {
    const { rankTents } = renderCard({ hasNets: false });
    fireEvent.click(disclosure());
    expect(paragraph('אין עדיין רשתות צל במפה. רשת צל מעל האוהלים תראה כאן כמה זמן כל אחד מהם בצל.')).toBeTruthy();
    expect(rankTents).not.toHaveBeenCalled();
  });

  it('invites moving a net over a tent when no tent gets any shade', () => {
    renderCard({ rankTents: vi.fn(() => [tentShade('t1', 'אוהל 1', 0), tentShade('t2', 'אוהל 2', 0)]) });
    fireEvent.click(disclosure());
    expect(rows()).toEqual(['אוהל 1אין צל', 'אוהל 2אין צל']);
    expect(paragraph('הזזה של רשת צל מעל אוהל תוסיף לו צל.')).toBeTruthy();
  });
});
