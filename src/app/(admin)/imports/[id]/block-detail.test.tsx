/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BlockStateRow } from '@/lib/import/register';
import type { ColumnRow } from '@/lib/import/review';

const confirmAndPromote = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('./actions', () => ({
  confirmBlock: vi.fn(),
  confirmAndPromoteAction: (...args: unknown[]) => confirmAndPromote(...args),
}));

import { BlockDetail } from './block-detail';

const block: BlockStateRow = {
  blockId: 'b1', sheetId: 's1', sheetName: 'סיכום כללי', uploadId: 'u1',
  archetype: 'ledger', confidence: 0.9,
  top: 3, left: 1, bottom: 61, right: 8, range: 'A3:H61', rowCount: 59,
  headerRow: 3,
  columnMap: [{ column: 1, field: 'date', confidence: 1 }],
  mappingSource: 'rules', budgetCategory: null,
  confirmedBy: null, confirmedAt: null, promotedRows: 0, state: 'needs-review',
};

const columns: ColumnRow[] = [
  { column: 1, label: 'A', header: 'תאריך', samples: ['05/07/26'],
    field: 'date', confidence: 1 },
];

const preflight = {
  blocks: 1, written: 52, noted: 2, refused: 7, deleted: 0, retained: 0,
};

function renderDetail(over: Partial<React.ComponentProps<typeof BlockDetail>> = {}) {
  return render(
    <BlockDetail
      uploadId="u1"
      block={block}
      columns={columns}
      preflight={preflight}
      refusal={null}
      grid={<div>הטבלה כפי שהיא</div>}
      position={2}
      total={11}
      prevId="b0"
      nextId="b2"
      skipBlockId="b3"
      confirmedBy={null}
      confirmedOn={null}
      {...over}
    />,
  );
}

beforeEach(() => {
  confirmAndPromote.mockReset().mockResolvedValue({
    ok: true, summary: preflight, nextBlockId: null,
  });
});

