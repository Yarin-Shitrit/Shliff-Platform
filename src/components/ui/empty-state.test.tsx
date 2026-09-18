/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState, EMPTY_TITLES, emptyStateBody } from './empty-state';

describe('emptyStateBody', () => {
  it('writes the sentence for each kind so no screen invents its own', () => {
    expect(emptyStateBody({ kind: 'nothing-yet', noun: 'תשלומים' }))
      .toBe('כאן יופיעו תשלומים. עדיין לא נוספו.');
    expect(emptyStateBody({ kind: 'nothing-this-season', noun: 'תנועות', seasonName: 'ברן 26' }))
      .toBe('אין תנועות בברן 26. בשנים אחרות ייתכן שיש.');
    expect(emptyStateBody({ kind: 'no-matches', filterSummary: 'טרם שילמו' }))
      .toBe('נסו להסיר את הסינון ״טרם שילמו״.');
    expect(emptyStateBody({ kind: 'no-matches' }))
      .toBe('נסו להסיר סינון או לשנות את החיפוש.');
    expect(emptyStateBody({ kind: 'not-permitted' }))
      .toBe('החלק הזה פתוח למנהלי הקאמפ בלבד. אם זו טעות, פנו למי שנתן לכם את הגישה.');
    expect(emptyStateBody({ kind: 'all-clear' }))
      .toBe('לא נשאר כלום לטפל בו כאן.');
  });
});

describe('EmptyState', () => {
  it('has exactly five kinds', () => {
    expect(Object.keys(EMPTY_TITLES)).toHaveLength(5);
  });

  it('renders the title as a heading and the body beneath it', () => {
    render(<EmptyState kind="nothing-yet" noun="קבצים" />);
    expect(screen.getByRole('heading', { name: 'אין כאן כלום עדיין' })).toBeTruthy();
    expect(screen.getByText('כאן יופיעו קבצים. עדיין לא נוספו.')).toBeTruthy();
  });

  it('names the season it is empty for', () => {
    render(<EmptyState kind="nothing-this-season" noun="תשלומים" seasonName="ברן 26" />);
    expect(screen.getByText('אין תשלומים בברן 26. בשנים אחרות ייתכן שיש.')).toBeTruthy();
  });

  it('invites an action when the screen offers one', () => {
    render(
      <EmptyState kind="nothing-yet" noun="קבצים" action={{ label: 'העלאת קובץ', href: '/imports' }} />,
    );
    expect(screen.getByRole('link', { name: 'העלאת קובץ' }).getAttribute('href')).toBe('/imports');
  });

  it('celebrates only in all-clear', () => {
    const { container: clear } = render(<EmptyState kind="all-clear" />);
    expect(clear.firstElementChild?.className).toContain('celebrate');
    const { container: filtered } = render(<EmptyState kind="no-matches" />);
    expect(filtered.firstElementChild?.className).not.toContain('celebrate');
  });

  it('offers no action at all when the reader may not see the content', () => {
    render(<EmptyState kind="not-permitted" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('heading', { name: 'אין לך גישה לתוכן הזה' })).toBeTruthy();
  });
});
