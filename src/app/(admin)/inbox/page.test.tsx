/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { EMPTY_TITLES } from '@/components/ui/empty-state';
import type { InboxItem } from '@/lib/inbox/items';

const {
  requireAdmin, inboxItems, resolvedItems, readSnoozes, notFound,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(), inboxItems: vi.fn(), resolvedItems: vi.fn(),
  readSnoozes: vi.fn(), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/inbox/items', async (original) => ({
  ...(await original<typeof import('@/lib/inbox/items')>()),
  inboxItems,
}));
vi.mock('@/lib/inbox/resolved', () => ({
  resolvedItems, clearedToday: () => 4,
}));
vi.mock('./snooze', () => ({ readSnoozes }));
vi.mock('next/navigation', () => ({ notFound }));

import InboxPage from './page';

function nameItem(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'name:a1', kind: 'unlinked-name', title: '״נועה ל.״',
    detail: 'שם מקובץ · הצעה: נועה לוי (חזקה)', source: null,
    blocking: true, snoozedUntil: null, aliasId: 'a1', alias: 'נועה ל.',
    rowCount: 4, suggestions: [], actions: [], ...over,
  } as InboxItem;
}

function refusalItem(): InboxItem {
  return {
    id: 'refusal:b1:18:total-row', kind: 'refused-row',
    title: 'סיכום כללי!18', detail: 'שורת סה״כ היא סכום מחושב, לא תנועה',
    source: null, blocking: false, snoozedUntil: null, blockId: 'b1',
    refusal: { sheetRow: 18, reason: 'total-row', message: 'שורת סה״כ היא סכום מחושב, לא תנועה', cells: [] },
    actions: [],
  } as InboxItem;
}

async function renderPage(params: Record<string, string> = {}) {
  render(await InboxPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  notFound.mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.test' });
  readSnoozes.mockResolvedValue(new Map());
  inboxItems.mockResolvedValue([]);
  resolvedItems.mockResolvedValue([]);
});

