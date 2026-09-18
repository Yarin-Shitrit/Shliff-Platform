/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SavedViews } from './saved-views';

const views = [
  { id: 'all', label: 'כולם', count: 38, href: '/members' },
  { id: 'season', label: 'ברן 26', count: 35, href: '/members?view=season' },
  { id: 'unpaid', label: 'טרם שילמו', count: 0, href: '/members?view=unpaid' },
];

describe('SavedViews', () => {
  it('is a named tab strip of links', () => {
    render(<SavedViews label="תצוגות שמורות" views={views} currentId="season" />);
    expect(screen.getByRole('tablist', { name: 'תצוגות שמורות' })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('marks exactly one view as selected', () => {
    render(<SavedViews label="תצוגות שמורות" views={views} currentId="season" />);
    const selected = screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('ברן 26');
  });

  it('keeps each view addressable, so a lead can send one', () => {
    render(<SavedViews label="תצוגות שמורות" views={views} currentId="all" />);
    expect(screen.getByRole('tab', { name: /טרם שילמו/ }).getAttribute('href'))
      .toBe('/members?view=unpaid');
  });

  it('shows a zero count, because zero unpaid is the best news on the page', () => {
    render(<SavedViews label="תצוגות שמורות" views={views} currentId="all" />);
    expect(screen.getByRole('tab', { name: /טרם שילמו/ }).textContent).toContain('0');
  });

  it('offers a way to save a new view when the screen has one', () => {
    render(
      <SavedViews label="תצוגות שמורות" views={views} currentId="all" newHref="/members?view=new" />,
    );
    expect(screen.getByRole('link', { name: 'תצוגה שמורה חדשה' }).getAttribute('href'))
      .toBe('/members?view=new');
  });

  it('offers nothing to save when the screen has no way to', () => {
    render(<SavedViews label="תצוגות שמורות" views={views} currentId="all" />);
    expect(screen.queryByRole('link', { name: 'תצוגה שמורה חדשה' })).toBeNull();
  });
});
