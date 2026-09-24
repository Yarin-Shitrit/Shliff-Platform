/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ShadeSample } from '@/lib/site/editor/shade-timeline';
import { hourText, SunCard, type SunCardProps } from './sun-card';

const HREF = '/site?season=s26&act=plot';
const DATE_HREF = '/site?season=s26&act=season-date';
const NOV2 = '2026-11-02';

function renderCard(over: Partial<SunCardProps> = {}) {
  const onHour = vi.fn();
  const onDay = vi.fn();
  const sunDate = over.sunDate === undefined ? '2026-06-04' : over.sunDate;
  const props: SunCardProps = {
    hour: 14,
    onHour,
    summary: { under: 13, full: 4, partial: 4, sun: 5 },
    northDeg: 0,
    plotHref: HREF,
    dateHref: DATE_HREF,
    sunDate,
    day: sunDate,
    onDay,
    samples: [],
    hasNets: true,
    ...over,
  };
  const rendered = render(<SunCard {...props} />);
  return { ...rendered, onHour, onDay };
}

/**
 * A day of samples at the quarter hours of 2 November's daylight, 06:00 to
 * 16:45 (44 of them, as `shadeTimeline` gives them), with `under` items under
 * the nets; `shade(hour)` says how many are in full and in part shade.
 */
function dayOf(shade: (hour: number) => [number, number], under = 3): ShadeSample[] {
  return Array.from({ length: 44 }, (_, index) => {
    const hour = 6 + index / 4;
    const [full, partial] = under === 0 ? [0, 0] : shade(hour);
    return { date: NOV2, hour, counts: { under, full, partial, sun: under - full - partial } };
  });
}

const between = (hour: number, from: number, to: number) => hour >= from && hour <= to;

/** All three in full shade 10:15–14:30; two of three shaded at all 09:30–15:00; one in part shade otherwise. */
const MIDDAY = dayOf((hour) => (between(hour, 10.25, 14.5) ? [3, 0] : between(hour, 9.5, 15) ? [1, 1] : [0, 1]));

/** A paragraph whose whole text is `text` — times sit in their own `<bdi>`, so the text is split across nodes. */
function paragraph(text: string): HTMLElement {
  return screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === text);
}

function column(container: HTMLElement, hour: number): Element {
  const found = container.querySelector(`[data-strip] [data-hour="${hour}"]`);
  if (found === null) throw new Error(`no column at ${hour}`);
  return found;
}

function share(container: HTMLElement, hour: number, shade: 'full' | 'partial'): number {
  return Number(column(container, hour).querySelector(`[data-shade="${shade}"]`)?.getAttribute('height') ?? 0);
}