describe('BlockDetail', () => {
  /** W3/R11: the sheet's own name for the range, as a trace renders it. */
  it('names the block and where it sits in the workbook', () => {
    renderDetail();
    expect(screen.getByRole('heading', { name: 'תנועות קופה' })).toBeTruthy();
    expect(screen.getByText('סיכום כללי!A3:H61').tagName).toBe('BDI');
  });

  /** A17: one isolate for the whole phrase, so the query reads one node. */
  it('says where in the file this block is, and offers its neighbours', () => {
    renderDetail();
    expect(screen.getByText('2 מתוך 11')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'הטבלה הקודמת' }).getAttribute('href'))
      .toBe('/imports/u1?block=b0');
    expect(screen.getByRole('link', { name: 'הטבלה הבאה' }).getAttribute('href'))
      .toBe('/imports/u1?block=b2');
  });

  /**
   * Carried over from the card this pane replaces. Who approved a block and
   * when is its provenance, and the date is formatted on the server: a
   * locale-sensitive formatter rendered one way on the server and another in
   * the browser that hydrated it, which is why no `Date` reaches this tree.
   */
  it('says who approved the block and when, each as its own isolate', () => {
    renderDetail({ confirmedBy: 'lead@shliff.test', confirmedOn: '12/09/26' });
    expect(screen.getByText('lead@shliff.test').tagName).toBe('BDI');
    expect(screen.getByText('12/09/26').tagName).toBe('BDI');
  });

  it('says nothing about approval on a block nobody has approved', () => {
    renderDetail();
    expect(screen.queryByText(/אושר ע״י/)).toBeNull();
  });

  it('says when the layout was recognised from a previous year', () => {
    renderDetail({ block: { ...block, mappingSource: 'signature' } });
    expect(screen.getByText('זוהה מפריסה מוכרת משנה שעברה')).toBeTruthy();
  });

  /**
   * A refusal about the whole block is filed at the block's own top row, which
   * is usually the header — rendering it in the grid would either tint the
   * header or vanish behind it. It belongs above the table.
   */
  it('puts a whole-block refusal above the table rather than inside it', () => {
    renderDetail({
      refusal: {
        sheetRow: 3, reason: 'unconfirmed', cells: [],
        message: 'הטבלה לא אושרה, ולכן אף שורה לא נכתבה',
      },
    });
    expect(screen.getByText('הטבלה לא אושרה, ולכן אף שורה לא נכתבה')).toBeTruthy();
  });

  it('renders the grid it was handed, rather than building one of its own', () => {
    renderDetail();
    expect(screen.getByText('הטבלה כפי שהיא')).toBeTruthy();
  });

  it('asks which budget only where the question applies', () => {
    renderDetail();
    expect(screen.queryByLabelText('התקציב שהשורות נכתבות אליו')).toBeNull();

    renderDetail({ block: { ...block, archetype: 'budget_lines' } });
    expect(screen.getByLabelText('התקציב שהשורות נכתבות אליו')).toBeTruthy();
  });

  /**
   * The moment the draft stops describing the counts, the counts go. This is
   * the whole reason the draft is lifted to this component rather than kept
   * inside the column table.
   */
  it('drops the pre-flight counts as soon as the column map is edited', () => {
    renderDetail();
    expect(screen.getByRole('button', { name: 'אישור וקידום 52 שורות' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('השדה של עמודה A'), {
      target: { value: 'description' },
    });

    expect(screen.getByRole('button', { name: 'אישור וקידום' })).toBeTruthy();
    expect(screen.getByText('הספירה תתעדכן אחרי השמירה')).toBeTruthy();
  });

  /**
   * The budget category changes which budget the rows belong to, not how many
   * there are, so the counts still describe what would be written.
   */
  it('keeps the counts when only the budget is chosen', () => {
    renderDetail({ block: { ...block, archetype: 'budget_lines' } });
    fireEvent.change(screen.getByLabelText('התקציב שהשורות נכתבות אליו'), {
      target: { value: 'dancefloor' },
    });
    expect(screen.getByRole('button', { name: 'אישור וקידום 52 שורות' })).toBeTruthy();
  });

  it('sends the edited map and the chosen budget in one confirmation', async () => {
    renderDetail({ block: { ...block, archetype: 'budget_lines' } });
    fireEvent.change(screen.getByLabelText('התקציב שהשורות נכתבות אליו'), {
      target: { value: 'dancefloor' },
    });
    fireEvent.click(screen.getByRole('button', { name: /אישור וקידום/ }));

    await waitFor(() => expect(confirmAndPromote).toHaveBeenCalledWith(
      'b1', 'budget_lines', [{ column: 1, field: 'date', confidence: 1 }], 'dancefloor',
    ));
  });

  /**
   * The button confirms before it promotes, so a refusal that says "not
   * approved yet" is one this very press clears — and the zeros beside it
   * describe a world the press ends. Every other whole-block refusal survives
   * the press, so its zeros are true and stay.
   */
  it('promises no count for a table this button is about to approve', () => {
    renderDetail({
      preflight: { blocks: 1, written: 0, noted: 0, refused: 1, deleted: 0, retained: 0 },
      refusal: {
        sheetRow: 3, reason: 'unconfirmed', cells: [],
        message: 'הבלוק עדיין לא אושר',
      },
    });
    expect(screen.getByRole('button', { name: 'אישור וקידום' })).toBeTruthy();
    expect(screen.getByText('הספירה תופיע אחרי האישור')).toBeTruthy();
  });

  it('keeps the count for a refusal the button cannot clear', () => {
    renderDetail({
      preflight: { blocks: 1, written: 0, noted: 0, refused: 1, deleted: 0, retained: 0 },
      refusal: {
        sheetRow: 3, reason: 'no-promoter', cells: [],
        message: 'המערכת עדיין לא יודעת להכניס טבלה מסוג זה — היא נשמרת לעיון בלבד',
      },
    });
    expect(screen.getByText('ייכתבו 0 שורות')).toBeTruthy();
  });
});