describe('InboxPage', () => {
  it('renders nothing and runs no query for a non-admin', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(inboxItems).not.toHaveBeenCalled();
  });

  it('says it is camp-wide, because a name does not belong to a season', async () => {
    await renderPage();
    expect(screen.getByText(/הרשימה הזו חוצה שנים/)).toBeTruthy();
  });

  it('carries the three tabs, with counts on the two that have one', async () => {
    inboxItems.mockResolvedValue([nameItem(), refusalItem()]);
    await renderPage();

    const tabs = screen.getByRole('tablist');
    expect(within(tabs).getByRole('tab', { name: /ממתין להחלטה/ }).textContent).toContain('1');
    expect(within(tabs).getByRole('tab', { name: /לידיעה/ }).textContent).toContain('1');
    expect(within(tabs).getByRole('tab', { name: 'טופלו' }).textContent).not.toMatch(/\d/);
  });

  it('shows a refused total row under לידיעה, never under ממתין להחלטה', async () => {
    inboxItems.mockResolvedValue([nameItem(), refusalItem()]);

    const decide = render(await InboxPage({ searchParams: Promise.resolve({ tab: 'decide' }) }));
    expect(within(decide.container).queryByText('סיכום כללי!18')).toBeNull();
    expect(within(decide.container).getByText('״נועה ל.״')).toBeTruthy();
    decide.unmount();

    const notice = render(await InboxPage({ searchParams: Promise.resolve({ tab: 'notice' }) }));
    expect(within(notice.container).getByText('סיכום כללי!18')).toBeTruthy();
    expect(within(notice.container).queryByText('״נועה ל.״')).toBeNull();
  });

  it('marks the open item, defaulting to the first in the list', async () => {
    inboxItems.mockResolvedValue([nameItem(), nameItem({ id: 'name:a2', title: '״איתי״' })]);
    await renderPage();
    // Scoped to the rail: the kind filter's own links also carry an
    // aria-current, and an unscoped query would count those too and pass or
    // fail for a reason that has nothing to do with the open item.
    const rail = screen.getByRole('list', { name: 'פריטים לטיפול' });
    const links = within(rail).getAllByRole('link', { current: true });
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toContain('״נועה ל.״');
  });

  it('keeps the tab and the kind when it links to an item (R6)', async () => {
    inboxItems.mockResolvedValue([nameItem()]);
    await renderPage({ tab: 'decide', kind: 'names' });
    const rail = screen.getByRole('list', { name: 'פריטים לטיפול' });
    const link = within(rail).getAllByRole('link')
      .find((a) => a.textContent?.includes('״נועה ל.״'))!;
    expect(link.getAttribute('href')).toBe('/inbox?tab=decide&kind=names&item=name%3Aa1');
  });

  it('filters the rail by kind and offers the way back', async () => {
    inboxItems.mockResolvedValue([nameItem(), refusalItem()]);
    await renderPage({ tab: 'decide', kind: 'sheets' });
    expect(screen.queryByText('״נועה ל.״')).toBeNull();
    expect(screen.getByText(EMPTY_TITLES['no-matches'])).toBeTruthy();
    expect(screen.getByRole('link', { name: 'הצגת הכול' })).toBeTruthy();
  });

  it('celebrates when there is nothing to decide, and links onward', async () => {
    inboxItems.mockResolvedValue([refusalItem()]);
    await renderPage({ tab: 'decide' });
    expect(screen.getByText(EMPTY_TITLES['all-clear'])).toBeTruthy();
    expect(screen.getByRole('link', { name: /כספים/ }).getAttribute('href')).toBe('/money');
  });

  it('invites an import when there is nothing at all', async () => {
    inboxItems.mockResolvedValue([]);
    resolvedItems.mockResolvedValue([]);
    await renderPage({ tab: 'notice' });
    expect(screen.getByText(EMPTY_TITLES['nothing-yet'])).toBeTruthy();
    expect(screen.getByRole('link', { name: /העלאת קובץ/ }).getAttribute('href')).toBe('/imports');
  });

  it('shows טופלו with who decided and when, and says when a date was not kept', async () => {
    resolvedItems.mockResolvedValue([
      { id: 'name:a1', kind: 'unlinked-name', title: '״נועה ל.״', detail: 'קושר ל־נועה לוי', archetype: null, decidedBy: 'lead@shliff.test', decidedAt: new Date('2026-09-17T09:00:00Z') },
      { id: 'sheet-season:s1', kind: 'sheet-season', title: 'גיליון ״סיכום כללי״', detail: 'שויך ל־ברן 26 · נקבע — התאריך לא נשמר', archetype: null, decidedBy: null, decidedAt: null },
    ]);
    await renderPage({ tab: 'done' });
    expect(screen.getByText('קושר ל־נועה לוי')).toBeTruthy();
    expect(screen.getByText(/17\/09\/26/)).toBeTruthy();
    expect(screen.getAllByText(/התאריך לא נשמר/).length).toBeGreaterThan(0);
  });

  it('sets its own title (B8)', async () => {
    const { metadata } = await import('./page');
    expect(metadata.title).toBe('לטיפול · קופת שליף');
  });

  // The register renders refused rows, so it is the one caller that asks for
  // the dry run. Without this the page would show an empty לידיעה tab and
  // nothing would be red — the refusals simply would not be fetched.
  it('asks for the refusals it renders', async () => {
    await renderPage();
    expect(inboxItems).toHaveBeenCalledWith({}, expect.objectContaining({
      includeRefusals: true,
      recordedBy: 'lead@shliff.test',
    }));
  });

  // A33 permits ?season=all. It is not a season id, and passing it through as
  // one would send the suggester looking up a season named "all".
  it('treats ?season=all as no season rather than as a season named all', async () => {
    await renderPage({ season: 'all' });
    expect(inboxItems).toHaveBeenCalledWith({}, expect.objectContaining({ seasonId: null }));
  });
});

/**
 * A23, binding: the register may render what promotion would do and must not
 * offer to do it in bulk. The plan's file table put a promote-everything
 * button in this page's header; it does not ship, and a source scan is what
 * keeps it from being re-added by someone reading that table.
 */
describe('A23 — the page offers no bulk promotion', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/(admin)/inbox/page.tsx'), 'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('read the file it is asserting about', () => {
    expect(code).toContain('export default async function InboxPage');
  });

  it('imports no bulk-promote control and names no bulk promoter', () => {
    expect(code).not.toMatch(/BulkPromote|bulk-promote/);
    expect(code).not.toMatch(/promoteAll/);
  });
});

describe('the register page', () => {
  it('never reads a workbook from disk (E6, W16)', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/(admin)/inbox/page.tsx'), 'utf8',
    );
    expect(source).toContain('export default async function InboxPage');
    expect(source).not.toMatch(/readFileSync|node:fs|extractWorkbook|detectBlocks/);
    expect(source).not.toMatch(/reference-data/);
  });

  it('uses logical properties only (A10)', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/app/(admin)/inbox/inbox.module.css'), 'utf8',
    );
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/(^|[\s;{])(left|right)\s*:/);
    expect(css).not.toMatch(/(margin|padding|border)-(left|right)\s*:/);
  });
});
