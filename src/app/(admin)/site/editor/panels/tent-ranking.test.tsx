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

/**
 * The tents with a day entry for each date, saying whether that day's count
 * stopped at sunset — as `shadeRanking` says it. `stoppedAtSunset` stands in
 * for the core's own rule (2 November's sunset is 16:50:56).
 */
function withDays(
  tents: readonly TentShade[],
  dates: readonly string[],
  stoppedAtSunset: (date: string) => boolean,
): TentShade[] {
  return tents.map((tent) => ({
    ...tent,
    days: dates.map((date) => ({
      date, shadedMinutes: 0, fullMinutes: 0, partialMinutes: 0, untilSunset: stoppedAtSunset(date),
    })),
  }));
}

function renderCard(over: Partial<SunCardProps> = {}) {
  const rankTents = vi.fn<(dates: readonly string[], endHour: number) => TentShade[]>(
    (dates, endHour) => withDays(RANKED, dates, () => endHour >= 17),
  );
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
  });

  it('says a little shade is a little, never none', () => {
    // A sample cut short at sunset can leave seconds of part shade: some, not none.
    expect(shadeDurationText(0.4)).toBe('פחות מדקה בצל');
    expect(shadeDurationText(0.01)).toBe('פחות מדקה בצל');
    expect(shadeDurationText(0.5)).toBe('דקה בצל');
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
    // The name and the time are two isolated runs with a space between, so a reader hears two phrases.
    expect(rows()).toEqual([
      'אוהל 1 4 שעות ו־30 דקות בצל',
      'אוהל 2 שעה ו־15 דקות בצל',
      'אוהל 3 45 דקות בצל',
      'אוהל 4 אין צל',
    ]);
    expect(paragraph('ביום 2.11, מהזריחה עד 15:00. צל חלקי נספר כחצי.')).toBeTruthy();
    const figures = [...list().getAllByRole('button')[0].querySelectorAll('bdi')].map((node) => node.textContent);
    expect(figures).toEqual(['אוהל 1', '4 שעות ו־30 דקות בצל']);
    // WebKit drops an unstyled list's role; it is said outright.
    expect(screen.getByRole('list', { name: 'האוהלים המוצלים ביותר' }).getAttribute('role')).toBe('list');
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
    // 2 November's sunset is 16:50:56: 17:00 is past it, and the ranking says so.
    fireEvent.click(until.getByRole('radio', { name: '17:00' }));
    expect(rankTents).toHaveBeenLastCalledWith([NOV2], 17);
    expect(paragraph('ביום 2.11, מהזריחה עד השקיעה. צל חלקי נספר כחצי.')).toBeTruthy();
  });

  it('says "to sunset" when the ranking says every day stopped there — the rule is the ranking’s, not the card’s', () => {
    // A ranking that stopped at sunset even at 13:00 (a winter's day, say): the card believes it.
    renderCard({ rankTents: vi.fn((dates: readonly string[]) => withDays(RANKED, dates, () => true)) });
    fireEvent.click(disclosure());
    expect(paragraph('ביום 2.11, מהזריחה עד השקיעה. צל חלקי נספר כחצי.')).toBeTruthy();
  });

  it('names the hour when only some days of the burn stopped at sunset', () => {
    renderCard({
      endDay: '2026-11-03',
      rankTents: vi.fn((dates: readonly string[]) => withDays(RANKED, dates, (date) => date === NOV2)),
    });
    fireEvent.click(screen.getByRole('radio', { name: 'כל ימי הברן' }));
    fireEvent.click(disclosure());
    expect(paragraph('בכל 2 ימי הברן, מהזריחה עד 15:00 בכל יום. צל חלקי נספר כחצי.')).toBeTruthy();
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

  it('says there are no nets once, and points a net at the tents there are', () => {
    renderCard({ hasNets: false });
    fireEvent.click(disclosure());
    // The card's own sentence already says it; the ranking does not say it again.
    expect(screen.getAllByText(/אין עדיין רשתות צל/)).toHaveLength(1);
    expect(paragraph('רשת צל מעל האוהלים תראה כאן כמה זמן כל אחד מהם בצל.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'האוהלים המוצלים ביותר' })).toBeNull();
  });

  it('with no nets and no tents, invites a tent — no talk of nets over tents that are not there', () => {
    renderCard({ hasNets: false, rankTents: vi.fn(() => []) });
    fireEvent.click(disclosure());
    expect(screen.getAllByText(/אין עדיין רשתות צל/)).toHaveLength(1);
    expect(paragraph('אין עדיין אוהלים במפה. גרירה של אוהל מהספרייה תוסיף אחד, וכאן יופיע כמה זמן הוא בצל.')).toBeTruthy();
    expect(screen.queryByText(/מעל האוהלים/)).toBeNull();
  });

  it('invites moving a net over a tent when no tent gets any shade', () => {
    renderCard({ rankTents: vi.fn(() => [tentShade('t1', 'אוהל 1', 0), tentShade('t2', 'אוהל 2', 0)]) });
    fireEvent.click(disclosure());
    expect(rows()).toEqual(['אוהל 1 אין צל', 'אוהל 2 אין צל']);
    expect(paragraph('הזזה של רשת צל מעל אוהל תוסיף לו צל.')).toBeTruthy();
  });

  it('does not invite moving a net when a tent has even a little shade', () => {
    renderCard({ rankTents: vi.fn(() => [tentShade('t1', 'אוהל 1', 0.4), tentShade('t2', 'אוהל 2', 0)]) });
    fireEvent.click(disclosure());
    expect(rows()).toEqual(['אוהל 1 פחות מדקה בצל', 'אוהל 2 אין צל']);
    expect(screen.queryByText(/הזזה של רשת צל מעל אוהל/)).toBeNull();
  });
});
