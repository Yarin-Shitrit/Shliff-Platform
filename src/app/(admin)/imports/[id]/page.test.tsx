/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { findUpload, blockStates, sheetLabels, listSeasons, promoteBlock } = vi.hoisted(() => ({
  findUpload: vi.fn(),
  blockStates: vi.fn(),
  sheetLabels: vi.fn(),
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
  blockStates, sheetLabels,
}));
vi.mock('@/lib/members/roster', () => ({ listSeasons }));
vi.mock('@/lib/import/promote/promote', () => ({ promoteBlock }));
vi.mock('./actions', () => ({
  setSeasonAction: vi.fn(), setAuthorityAction: vi.fn(),
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
});
