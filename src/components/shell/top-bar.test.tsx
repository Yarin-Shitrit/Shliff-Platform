/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopBar, SeasonChip, ScopeChip } from '@/components/shell/top-bar';

describe('TopBar', () => {
  it('shows a single crumb as the place you are, not as a link', () => {
    render(<TopBar crumbs={[{ label: 'דמי קאמפ' }]} />);
    const here = screen.getByText('דמי קאמפ');
    expect(here.getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('links every crumb but the last', () => {
    render(<TopBar crumbs={[{ label: 'אנשים', href: '/members' }, { label: 'רוני אדלר' }]} />);
    expect(screen.getByRole('link', { name: 'אנשים' }).getAttribute('href')).toBe('/members');
    expect(screen.getByText('רוני אדלר').getAttribute('aria-current')).toBe('page');
  });

  it('labels the trail so a screen reader can skip it', () => {
    render(<TopBar crumbs={[{ label: 'משימות' }]} />);
    expect(screen.getByRole('navigation', { name: 'מיקום' })).toBeTruthy();
  });

  it('shows the season chip the page hands it', () => {
    render(<TopBar crumbs={[{ label: 'אנשים' }]} chip={<SeasonChip seasonName="ברן 26" />} />);
    expect(screen.getByText('ברן 26')).toBeTruthy();
  });

  it('shows the page actions the page hands it', () => {
    render(
      <TopBar crumbs={[{ label: 'אנשים' }]} actions={<button type="button">אדם חדש</button>} />,
    );
    expect(screen.getByRole('button', { name: 'אדם חדש' })).toBeTruthy();
  });

  it('carries no chip and no actions when a page gives none', () => {
    render(<TopBar crumbs={[{ label: 'לטיפול' }]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a non-season scope chip with its own icon and text', () => {
    render(
      <TopBar
        crumbs={[{ label: 'משימות' }]}
        chip={<ScopeChip icon="tasks">כיסוי 82%</ScopeChip>}
      />,
    );
    expect(screen.getByText('כיסוי 82%')).toBeTruthy();
  });
});
