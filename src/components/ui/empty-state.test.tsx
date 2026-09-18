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
  it('has one kind per situation, and no generic door', () => {
    expect(Object.keys(EMPTY_TITLES).sort()).toEqual([
      'all-clear', 'none-of-this-kind', 'no-matches', 'not-permitted',
      'nothing-this-season', 'nothing-yet',
    ].sort());
  });

  // The `emptyStateBody` suite above already pins the exact sentence for
  // every kind. Re-typing those same Hebrew sentences here would duplicate
  // that check rather than add one, so these assert wiring instead — that
  // whatever `emptyStateBody` computes for the given props is what actually
  // reaches the screen — and get the expected string from the function
  // under test above, not from a second hand-typed copy.
  it('renders the title as a heading and the body beneath it', () => {
    render(<EmptyState kind="nothing-yet" noun="קבצים" />);
    expect(screen.getByRole('heading', { name: 'אין כאן כלום עדיין' })).toBeTruthy();
    expect(screen.getByText(emptyStateBody({ kind: 'nothing-yet', noun: 'קבצים' }))).toBeTruthy();
  });

  it('names the season it is empty for', () => {
    render(<EmptyState kind="nothing-this-season" noun="תשלומים" seasonName="ברן 26" />);
    expect(
      screen.getByText(
        emptyStateBody({ kind: 'nothing-this-season', noun: 'תשלומים', seasonName: 'ברן 26' }),
      ),
    ).toBeTruthy();
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

/**
 * Reported twice by the imports lane: a workbook that parsed and holds no
 * tables, and a filter under which nothing was refused. Neither is
 * `nothing-yet` — something was added, and it was read — and neither is
 * `no-matches`, which tells a reader to go and remove a filter they may not
 * have set. The whole point of C10's union is that the wrong kind sends a
 * lead hunting for something that is not there.
 */
describe('EmptyState — we looked, and there is none of this kind here', () => {
  it('writes its own sentence from a noun, like every other kind (C10)', () => {
    expect(emptyStateBody({ kind: 'none-of-this-kind', noun: 'טבלאות' }))
      .toBe('נבדק הכול — אין כאן טבלאות.');
    expect(emptyStateBody({ kind: 'none-of-this-kind', noun: 'שורות שסורבו' }))
      .toBe('נבדק הכול — אין כאן שורות שסורבו.');
  });

  it('says something was looked at, which nothing-yet does not', () => {
    render(<EmptyState kind="none-of-this-kind" noun="טבלאות" />);
    expect(screen.getByRole('heading', { name: 'אין כאן כלום מהסוג הזה' })).toBeTruthy();
    expect(screen.getByText('נבדק הכול — אין כאן טבלאות.')).toBeTruthy();
  });

  it('is distinguishable from the two kinds it is not', () => {
    const titles = new Set([
      EMPTY_TITLES['none-of-this-kind'],
      EMPTY_TITLES['nothing-yet'],
      EMPTY_TITLES['no-matches'],
    ]);
    expect(titles.size).toBe(3);
  });

  it('does not celebrate, and takes the invitation a screen offers', () => {
    const { container } = render(
      <EmptyState kind="none-of-this-kind" noun="טבלאות" action={{ label: 'חזרה לקובץ', href: '/imports/1' }} />,
    );
    expect(container.firstElementChild?.className).not.toContain('celebrate');
    expect(screen.getByRole('link', { name: 'חזרה לקובץ' }).getAttribute('href')).toBe('/imports/1');
  });
});

describe('EmptyState — the additive guarantee', () => {
  /**
   * The net under the concurrent screen lanes: recorded against the
   * implementation as it stood before `none-of-this-kind` existed, from every
   * kind a screen could already pass. If a later change alters what those
   * screens render, this fails and nothing else has to notice.
   */
  it('renders the five original kinds byte for byte', () => {
    const { container } = render(
      <>
        <EmptyState kind="nothing-yet" noun="קבצים" action={{ label: 'העלאת קובץ', href: '/imports' }} />
        <EmptyState kind="nothing-this-season" noun="תשלומים" seasonName="ברן 26" />
        <EmptyState kind="no-matches" filterSummary="טרם שילמו" />
        <EmptyState kind="no-matches" />
        <EmptyState kind="not-permitted" />
        <EmptyState kind="all-clear" />
      </>,
    );
    expect(container.innerHTML).toMatchInlineSnapshot(`"<div class="_empty_e053fc"><span class="_icon_e053fc"><svg class="_icon_098686" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg></span><h3 class="_title_e053fc">אין כאן כלום עדיין</h3><p class="_body_e053fc">כאן יופיעו קבצים. עדיין לא נוספו.</p><a class="_btn_852a75 _primary_852a75 _sm_852a75" href="/imports">העלאת קובץ</a></div><div class="_empty_e053fc"><span class="_icon_e053fc"><svg class="_icon_098686" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h18"></path></svg></span><h3 class="_title_e053fc">אין כאן כלום לשנה הזו</h3><p class="_body_e053fc">אין תשלומים בברן 26. בשנים אחרות ייתכן שיש.</p></div><div class="_empty_e053fc"><span class="_icon_e053fc"><svg class="_icon_098686" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M7 12h10"></path><path d="M10 18h4"></path></svg></span><h3 class="_title_e053fc">אין תוצאות לסינון הזה</h3><p class="_body_e053fc">נסו להסיר את הסינון ״טרם שילמו״.</p></div><div class="_empty_e053fc"><span class="_icon_e053fc"><svg class="_icon_098686" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M7 12h10"></path><path d="M10 18h4"></path></svg></span><h3 class="_title_e053fc">אין תוצאות לסינון הזה</h3><p class="_body_e053fc">נסו להסיר סינון או לשנות את החיפוש.</p></div><div class="_empty_e053fc"><span class="_icon_e053fc"><svg class="_icon_098686" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="m4.9 4.9 14.2 14.2"></path></svg></span><h3 class="_title_e053fc">אין לך גישה לתוכן הזה</h3><p class="_body_e053fc">החלק הזה פתוח למנהלי הקאמפ בלבד. אם זו טעות, פנו למי שנתן לכם את הגישה.</p></div><div class="_empty_e053fc _celebrate_e053fc"><span class="_icon_e053fc"><svg class="_icon_098686" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg></span><h3 class="_title_e053fc">הכול מטופל</h3><p class="_body_e053fc">לא נשאר כלום לטפל בו כאן.</p></div>"`);
  });
});
