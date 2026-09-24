/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ShadeAtHour } from '@/lib/site/editor/sun';
import { hourText, SunCard } from './sun-card';

const HREF = '/site?season=s26&act=plot';

function renderCard(over: Partial<{ hour: number; summary: ShadeAtHour | null; northDeg: number; sunDate: string | null }> = {}) {
  const onHour = vi.fn();
  render(
    <SunCard
      hour={over.hour ?? 14}
      onHour={onHour}
      summary={over.summary === undefined ? { under: 13, full: 4, partial: 4, sun: 5 } : over.summary}
      northDeg={over.northDeg ?? 0}
      plotHref={HREF}
      sunDate={over.sunDate === undefined ? '2026-06-04' : over.sunDate}
    />,
  );
  return { onHour };
}

describe('shade by hour', () => {
  it('says what is really shaded at the hour, for the gate day', () => {
    renderCard();
    expect(screen.getByText('בשעה 14:00, מתוך 13 פריטים מתחת לרשתות: 4 בצל מלא, 4 בצל חלקי, 5 בשמש')).toBeTruthy();
    expect(screen.getByText('ביום פתיחת השער, 4.6.2026, במיקום של מידברן.')).toBeTruthy();
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

  it('says the sun is down, or that nothing is under a net, rather than counting nothing', () => {
    renderCard({ hour: 7, summary: null });
    expect(screen.getByText('בשעה 07:00 השמש מתחת לאופק, ואין צל להראות.')).toBeTruthy();
  });

  it('asks for a gate day instead of guessing one, and draws no slider', () => {
    renderCard({ sunDate: null, summary: null });
    expect(screen.getByText(/עוד לא נרשם תאריך כזה/)).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('says which way north is, and links to where it is set', () => {
    renderCard({ northDeg: 90, summary: { under: 0, full: 0, partial: 0, sun: 0 } });
    expect(screen.getByText('בשעה 14:00 אין פריטים מתחת לרשתות הצל.')).toBeTruthy();
    expect(screen.getByText('למעלה במפה פונה למזרח (90°)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'שינוי בהגדרות המגרש' }).getAttribute('href')).toBe(HREF);
  });
});
