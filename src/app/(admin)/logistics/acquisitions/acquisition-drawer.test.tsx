/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { AcquisitionRow } from '@/lib/logistics/acquisitions';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));

const { createAcquisitionAction, updateAcquisitionAction } = vi.hoisted(() => ({
  createAcquisitionAction: vi.fn(async (): Promise<ActionResult<string>> => ({ ok: true, value: 'acq-9' })),
  updateAcquisitionAction: vi.fn(async (): Promise<ActionResult<void>> => ({ ok: true, value: undefined })),
}));
vi.mock('./actions', () => ({ createAcquisitionAction, updateAcquisitionAction }));

import { AcquisitionDrawer } from './acquisition-drawer';

const CHAIRS: AcquisitionRow = {
  seasonId: 's26', id: 'acq-1', name: 'כיסא', category: 'living', quantityNeeded: 12,
  source: 'buy_new', unitEstimateAgorot: 15000, estimatedAgorot: 180000, actualAgorot: null,
  assignee: null, lender: null, budgetLineId: null, arrivedItemId: null, workItem: null,
  status: 'to_search', updatedAt: new Date('2026-09-14T10:00:00Z'), updatedBy: null,
};

function mount(row: AcquisitionRow | null = null) {
  return render(
    <ToastProvider>
      <AcquisitionDrawer
        row={row}
        seasonId="s26"
        seasonName="ברן 26"
        people={[]}
        budgetLines={[]}
        topics={[]}
        closeHref="/logistics/acquisitions"
      />
    </ToastProvider>,
  );
}

function type(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** The line under the two amounts, or null when the drawer shows none. */
function product(): string | null {
  return screen.queryByText(/אומדן לכל הכמות/)?.textContent ?? null;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('the product of the price and the count', () => {
  it('appears as soon as both are typed, so nobody multiplies by hand', () => {
    mount();
    type(/^מה צריך/, 'כיסא');
    type(/^כמה צריך/, '12');
    type(/מחיר ליחידה/, '150');
    expect(product()).toContain('1,800 ₪');
    expect(product()).toContain('12 × 150 ₪');
  });

  it('follows the count when only the count changes', () => {
    mount();
    type(/מחיר ליחידה/, '150');
    type(/^כמה צריך/, '3');
    expect(product()).toContain('450 ₪');
    type(/^כמה צריך/, '4');
    expect(product()).toContain('600 ₪');
  });

  it('shows no total for a row nobody has priced', () => {
    // An empty price is "not priced yet". A line reading 0 ₪ would claim the
    // camp expects twelve of them for free.
    mount();
    type(/^כמה צריך/, '12');
    expect(product()).toBeNull();
  });

  it('does not multiply what was actually paid', () => {
    mount();
    type(/^כמה צריך/, '12');
    type(/בפועל/, '1700');
    expect(product()).toBeNull();
  });

  it('opens an existing row on the price of one, not on the product', () => {
    // Opening on 1,800 and saving would store 1,800 as the unit price: every
    // save would multiply the row by its own count again.
    mount(CHAIRS);
    expect((screen.getByLabelText(/מחיר ליחידה/) as HTMLInputElement).value).toBe('150');
    expect(product()).toContain('1,800 ₪');
  });

  it('saves the price of one, and leaves the multiplying to the library', async () => {
    mount();
    type(/^מה צריך/, 'כיסא');
    type(/^כמה צריך/, '12');
    type(/מחיר ליחידה/, '150');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'הוספה לרכש' }));
    });
    expect(createAcquisitionAction).toHaveBeenCalledTimes(1);
    const [input] = createAcquisitionAction.mock.calls[0] as unknown as [{ estimatedCost: string; quantityNeeded: number }];
    expect(input.estimatedCost).toBe('150');
    expect(input.quantityNeeded).toBe(12);
  });
});
