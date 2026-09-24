/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ShadeAtHour } from '@/lib/site/editor/sun';
import { hourText, SunCard } from './sun-card';

const HREF = '/site?season=s26&act=plot';
const DATE_HREF = '/site?season=s26&act=season-date';

function renderCard(over: Partial<{ hour: number; summary: ShadeAtHour | null; northDeg: number; sunDate: string | null }> = {}) {
  const onHour = vi.fn();
  render(
    <SunCard
      hour={over.hour ?? 14}
      onHour={onHour}
      summary={over.summary === undefined ? { under: 13, full: 4, partial: 4, sun: 5 } : over.summary}
      northDeg={over.northDeg ?? 0}
      plotHref={HREF}
      dateHref={DATE_HREF}
      sunDate={over.sunDate === undefined ? '2026-06-04' : over.sunDate}
    />,
  );
  return { onHour };
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

  it('runs from 07:00 to 18:00 in quarter hours', () => {
    const { onHour } = renderCard();
    const slider = screen.getByRole('slider', { name: 'שעה ביום' }) as HTMLInputElement;
    expect([slider.min, slider.max, slider.step]).toEqual(['7', '18', '0.25']);
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
    renderCard({ sunDate: null, summary: null });
    // Ruling SD4: an empty state is an invitation, with the way to the date.
    expect(screen.getByText('לעונה הזו עוד לא נרשם תאריך פתיחה. עם תאריך, הצל לפי שעה יחושב ליום פתיחת השער.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'קביעת תאריך הפתיחה' }).getAttribute('href')).toBe(DATE_HREF);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByText(/כרגע התאריך נקבע רק בפתיחת עונה/)).toBeNull();
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
