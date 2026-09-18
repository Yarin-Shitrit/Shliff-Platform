/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Banner } from './banner';

describe('Banner', () => {
  it('reads as one sentence: headline then detail', () => {
    render(
      <Banner
        tone="info"
        headline="3 שמות מהקבצים עדיין לא שויכו לאף אחד."
        detail="המערכת לא מנחשת מי הם — מיזוג של שני אנשים אינו הפיך."
      />,
    );
    expect(screen.getByText('3 שמות מהקבצים עדיין לא שויכו לאף אחד.')).toBeTruthy();
    expect(screen.getByText(/מיזוג של שני אנשים אינו הפיך/)).toBeTruthy();
  });

  it('offers its single action as a link', () => {
    render(<Banner tone="warn" headline="יש כסף שלא שויך" action={{ label: 'לשיוך', href: '/inbox' }} />);
    expect(screen.getByRole('link', { name: 'לשיוך' }).getAttribute('href')).toBe('/inbox');
  });

  it('is not a live region on first paint', () => {
    render(<Banner headline="ייבוא לא כותב כלום עד שתאשרו." />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('becomes a status region when it reports what just happened', () => {
    render(<Banner tone="danger" live headline="הקידום סורב" />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
