/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InboxPreview } from './inbox-preview';

/**
 * The panel's own tests, separate from the page's.
 *
 * The page currently passes `total === items.length`, because the one
 * register-shaped fact it holds is a single row. So the half of the all-clear
 * rule that reads `total === 0` cannot be exercised through the page at all —
 * a mutation that dropped it would leave every page test green. It is the rule
 * that matters most (celebrating over a queue nobody has looked at), and the
 * component is where it lives, so it is tested here against the component.
 */
describe('InboxPreview', () => {
  it('celebrates when there is genuinely nothing waiting', () => {
    render(
      <InboxPreview items={[]} total={0} remainder={null} seasonName="ברן 26" href={null} />,
    );
    expect(screen.getByText('הכול מטופל')).toBeTruthy();
    expect(screen.getByText('ברן 26')).toBeTruthy();
  });

  it('does not celebrate over a queue merely because this page of it is empty', () => {
    render(
      <InboxPreview items={[]} total={12} remainder={null} seasonName="ברן 26" href="/inbox" />,
    );
    // Twelve decisions are open; none happens to be in the slice handed here.
    // `items.length === 0` alone would read that as "all clear" — the screen's
    // first lie, and the one C10 reserves all-clear against.
    expect(screen.queryByText('הכול מטופל')).toBeNull();
    expect(screen.getByText('12 החלטות')).toBeTruthy();
  });

  it('says one decision rather than one decisions', () => {
    render(
      <InboxPreview
        items={[{ id: 'a', icon: 'link', title: 'שם אחד', detail: 'פרט' }]}
        total={1}
        remainder={null}
        seasonName="ברן 26"
        href={null}
      />,
    );
    expect(screen.getByText('החלטה אחת')).toBeTruthy();
  });

  it('carries a row\'s evidence and its verb onward', () => {
    render(
      <InboxPreview
        items={[{
          id: 'a',
          icon: 'link',
          title: '״נועה ל.״',
          detail: 'הצעה: נועה לוי',
          pill: { text: 'חוסם ייבוא', tone: 'warn' },
          source: 'קופת קאמפ 2026!B14',
          action: { label: 'קשר לנועה לוי', href: '/members' },
        }]}
        total={1}
        remainder={null}
        seasonName="ברן 26"
        href={null}
      />,
    );
    // R11: the figure keeps its provenance, in mono, and the row's verb is a
    // link to where the decision is actually made.
    expect(screen.getByText('קופת קאמפ 2026!B14')).toBeTruthy();
    expect(screen.getByText('חוסם ייבוא')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'קשר לנועה לוי' }).getAttribute('href'))
      .toBe('/members');
  });

  it('offers no way into the register while there is no register to open', () => {
    render(
      <InboxPreview
        items={[{ id: 'a', icon: 'link', title: 'שם', detail: 'פרט' }]}
        total={9}
        remainder={<span>ועוד 8 פריטים</span>}
        seasonName="ברן 26"
        href={null}
      />,
    );
    expect(screen.queryByRole('link', { name: /לכל הרשימה/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'פתיחת הרשימה' })).toBeNull();
    // The remainder is still stated. What did not fit is never dropped in
    // silence just because there is nowhere yet to send the reader.
    expect(screen.getByText('ועוד 8 פריטים')).toBeTruthy();
  });
});
