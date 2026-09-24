/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { ShadeSample } from '@/lib/site/editor/shade-timeline';
import { hourText, SunCard, type SunCardProps } from './sun-card';
import { usePlayback, type DaySpan, type Moment } from './sun-playback';

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

/* ── playback ─────────────────────────────────────────────────────────────
   The browser's frames, by hand: `requestAnimationFrame` queues a callback,
   and `runFrames` calls the queue every 16 ms of a clock the test owns, one
   frame per `act` so each commit renders as it would in the browser. */

let queue = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let clock = 0;
const requestFrame = vi.fn((callback: FrameRequestCallback) => {
  const id = nextFrame;
  nextFrame += 1;
  queue.set(id, callback);
  return id;
});
const cancelFrame = vi.fn((id: number) => { queue.delete(id); });

/** `prefers-reduced-motion`, as the test sets it; nothing else is asked of `matchMedia` here. */
let reduceMotion = false;

beforeEach(() => {
  queue = new Map();
  nextFrame = 1;
  clock = 0;
  reduceMotion = false;
  requestFrame.mockClear();
  cancelFrame.mockClear();
  vi.stubGlobal('requestAnimationFrame', requestFrame);
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' && reduceMotion,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const FRAME_MS = 16;

function runFrames(ms: number): void {
  for (let spent = 0; spent < ms; spent += FRAME_MS) {
    act(() => {
      clock += FRAME_MS;
      const due = [...queue.values()];
      queue.clear();
      for (const callback of due) callback(clock);
    });
  }
}

/** The card as the editor holds it: the hour and the day are state above it. */
function Player(over: Partial<SunCardProps> & { hour?: number; day?: string }) {
  const [hour, setHour] = useState(over.hour ?? 12);
  const [day, setDay] = useState(over.day ?? NOV2);
  return (
    <SunCard
      summary={{ under: 3, full: 1, partial: 1, sun: 1 }}
      northDeg={0}
      plotHref={HREF}
      dateHref={DATE_HREF}
      sunDate={NOV2}
      samples={[]}
      hasNets
      {...over}
      hour={hour}
      day={day}
      onHour={(next) => { over.onHour?.(next); setHour(next); }}
      onDay={(next) => { over.onDay?.(next); setDay(next); }}
    />
  );
}

const playButton = () => screen.getByRole('button', { name: 'הרצת הצל לאורך השעות' });
const hourOnScreen = () => screen.getByRole('slider', { name: 'שעה ביום' }).getAttribute('aria-valuetext');
const lastHour = (onHour: ReturnType<typeof vi.fn>) => onHour.mock.lastCall?.[0] as number;
const pressedDay = () => within(screen.getByRole('group', { name: 'ימי הברן' }))
  .getAllByRole('button').find((chip) => chip.getAttribute('aria-pressed') === 'true')?.textContent;

describe('playing the shade through the day', () => {
  it('plays from the hour on screen, at 30 simulated minutes a second, and stops at sunset', () => {
    const onHour = vi.fn();
    render(<Player hour={16} onHour={onHour} />);
    expect(playButton().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(playButton());
    expect(playButton().getAttribute('aria-pressed')).toBe('true');
    runFrames(1000);
    // About half an hour on, committed at most 100 ms behind the clock.
    expect(lastHour(onHour)).toBeGreaterThan(16.4);
    expect(lastHour(onHour)).toBeLessThanOrEqual(16.5);
    // 2 November's last quarter hour of daylight is 16:45: 45 minutes, a second and a half.
    runFrames(1000);
    expect(hourOnScreen()).toBe('16:45');
    expect(lastHour(onHour)).toBe(16.75);
    expect(playButton().getAttribute('aria-pressed')).toBe('false');
    expect(queue.size).toBe(0);
    const calls = onHour.mock.calls.length;
    runFrames(500);
    expect(onHour.mock.calls.length).toBe(calls);
  });

  it('starts the day again from sunrise when played at its end', () => {
    const onHour = vi.fn();
    render(<Player hour={16.75} onHour={onHour} />);
    fireEvent.click(playButton());
    expect(onHour).toHaveBeenCalledWith(6);
    expect(hourOnScreen()).toBe('06:00');
    runFrames(1000);
    expect(lastHour(onHour)).toBeGreaterThan(6.4);
  });

  it('commits the hour at most ten times a second, whatever the frame rate', () => {
    const onHour = vi.fn();
    render(<Player hour={8} onHour={onHour} />);
    fireEvent.click(playButton());
    runFrames(2000); // 125 frames
    expect(requestFrame.mock.calls.length).toBeGreaterThan(120);
    expect(onHour.mock.calls.length).toBeLessThanOrEqual(20);
    expect(onHour.mock.calls.length).toBeGreaterThanOrEqual(15);
    // Each committed hour is a whole minute: the text and the scene never show a fraction of one.
    for (const [hour] of onHour.mock.calls as [number][]) expect(Math.abs(hour * 60 - Math.round(hour * 60))).toBeLessThan(1e-9);
  });

  it('runs at the speed chosen: 10, 30 or 90 simulated minutes a second', () => {
    const slow = vi.fn();
    const { unmount } = render(<Player hour={8} onHour={slow} />);
    fireEvent.click(screen.getByRole('radio', { name: 'איטי' }));
    fireEvent.click(playButton());
    runFrames(1000);
    expect(lastHour(slow) - 8).toBeGreaterThan(8 / 60);
    expect(lastHour(slow) - 8).toBeLessThanOrEqual(10 / 60);
    unmount();

    const fast = vi.fn();
    render(<Player hour={8} onHour={fast} />);
    expect((screen.getByRole('radio', { name: 'רגיל' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'מהיר' }));
    fireEvent.click(playButton());
    runFrames(1000);
    expect(lastHour(fast) - 8).toBeGreaterThan(80 / 60);
    expect(lastHour(fast) - 8).toBeLessThanOrEqual(90 / 60);
  });

  it('changes speed mid-play from where it is, without stopping', () => {
    const onHour = vi.fn();
    render(<Player hour={8} onHour={onHour} />);
    fireEvent.click(playButton());
    runFrames(1000);
    const halfway = lastHour(onHour);
    fireEvent.click(screen.getByRole('radio', { name: 'מהיר' }));
    expect(playButton().getAttribute('aria-pressed')).toBe('true');
    runFrames(1000);
    expect(lastHour(onHour) - halfway).toBeGreaterThan(80 / 60);
    expect(lastHour(onHour) - halfway).toBeLessThan(100 / 60);
  });

  it('pauses when the hour is changed by hand — on the slider or on the strip — and stops asking for frames', () => {
    const onHour = vi.fn();
    const { container } = render(<Player hour={8} onHour={onHour} samples={MIDDAY} />);
    fireEvent.click(playButton());
    runFrames(500);
    fireEvent.change(screen.getByRole('slider', { name: 'שעה ביום' }), { target: { value: '12' } });
    expect(playButton().getAttribute('aria-pressed')).toBe('false');
    expect(queue.size).toBe(0);
    runFrames(1000);
    expect(hourOnScreen()).toBe('12:00');

    fireEvent.click(playButton());
    runFrames(500);
    fireEvent.click(column(container, 10.25));
    expect(playButton().getAttribute('aria-pressed')).toBe('false');
    runFrames(1000);
    expect(hourOnScreen()).toBe('10:15');
  });

  it('pauses when another day is picked', () => {
    render(<Player hour={8} endDay="2026-11-04" />);
    fireEvent.click(playButton());
    runFrames(300);
    fireEvent.click(screen.getByRole('button', { name: 'ג׳ 3.11' }));
    expect(playButton().getAttribute('aria-pressed')).toBe('false');
    expect(queue.size).toBe(0);
    expect(pressedDay()).toBe('ג׳ 3.11');
  });

  it('does not leap ahead when the tab comes back from the background', () => {
    const onHour = vi.fn();
    render(<Player hour={8} onHour={onHour} />);
    fireEvent.click(playButton());
    runFrames(320);
    // A minute in a background tab: the browser gives no frames, then one late one.
    clock += 60_000;
    runFrames(16);
    runFrames(320);
    expect(playButton().getAttribute('aria-pressed')).toBe('true');
    // About two thirds of a second of play at 30 minutes a second, not a minute of it (30 hours).
    expect(lastHour(onHour)).toBeGreaterThan(8.2);
    expect(lastHour(onHour)).toBeLessThan(8.5);
  });

  it('cancels its frame when the card goes away mid-play', () => {
    const onHour = vi.fn();
    const { unmount } = render(<Player hour={8} onHour={onHour} />);
    fireEvent.click(playButton());
    runFrames(200);
    const pending = [...queue.keys()];
    expect(pending).toHaveLength(1);
    unmount();
    expect(cancelFrame).toHaveBeenCalledWith(pending[0]);
    expect(queue.size).toBe(0);
    const calls = onHour.mock.calls.length;
    runFrames(500);
    expect(onHour.mock.calls.length).toBe(calls);
  });
});

describe('the scope of playback', () => {
  it('offers one day only while the burn’s last day is unknown, and invites that date', () => {
    render(<Player />);
    expect((screen.getByRole('radio', { name: 'יום אחד' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'כל ימי הברן' }) as HTMLInputElement).disabled).toBe(true);
    expect(paragraph('תאריך הסיום של הברן לא נרשם · קביעה')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'קביעה של תאריך הסיום של הברן' }).getAttribute('href')).toBe(DATE_HREF);
  });

  it('says so when the last day recorded comes before the first, rather than guessing either', () => {
    render(<Player endDay="2026-11-01" />);
    expect((screen.getByRole('radio', { name: 'כל ימי הברן' }) as HTMLInputElement).disabled).toBe(true);
    expect(paragraph('תאריך הסיום של הברן קודם לתאריך הפתיחה · תיקון')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'תיקון של תאריך הסיום של הברן' }).getAttribute('href')).toBe(DATE_HREF);
  });

  it('plays every day of the burn back to back once the last day is known, skipping the nights', () => {
    const onHour = vi.fn();
    const onDay = vi.fn();
    render(<Player hour={16.5} endDay="2026-11-04" onHour={onHour} onDay={onDay} />);
    expect(screen.queryByText(/לא נרשם/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'כל ימי הברן' }));
    fireEvent.click(screen.getByRole('radio', { name: 'מהיר' }));
    fireEvent.click(playButton());
    runFrames(1000);
    // A quarter hour to 2 November's sunset, then straight on from 3 November's first quarter hour, 06:00.
    expect(pressedDay()).toBe('ג׳ 3.11');
    expect(lastHour(onHour)).toBeGreaterThan(6.75);
    expect(lastHour(onHour)).toBeLessThanOrEqual(7.25);
    expect(onDay).toHaveBeenCalledWith('2026-11-03');
    runFrames(16_000);
    expect(pressedDay()).toBe('ד׳ 4.11');
    expect(hourOnScreen()).toBe('16:45');
    expect(playButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('starts the burn again from its first sunrise when played at its end', () => {
    const onDay = vi.fn();
    render(<Player hour={16.75} day="2026-11-04" endDay="2026-11-04" onDay={onDay} />);
    fireEvent.click(screen.getByRole('radio', { name: 'כל ימי הברן' }));
    fireEvent.click(playButton());
    expect(onDay).toHaveBeenLastCalledWith(NOV2);
    expect(hourOnScreen()).toBe('06:00');
  });

  it('pauses when a day is picked while the whole burn plays — the scope is the same, the lead’s choice is not', () => {
    render(<Player hour={8} endDay="2026-11-04" />);
    fireEvent.click(screen.getByRole('radio', { name: 'כל ימי הברן' }));
    fireEvent.click(playButton());
    runFrames(300);
    fireEvent.click(screen.getByRole('button', { name: 'ד׳ 4.11' }));
    expect(playButton().getAttribute('aria-pressed')).toBe('false');
    expect(queue.size).toBe(0);
    const picked = hourOnScreen();
    runFrames(1000);
    expect(pressedDay()).toBe('ד׳ 4.11');
    expect(hourOnScreen()).toBe(picked);
  });

  it('pauses when the scope changes', () => {
    render(<Player hour={8} endDay="2026-11-04" />);
    fireEvent.click(playButton());
    runFrames(300);
    fireEvent.click(screen.getByRole('radio', { name: 'כל ימי הברן' }));
    expect(playButton().getAttribute('aria-pressed')).toBe('false');
    expect(queue.size).toBe(0);
  });
});

describe('with motion reduced', () => {
  it('steps whole quarter hours once a second instead of gliding', () => {
    reduceMotion = true;
    const onHour = vi.fn();
    render(<Player hour={8} onHour={onHour} />);
    fireEvent.click(playButton());
    runFrames(900);
    expect(onHour).not.toHaveBeenCalled();
    runFrames(200);
    expect(onHour.mock.calls).toEqual([[8.5]]);
    runFrames(1000);
    expect(onHour.mock.calls).toEqual([[8.5], [9]]);
  });

  it('steps one quarter hour a second at the slow speed, and six at the fast', () => {
    reduceMotion = true;
    const onHour = vi.fn();
    const { unmount } = render(<Player hour={8} onHour={onHour} />);
    fireEvent.click(screen.getByRole('radio', { name: 'איטי' }));
    fireEvent.click(playButton());
    runFrames(1100);
    expect(lastHour(onHour)).toBe(8.25);
    unmount();
    onHour.mockClear();
    render(<Player hour={8} onHour={onHour} />);
    fireEvent.click(screen.getByRole('radio', { name: 'מהיר' }));
    fireEvent.click(playButton());
    runFrames(1100);
    expect(lastHour(onHour)).toBe(9.5);
  });
});

describe('the playback clock', () => {
  const SPAN: DaySpan = { day: NOV2, from: 6, to: 16.75 };

  /** A caller that hands `usePlayback` a new array every render, the same days in it. */
  function Clock({ onMoment }: { onMoment: (moment: Moment) => void }) {
    const [moment, setMoment] = useState<Moment>({ day: NOV2, hour: 8 });
    const playback = usePlayback({
      scopeKey: NOV2,
      spans: [{ ...SPAN }],
      minutesPerSecond: 30,
      reduced: false,
      onMoment: (next) => { onMoment(next); setMoment(next); },
    });
    return (
      <button type="button" aria-pressed={playback.playing} onClick={() => { playback.play(moment); }}>
        {hourText(moment.hour)}
      </button>
    );
  }

  it('belongs to the scope’s days, not to the array they came in', () => {
    const onMoment = vi.fn();
    render(<Clock onMoment={onMoment} />);
    fireEvent.click(screen.getByRole('button'));
    runFrames(1000);
    // Every commit re-rendered the caller with a new array: still playing, and moving.
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
    expect(onMoment.mock.calls.length).toBeGreaterThan(5);
    expect(onMoment.mock.lastCall?.[0].hour).toBeGreaterThan(8.4);
  });
});
