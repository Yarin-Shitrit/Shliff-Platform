/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/members',
  useSearchParams: () => new URLSearchParams('season=s-9f2&view=season'),
}));

import { FilterBar } from './filter-bar';

const base = {
  searchValue: '',
  searchLabel: 'חיפוש אנשים',
  searchPlaceholder: 'חיפוש לפי שם או כינוי',
  chips: [
    { id: 'season', label: 'שנה', value: 'ברן 26', clearHref: '/members' },
    { id: 'state', label: 'מצב תשלום', value: 'הכול',
      options: [{ id: 'unpaid', label: 'טרם שילמו', href: '/members?state=unpaid' }] },
  ],
  rowCount: 35,
};

describe('FilterBar', () => {
  beforeEach(() => { replace.mockClear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('names its search box and shows the placeholder', () => {
    render(<FilterBar {...base} />);
    const box = screen.getByLabelText('חיפוש אנשים');
    expect(box.getAttribute('placeholder')).toBe('חיפוש לפי שם או כינוי');
  });

  it('writes the search into the URL once, after the typing stops', () => {
    render(<FilterBar {...base} />);
    const box = screen.getByLabelText('חיפוש אנשים');
    fireEvent.change(box, { target: { value: 'רו' } });
    fireEvent.change(box, { target: { value: 'רונ' } });
    fireEvent.change(box, { target: { value: 'רוני' } });
    expect(replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(replace).toHaveBeenCalledTimes(1);
    const [href] = replace.mock.calls[0] as [string];
    const url = new URL(href, 'https://example.test');
    expect(url.pathname).toBe('/members');
    expect(url.searchParams.get('q')).toBe('רוני');
    expect(url.searchParams.get('season')).toBe('s-9f2');
  });

  it('drops an emptied search from the URL rather than writing q=', () => {
    render(<FilterBar {...base} searchValue="רוני" />);
    fireEvent.change(screen.getByLabelText('חיפוש אנשים'), { target: { value: '' } });
    vi.advanceTimersByTime(250);
    const [href] = replace.mock.calls[0] as [string];
    expect(new URL(href, 'https://example.test').searchParams.has('q')).toBe(false);
  });

  it('shows each chip with its value, per C3', () => {
    render(<FilterBar {...base} />);
    expect(screen.getByText('ברן 26')).toBeTruthy();
    expect(screen.getByText('הכול')).toBeTruthy();
  });

  it('offers a link that removes a filter', () => {
    render(<FilterBar {...base} />);
    expect(screen.getByRole('link', { name: 'הסרת הסינון שנה' }).getAttribute('href'))
      .toBe('/members');
  });

  it('offers a dashed add-filter chip when there is something to add', () => {
    render(
      <FilterBar {...base} addFilter={{ options: [{ id: 'role', label: 'תפקיד', href: '/members?role=lead' }] }} />,
    );
    expect(screen.getByRole('button', { name: 'סינון' })).toBeTruthy();
  });

  it('reports the row count the server counted', () => {
    render(<FilterBar {...base} rowCount={35} />);
    expect(screen.getByText(/35/).textContent).toContain('שורות');
  });
});
