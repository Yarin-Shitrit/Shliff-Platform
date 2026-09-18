/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const {
  findUpload, blockStates, sheetLabels, blockGrid, listSeasons, promoteBlock,
} = vi.hoisted(() => ({
  findUpload: vi.fn(),
  blockStates: vi.fn(),
  sheetLabels: vi.fn(),
  blockGrid: vi.fn(),
  listSeasons: vi.fn(),
  promoteBlock: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({
  requireAdmin: async () => ({ ok: true, email: 'lead@shliff.test' }),
}));
vi.mock('@/lib/import/uploads', async (original) => ({
  ...(await original<typeof import('@/lib/import/uploads')>()),
  findUpload,
}));
/**
 * Only the two queries are replaced. `reviewStep` stays the real function —
 * which step the stepper sits on is exactly what this page is being tested
 * for, and a second copy of that rule here would let the test agree with
 * itself about the wrong step.
 */
vi.mock('@/lib/import/register', async (original) => ({
  ...(await original<typeof import('@/lib/import/register')>()),
  blockStates, sheetLabels, blockGrid,
}));
vi.mock('@/lib/members/roster', () => ({ listSeasons }));
vi.mock('@/lib/import/promote/promote', () => ({ promoteBlock }));
vi.mock('./actions', () => ({
  setSeasonAction: vi.fn(), setAuthorityAction: vi.fn(),
  confirmBlock: vi.fn(), confirmAndPromoteAction: vi.fn(), promoteUploadAction: vi.fn(),
}));
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ImportReviewPage from './page';

const upload = {
  id: 'u1', filename: 'קופת קאמפ 2026.xlsx', uploadedBy: 'שירה',
  createdAt: new Date('2026-09-12T08:30:00Z'), status: 'parsed', error: null,
};

const sheet = {
  sheetId: 's1', name: 'סיכום כללי', index: 0, rowCount: 61, colCount: 8,
  seasonId: 'y26', seasonName: 'ברן 26', authoritative: null,
  state: 'eligible' as const, contestedWith: [],
};

const block = (over: Record<string, unknown> = {}) => ({
  blockId: 'b1', sheetId: 's1', sheetName: 'סיכום כללי', uploadId: 'u1',
  archetype: 'ledger', confidence: 0.9, top: 3, left: 1, bottom: 61, right: 8,
  range: 'A3:H61', rowCount: 59, headerRow: 3,
  columnMap: [{ column: 1, field: 'date', confidence: 1 }],
  mappingSource: 'rules', budgetCategory: null, confirmedBy: null,
  confirmedAt: null, promotedRows: 0, state: 'recognised', ...over,
});

const emptyRun = {
  blockId: 'b1', archetype: 'ledger', dryRun: true,
  written: [], refused: [], deleted: 0, retained: [],
};

/** Three sheet rows: the workbook's header, one row that writes, one refused. */
const GRID = [['תאריך', 'פירוט'], ['05/07/26', 'גנרטור'], ['', 'סה״כ']];

const oneOfEach = {
  ...emptyRun,
  written: [{ table: 'ledger_entries', sheetRow: 4, id: null, summary: 'גנרטור', notes: [] }],
  refused: [{ sheetRow: 5, reason: 'total-row', cells: [],
    message: 'שורת סה״כ היא סכום מחושב, לא תנועה' }],
};

function open(search: Record<string, string> = {}) {
  return ImportReviewPage({
    params: Promise.resolve({ id: 'u1' }),
    searchParams: Promise.resolve(search),
  });
}

beforeEach(() => {
  findUpload.mockReset().mockResolvedValue(upload);
  blockStates.mockReset();
  sheetLabels.mockReset().mockResolvedValue([sheet]);
  blockGrid.mockReset().mockResolvedValue(GRID);
  listSeasons.mockReset().mockResolvedValue([{ id: 'y26', name: 'ברן 26', year: 2026 }]);
  promoteBlock.mockReset().mockResolvedValue(emptyRun);
});

describe('/imports/[id]', () => {
  it('opens the first block still needing a human when none is named', async () => {
    blockStates.mockResolvedValue([
      block({ blockId: 'b1', state: 'promoted' }),
      block({ blockId: 'b2', state: 'needs-review' }),
    ]);
    render(await open());
    expect(screen.getByRole('link', { current: 'page' }).getAttribute('href'))
      .toBe('/imports/u1?block=b2');
  });

  it('opens the block the URL names, so a review position can be sent on', async () => {
    blockStates.mockResolvedValue([
      block({ blockId: 'b1', state: 'promoted' }),
      block({ blockId: 'b2', state: 'needs-review' }),
    ]);
    render(await open({ block: 'b1' }));
    expect(screen.getByRole('link', { current: 'page' }).getAttribute('href'))
      .toBe('/imports/u1?block=b1');
  });

  it('falls back to the first block when nothing needs a human', async () => {
    blockStates.mockResolvedValue([block({ blockId: 'b1', state: 'promoted' })]);
    render(await open());
    expect(screen.getByRole('link', { current: 'page' }).getAttribute('href'))
      .toBe('/imports/u1?block=b1');
  });

  /**
   * The one thing on this page that must not scale with the block count. The
   * rail's states are queries; the refusals and the pre-flight counts are the
   * only thing that genuinely needs the promoter asked, and asking it for
   * eleven blocks to render one would be eleven transactions to show one
   * answer.
   */
  it('asks the promoter once, about the block that is open, and never writes', async () => {
    blockStates.mockResolvedValue([
      block({ blockId: 'b1', state: 'promoted' }),
      block({ blockId: 'b2', state: 'needs-review' }),
      block({ blockId: 'b3', state: 'needs-review' }),
    ]);
    render(await open());
    expect(promoteBlock).toHaveBeenCalledTimes(1);
    expect(promoteBlock).toHaveBeenCalledWith({}, 'b2', {
      dryRun: true, recordedBy: 'lead@shliff.test',
    });
  });

  it('says a re-uploaded file opened its existing review', async () => {
    blockStates.mockResolvedValue([block()]);
    render(await open({ duplicate: '1' }));
    expect(screen.getByText(
      'הקובץ הזה כבר הועלה — זו הסקירה הקיימת שלו, ולא נוצר עותק שני.',
    )).toBeTruthy();
  });

  it('does not say that on an ordinary visit', async () => {
    blockStates.mockResolvedValue([block()]);
    render(await open());
    expect(screen.queryByText(/כבר הועלה/)).toBeNull();
  });

  /**
   * The step is derived from the upload's status and its blocks' states,
   * never stored, so it cannot be stale at the moment a lead looks at it.
   */
  it('stands the stepper on the step the file is actually at', async () => {
    blockStates.mockResolvedValue([
      block({ blockId: 'b1', state: 'promoted', confirmedAt: new Date() }),
      block({ blockId: 'b2', state: 'needs-review' }),
    ]);
    render(await open());
    expect(screen.getByRole('listitem', { current: 'step' }).textContent)
      .toContain('סקירה ואישור');
    expect(screen.getByText('אושרו 1 מתוך 2')).toBeTruthy();
  });

  it('stops at זיהוי טבלאות when the workbook held no table', async () => {
    blockStates.mockResolvedValue([]);
    render(await open());
    expect(screen.getByRole('listitem', { current: 'step' }).textContent)
      .toContain('זיהוי טבלאות');
  });

  it('invites a new upload when the workbook held no table at all', async () => {
    blockStates.mockResolvedValue([]);
    render(await open());
    expect(screen.getByText('לא נמצאו טבלאות בקובץ הזה')).toBeTruthy();
    expect(screen.getByRole('link', { name: /העלאת קובץ אחר/ }).getAttribute('href'))
      .toBe('/upload');
    expect(promoteBlock).not.toHaveBeenCalled();
  });

  it('numbers the open block’s place among the file’s tables', async () => {
    blockStates.mockResolvedValue([
      block({ blockId: 'b1', state: 'promoted' }),
      block({ blockId: 'b2', state: 'needs-review' }),
      block({ blockId: 'b3', state: 'needs-review' }),
    ]);
    render(await open({ block: 'b2' }));
    expect(screen.getByText('2 מתוך 3')).toBeTruthy();
  });

  /**
   * Scoped to the grid, because the same cell text is also a sample in the
   * column table above it — an unscoped query matches both and throws, and an
   * `getAllBy` would pass with no filtering at all.
   */
  const grid = () => within(screen.getByRole('table', { name: 'הטבלה כפי שהיא בגיליון' }));

  /**
   * The grid's filter is a URL, and the page is what reads it. Without this
   * the segmented control would change the address and nothing else.
   */
  it('renders the grid through the filter the URL names', async () => {
    blockStates.mockResolvedValue([block()]);
    promoteBlock.mockResolvedValue(oneOfEach);
    render(await open({ rows: 'refused' }));
    expect(grid().getByText('סה״כ')).toBeTruthy();
    expect(grid().queryByText('גנרטור')).toBeNull();
    expect(screen.getByText('לא נכתב: שורת סה״כ היא סכום מחושב, לא תנועה')).toBeTruthy();
  });

  it('shows every row when the URL names no filter', async () => {
    blockStates.mockResolvedValue([block()]);
    promoteBlock.mockResolvedValue(oneOfEach);
    render(await open());
    expect(grid().getByText('גנרטור')).toBeTruthy();
    expect(grid().getByText('סה״כ')).toBeTruthy();
  });

  it('ignores a filter the URL invents rather than emptying the grid', async () => {
    blockStates.mockResolvedValue([block()]);
    promoteBlock.mockResolvedValue(oneOfEach);
    render(await open({ rows: 'nonsense' }));
    expect(grid().getByText('גנרטור')).toBeTruthy();
    expect(grid().getByText('סה״כ')).toBeTruthy();
  });

  /**
   * A23: a control scoped to one file is permitted; one that reaches the whole
   * database is not. The count names what it is about to write.
   */
  it('offers to promote the confirmed tables of this file, and names how many', async () => {
    blockStates.mockResolvedValue([
      block({ blockId: 'b1', state: 'confirmed', confirmedAt: new Date() }),
      block({ blockId: 'b2', state: 'confirmed', confirmedAt: new Date() }),
      block({ blockId: 'b3', state: 'needs-review' }),
    ]);
    render(await open());
    expect(screen.getByRole('button', { name: 'קידום 2 טבלאות מאושרות' })).toBeTruthy();
  });

  /**
   * A34: the count is the set the action touches, and the action leaves an
   * already-promoted table alone — re-promoting a block whose rows something
   * references keeps the old rows and writes new ones. One confirmed table
   * beside one promoted table reads 1, and the promoted one is still
   * promotable on its own from the review screen.
   */
  it('leaves an already-promoted table out of the count, and out of the action', async () => {
    blockStates.mockResolvedValue([
      block({ blockId: 'b1', state: 'confirmed', confirmedAt: new Date() }),
      block({ blockId: 'b2', state: 'promoted', confirmedAt: new Date(), promotedRows: 52 }),
      block({ blockId: 'b3', state: 'needs-review' }),
    ]);
    render(await open());
    expect(screen.getByRole('button', { name: 'קידום 1 טבלאות מאושרות' })).toBeTruthy();
  });

  it('offers no bulk promotion while nothing is confirmed', async () => {
    blockStates.mockResolvedValue([block({ state: 'needs-review' })]);
    render(await open());
    expect(screen.queryByRole('button', { name: /טבלאות מאושרות/ })).toBeNull();
  });
});
