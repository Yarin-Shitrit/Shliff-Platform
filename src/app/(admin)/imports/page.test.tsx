/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EMPTY_TITLES } from '@/components/ui/empty-state';

/**
 * `vi.mock` factories are hoisted above every other statement, so `vi.hoisted`
 * gives them something to close over (the convention `money/page.test.tsx`
 * documents).
 */
const { listUploads } = vi.hoisted(() => ({ listUploads: vi.fn() }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({
  requireAdmin: async () => ({ ok: true, email: 'lead@shliff.test' }),
}));
/**
 * Only `listUploads` is replaced. `uploadStatusLabel` stays the real function,
 * because the pill's word is exactly what this page is being tested for — a
 * second copy of that mapping here would let the test agree with itself about
 * the wrong word and prove nothing.
 */
vi.mock('@/lib/import/uploads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/import/uploads')>()),
  listUploads,
}));

import ImportsPage from './page';

const upload = {
  id: 'u1',
  filename: 'קופת קאמפ 2026.xlsx',
  uploadedBy: 'שירה',
  createdAt: new Date('2026-09-12T08:30:00Z'),
  status: 'parsed',
  error: null,
  sheetCount: 5,
  blockCount: 11,
  confirmedCount: 3,
  promotedRows: 52,
  openDecisions: 4,
  seasonBlockedCount: 0,
  firstOpenBlockId: 'b7',
};

beforeEach(() => listUploads.mockReset());

describe('/imports', () => {
  it('lists a file with who uploaded it and when', async () => {
    listUploads.mockResolvedValue([upload]);
    render(await ImportsPage());
    expect(screen.getByText('קופת קאמפ 2026.xlsx').tagName).toBe('BDI');
    expect(screen.getByText('שירה')).toBeTruthy();
    expect(screen.getByText('12/09/26').tagName).toBe('BDI');
  });

  /**
   * A17: each phrase is one `<bdi>`, so these queries read a single text node.
   * Split per number — `<bdi>3</bdi> מתוך <bdi>11</bdi>` — both assertions
   * fail, because `getNodeText` reads only direct text children.
   */
  it('shows how many blocks are confirmed and what a promotion produced', async () => {
    listUploads.mockResolvedValue([upload]);
    render(await ImportsPage());
    expect(screen.getByText('3 מתוך 11')).toBeTruthy();
    expect(screen.getByText('52 שורות')).toBeTruthy();
  });

  it('counts the sheets and tables it found, as two independent phrases', async () => {
    listUploads.mockResolvedValue([upload]);
    render(await ImportsPage());
    expect(screen.getByText('5 גיליונות')).toBeTruthy();
    expect(screen.getByText('11 טבלאות')).toBeTruthy();
  });

  it('says nothing was produced rather than showing a zero', async () => {
    listUploads.mockResolvedValue([{ ...upload, promotedRows: 0 }]);
    render(await ImportsPage());
    expect(screen.getByText('טרם קודם')).toBeTruthy();
    expect(screen.queryByText('0 שורות')).toBeNull();
  });

  /**
   * The kit owns the empty state's title and writes its sentence from the noun
   * (C10), so the title is asserted through the kit's own constant — this
   * screen's contribution is the noun and the destination, and those are
   * pinned literally.
   */
  it('invites an upload when no file has ever been uploaded', async () => {
    listUploads.mockResolvedValue([]);
    render(await ImportsPage());
    expect(screen.getByText(EMPTY_TITLES['nothing-yet'])).toBeTruthy();
    expect(screen.getByText('כאן יופיעו קבצים שהעליתם. עדיין לא נוספו.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /העלאת קובץ/ })[0].getAttribute('href'))
      .toBe('/upload');
  });

  /**
   * A36 was found here, in a browser: this screen called קופת קאמפ 23'-24'
   * מוכן לקידום with all ten of its tables approved and not one of its sheets
   * carrying a season. The assertion is on the screen rather than on the
   * function because the screen is where the claim was read.
   */
  it('names the open season decision instead of calling the file ready', async () => {
    listUploads.mockResolvedValue([{
      ...upload, blockCount: 10, confirmedCount: 10, promotedRows: 0,
      seasonBlockedCount: 8,
    }]);
    render(await ImportsPage());
    expect(screen.getByText('ממתין לקביעת עונה')).toBeTruthy();
    expect(screen.queryByText('מוכן לקידום')).toBeNull();
  });

  it('shows that an import failed without echoing the parser’s English', async () => {
    listUploads.mockResolvedValue([{
      ...upload, status: 'failed', blockCount: 0, confirmedCount: 0,
      promotedRows: 0, error: 'Error: zip end of central directory not found',
    }]);
    render(await ImportsPage());
    expect(screen.getByText('נכשל')).toBeTruthy();
    expect(screen.queryByText(/zip end of central/)).toBeNull();
    expect(screen.getByText(
      'לא הצלחנו לקרוא את הקובץ. ודאו שזה קובץ אקסל תקין ונסו שוב.',
    )).toBeTruthy();
  });
});
