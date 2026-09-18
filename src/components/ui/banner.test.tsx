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

/**
 * The third side of A26/A28's shared gap. `Banner` assumes a form layout,
 * where the one banner on the page is found by reading down it. A screen that
 * carries several — one above a table, one above another — needs each to be a
 * landmark somebody can jump to and be told which one they landed on. A name
 * with no role names nothing, so the name brings a role with it.
 */
describe('Banner — a banner that can be found', () => {
  it('becomes a named region when it is given a name', () => {
    render(
      <Banner
        label="שמות שלא שויכו"
        headline="3 שמות מהקבצים עדיין לא שויכו לאף אחד."
      />,
    );
    expect(screen.getByRole('region', { name: 'שמות שלא שויכו' })).toBeTruthy();
  });

  it('names the live one without taking its live region away', () => {
    render(<Banner live tone="danger" label="תוצאת הקידום" headline="הקידום סורב" />);
    expect(screen.getByRole('status', { name: 'תוצאת הקידום' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'תוצאת הקידום' })).toBeNull();
  });

  it('is still a plain div with no name, so no screen gains a landmark it did not ask for', () => {
    render(<Banner headline="ייבוא לא כותב כלום עד שתאשרו." />);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
