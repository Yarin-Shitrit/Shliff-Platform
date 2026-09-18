/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileRowMenu } from './file-row-menu';

describe('FileRowMenu', () => {
  it('opens the review at the first block still needing a human', () => {
    render(<FileRowMenu uploadId="u1" firstOpenBlockId="b7" openDecisions={3} />);
    const link = screen.getByRole('link', { name: 'המשך סקירה' });
    expect(link.getAttribute('href')).toBe('/imports/u1?block=b7');
  });

  it('always offers the review itself', () => {
    render(<FileRowMenu uploadId="u1" firstOpenBlockId={null} openDecisions={0} />);
    expect(screen.getByRole('link', { name: 'פתיחת הסקירה' }).getAttribute('href'))
      .toBe('/imports/u1');
  });

  it('drops המשך סקירה when there is nothing left to continue', () => {
    render(<FileRowMenu uploadId="u1" firstOpenBlockId={null} openDecisions={0} />);
    expect(screen.queryByRole('link', { name: 'המשך סקירה' })).toBeNull();
  });

  /**
   * A17: the count and its words are one `<bdi>`, so the accessible name is a
   * single readable phrase. Split into `<bdi>3</bdi> החלטות…` this query fails,
   * because `getByRole`'s name match and `getNodeText` both read direct text
   * children — and the cheap fix then is to weaken the query, which is how a
   * test stops checking the thing the phrase exists to say.
   */
  it('sends open decisions to לטיפול, where the same query puts them', () => {
    render(<FileRowMenu uploadId="u1" firstOpenBlockId="b7" openDecisions={3} />);
    const link = screen.getByRole('link', { name: '3 החלטות פתוחות — לטיפול' });
    expect(link.getAttribute('href')).toBe('/inbox');
  });

  it('drops the לטיפול link when nothing is open', () => {
    render(<FileRowMenu uploadId="u1" firstOpenBlockId={null} openDecisions={0} />);
    expect(screen.queryByRole('link', { name: /לטיפול/ })).toBeNull();
  });

  it('labels the icon-only trigger', () => {
    render(<FileRowMenu uploadId="u1" firstOpenBlockId={null} openDecisions={0} />);
    expect(screen.getByLabelText('פעולות על הקובץ')).toBeTruthy();
  });
});