describe('shade by hour', () => {
  it('says what is really shaded at the hour, for the gate day, with the date and its source', () => {
    renderCard();
    expect(screen.getByText('בשעה 14:00, מתוך 13 פריטים מתחת לרשתות: 4 בצל מלא, 4 בצל חלקי, 5 בשמש.')).toBeTruthy();
    // The date is a figure, so it links to what changes it (ruling SD4): the season's opening date.
    const date = screen.getByRole('link', { name: /^4\.6\.2026/ });
    expect(date.getAttribute('href')).toBe(DATE_HREF);
    expect(date.closest('p')?.textContent).toBe('ביום פתיחת השער, 4.6.2026 (תאריך הפתיחה של העונה), במיקום של מידברן.');
  });

  it('says "פריט אחד" rather than "1 פריטים"', () => {
    renderCard({ summary: { under: 1, full: 0, partial: 0, sun: 1 } });
    expect(screen.getByText('בשעה 14:00, מתוך פריט אחד מתחת לרשתות: 0 בצל מלא, 0 בצל חלקי, 1 בשמש.')).toBeTruthy();
  });

  it('runs from the day’s first to its last quarter hour of daylight', () => {
    // 4 June at the camp: sunrise 05:39:37, sunset 19:38:51 (the almanac, shade-timeline.test.ts).
    const { onHour } = renderCard();
    const slider = screen.getByRole('slider', { name: 'שעה ביום' }) as HTMLInputElement;
    expect([slider.min, slider.max, slider.step]).toEqual(['5.75', '19.5', '0.25']);
    expect(slider.getAttribute('aria-valuetext')).toBe('14:00');
    fireEvent.change(slider, { target: { value: '9.25' } });
    expect(onHour).toHaveBeenCalledWith(9.25);
    expect(hourText(9.25)).toBe('09:15');
    expect(hourText(17.75)).toBe('17:45');
  });

  it('rounds the minute rather than truncating it, so the upper end reads 18:00 and never 17:60', () => {
    expect(hourText(18)).toBe('18:00');
    // Old bug: whole=floor(17.999999)=17, minutes=round(0.999999*60)=60 → "17:60".
    expect(hourText(17.999999)).toBe('18:00');
  });

  it('says the sun is down, or that nothing is under a net, rather than counting nothing', () => {
    renderCard({ hour: 7, summary: null });
    expect(screen.getByText('בשעה 07:00 השמש מתחת לאופק, ואין צל להראות.')).toBeTruthy();
  });

  it('invites the season’s opening date when there is none, rather than guessing a day, and draws no slider', () => {
    const { container } = renderCard({ sunDate: null, summary: null });
    // Ruling SD4: an empty state is an invitation, with the way to the date.
    expect(screen.getByText('לעונה הזו עוד לא נרשם תאריך פתיחה. עם תאריך, הצל לפי שעה יחושב ליום פתיחת השער.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'קביעת תאריך הפתיחה' }).getAttribute('href')).toBe(DATE_HREF);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByText(/כרגע התאריך נקבע רק בפתיחת עונה/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'ימי הברן' })).toBeNull();
    expect(container.querySelector('[data-strip]')).toBeNull();
    // North is still shown and still links to the plot settings — that IS where north is changed.
    expect(screen.getByRole('link', { name: 'שינוי בהגדרות המגרש' })).toBeTruthy();
  });

  it('says which way north is, and links to where it is set', () => {
    renderCard({ northDeg: 90, summary: { under: 0, full: 0, partial: 0, sun: 0 } });
    expect(screen.getByText('בשעה 14:00 אין פריטים מתחת לרשתות הצל.')).toBeTruthy();
    expect(screen.getByText('למעלה במפה פונה למזרח (90°)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'שינוי בהגדרות המגרש' }).getAttribute('href')).toBe(HREF);
  });
});

describe('the day’s shade, as a strip', () => {
  it('draws a column a quarter hour, running the way the slider runs on this right-to-left page', () => {
    const { container } = renderCard({ sunDate: NOV2, day: NOV2, hour: 12, samples: MIDDAY });
    const strip = container.querySelector('svg[data-strip]');
    // The slider is the accessible control; the strip is a picture of the day, not a second slider.
    expect(strip?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('[data-strip] [data-hour]')).toHaveLength(44);
    // 06:00 at the inline start — the right — and 16:45 at the left, as the range input lays them out.
    expect(column(container, 6).querySelector('[data-shade="hit"]')?.getAttribute('x')).toBe('43');
    expect(column(container, 16.75).querySelector('[data-shade="hit"]')?.getAttribute('x')).toBe('0');
  });

  it('shows the share of the items under the nets in full shade and in part shade', () => {
    const { container } = renderCard({ sunDate: NOV2, day: NOV2, hour: 12, samples: MIDDAY });
    expect(share(container, 12, 'full')).toBe(1);
    expect(share(container, 12, 'partial')).toBe(0);
    expect(share(container, 9.5, 'full')).toBeCloseTo(1 / 3, 12);
    expect(share(container, 9.5, 'partial')).toBeCloseTo(1 / 3, 12);
    expect(share(container, 7, 'full')).toBe(0);
    expect(column(container, 12).querySelector('title')?.textContent).toBe('12:00: 3 בצל מלא, 0 בצל חלקי, 0 בשמש');
  });

  it('marks the hour on screen with a playhead, at the middle of its column', () => {
    const { container } = renderCard({ sunDate: NOV2, day: NOV2, hour: 12, samples: MIDDAY });
    // 12:00 is the 25th sample of 44: from the right, 24.5 columns in.
    expect(container.querySelector('[data-playhead]')?.getAttribute('x1')).toBe('19.5');
  });

  it('sets the hour when a column is clicked — a figure links to what changes it', () => {
    const { container, onHour } = renderCard({ sunDate: NOV2, day: NOV2, hour: 12, samples: MIDDAY });
    fireEvent.click(column(container, 10.25));
    expect(onHour).toHaveBeenCalledWith(10.25);
  });

  it('draws no strip where nothing stands under a net: an empty bar is no picture', () => {
    const { container } = renderCard({ sunDate: NOV2, day: NOV2, samples: dayOf(() => [0, 0], 0) });
    expect(container.querySelector('[data-strip]')).toBeNull();
  });
});

describe('when there is shade, in words', () => {
  it('names the windows of full shade, and of any shade, each time on its own', () => {
    const { container } = renderCard({ sunDate: NOV2, day: NOV2, samples: MIDDAY });
    expect(paragraph('צל מלא לרוב הפריטים שמתחת לרשתות: 10:15–14:30.')).toBeTruthy();
    expect(paragraph('צל מלא או חלקי לרובם: 09:30–15:00.')).toBeTruthy();
    const times = [...container.querySelectorAll('bdi')].map((node) => node.textContent);
    expect(times).toContain('10:15–14:30');
    expect(times).toContain('09:30–15:00');
  });

  it('lists several windows, and a window of one sample as one time', () => {
    renderCard({
      sunDate: NOV2,
      day: NOV2,
      samples: dayOf((hour) => (hour === 8 || between(hour, 10.25, 11) ? [2, 0] : [0, 0])),
    });
    expect(paragraph('צל מלא לרוב הפריטים שמתחת לרשתות: 08:00, 10:15–11:00.')).toBeTruthy();
    // Full or part shade is the same windows here: said once.
    expect(screen.queryByText(/לרובם/)).toBeNull();
  });

  it('says plainly when full shade never reaches most of them, and when part shade does', () => {
    renderCard({ sunDate: NOV2, day: NOV2, samples: dayOf((hour) => (between(hour, 11, 13) ? [1, 1] : [0, 0])) });
    expect(paragraph('באף שעה ביום הזה אין צל מלא לרוב הפריטים שמתחת לרשתות.')).toBeTruthy();
    expect(paragraph('צל מלא או חלקי לרובם: 11:00–13:00.')).toBeTruthy();
  });

  it('says plainly when no shade reaches most of them at any hour', () => {
    renderCard({ sunDate: NOV2, day: NOV2, samples: dayOf(() => [1, 0]) });
    expect(paragraph('באף שעה ביום הזה אין צל, מלא או חלקי, לרוב הפריטים שמתחת לרשתות.')).toBeTruthy();
  });

  it('invites a net when the map has none', () => {
    const { container } = renderCard({ sunDate: NOV2, day: NOV2, hasNets: false, samples: dayOf(() => [0, 0], 0) });
    expect(paragraph('אין עדיין רשתות צל במפה. גרירה של רשת צל מהספרייה תוסיף אחת, וכאן יופיע מתי יש צל.')).toBeTruthy();
    expect(container.querySelector('[data-strip]')).toBeNull();
  });

  it('invites an item under a net when the nets cover nothing', () => {
    renderCard({ sunDate: NOV2, day: NOV2, hasNets: true, samples: dayOf(() => [0, 0], 0) });
    expect(paragraph('אין עדיין פריטים מתחת לרשתות הצל. גרירה של פריט אל מתחת לרשת תראה כאן מתי הוא בצל.')).toBeTruthy();
  });
});

describe('the days of the burn', () => {
  const chips = () => within(screen.getByRole('group', { name: 'ימי הברן' })).getAllByRole('button');

  it('offers the gate day alone while the burn’s last day is unknown — never a guessed length', () => {
    renderCard({ sunDate: NOV2, day: NOV2 });
    expect(chips().map((chip) => chip.textContent)).toEqual(['ב׳ 2.11']);
    expect(chips()[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('offers every day once the last day is known, and a chip picks the day', () => {
    const { onDay } = renderCard({ sunDate: NOV2, day: NOV2, endDay: '2026-11-04' });
    expect(chips().map((chip) => chip.textContent)).toEqual(['ב׳ 2.11', 'ג׳ 3.11', 'ד׳ 4.11']);
    expect(chips().map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    fireEvent.click(screen.getByRole('button', { name: 'ג׳ 3.11' }));
    expect(onDay).toHaveBeenCalledWith('2026-11-03');
  });

  it('keeps the hour inside the picked day’s daylight', () => {
    // 7 November: sunrise 06:01:25 (the almanac), so its first quarter hour is 06:15.
    const { onDay, onHour } = renderCard({ sunDate: NOV2, day: NOV2, endDay: '2026-11-07', hour: 6 });
    fireEvent.click(screen.getByRole('button', { name: 'ש׳ 7.11' }));
    expect(onDay).toHaveBeenCalledWith('2026-11-07');
    expect(onHour).toHaveBeenCalledWith(6.25);
  });

  it('says which day of the burn is shown, and still links the gate day to where it is set', () => {
    renderCard({ sunDate: NOV2, day: '2026-11-03', endDay: '2026-11-04' });
    expect(chips().map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(paragraph('ביום 3.11.2026 של הברן, שמתחיל בתאריך הפתיחה 2.11.2026, במיקום של מידברן.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /^2\.11\.2026/ }).getAttribute('href')).toBe(DATE_HREF);
  });
});
