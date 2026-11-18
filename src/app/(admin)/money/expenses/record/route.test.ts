import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AdminCheck } from '@/lib/auth/guard';
import type { Storage } from '@/lib/storage';
import { HebrewRefusal } from '@/lib/errors/hebrew';
import { EXPENSE_REFUSALS, RECORD_REFUSALS } from '@/lib/money/expense-refusals';
import { MAX_RECEIPT_BYTES } from '@/lib/money/receipt-file';

const { adminRef, storageRef, recordExpense, requireAdmin, revalidatePath } = vi.hoisted(() => ({
  adminRef: { current: { ok: true, email: 'buyer@example.com', level: 'edit' } as AdminCheck },
  storageRef: { current: null as Storage | null },
  recordExpense: vi.fn(),
  requireAdmin: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/storage', () => ({ getStorage: () => storageRef.current! }));
vi.mock('@/lib/money/expenses', () => ({ recordExpense }));

import { POST } from './route';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function fields(over: Record<string, string> = {}): FormData {
  const form = new FormData();
  const values = {
    amount: '184.50', description: 'קרח ומים', category: 'food',
    accountId: 'a1', seasonId: 's1', occurredOn: '2026-11-18', ...over,
  };
  for (const [name, value] of Object.entries(values)) form.set(name, value);
  return form;
}

function withPhoto(form: FormData, bytes: Uint8Array = JPEG): FormData {
  form.set('receipt', new File([Buffer.from(bytes)], 'IMG_0412.HEIC', { type: 'image/heic' }));
  return form;
}

const send = (body: FormData, headers: Record<string, string> = {}) =>
  POST(new Request('http://localhost/money/expenses/record', { method: 'POST', body, headers }));

let put: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  adminRef.current = { ok: true, email: 'buyer@example.com', level: 'edit' };
  requireAdmin.mockImplementation(async () => adminRef.current);
  put = vi.fn(async (key: string) => key);
  storageRef.current = { put: put as unknown as Storage['put'], get: vi.fn() };
  recordExpense.mockResolvedValue('e1');
});

describe('POST /money/expenses/record', () => {
  it('asks for the right to edit the expenses page, and nothing wider', async () => {
    await send(fields());
    expect(requireAdmin).toHaveBeenCalledWith('expenses', 'edit');
    expect(requireAdmin).toHaveBeenCalledTimes(1);
  });

  it('refuses without that right, in Hebrew, and touches neither storage nor the ledger', async () => {
    adminRef.current = { ok: false };
    const response = await send(withPhoto(fields()));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: RECORD_REFUSALS.unauthorized });
    expect(put).not.toHaveBeenCalled();
    expect(recordExpense).not.toHaveBeenCalled();
  });

  it('records an expense with no photo, taking who recorded it from the session', async () => {
    const form = fields();
    form.set('recordedBy', 'somebody-else@example.com');
    const response = await send(form);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(put).not.toHaveBeenCalled();
    expect(recordExpense).toHaveBeenCalledWith({}, {
      occurredOn: new Date('2026-11-18'), amount: 184.5, description: 'קרח ומים',
      accountId: 'a1', seasonId: 's1', category: 'food', receiptKey: undefined,
      recordedBy: 'buyer@example.com',
    });
    expect(revalidatePath.mock.calls.map(([path]) => path))
      .toEqual(['/money/expenses', '/money/ledger', '/money']);
  });

  it('reads an amount typed with thousands commas', async () => {
    await send(fields({ amount: '1,250.50' }));
    expect(recordExpense.mock.calls[0][1].amount).toBe(1250.5);
  });

  it('passes no category when none was chosen, rather than choosing one', async () => {
    await send(fields({ category: '' }));
    expect(recordExpense.mock.calls[0][1].category).toBeUndefined();
  });

  it('refuses a category outside the list before anything is stored', async () => {
    const response = await send(withPhoto(fields({ category: 'snacks' })));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: EXPENSE_REFUSALS.category });
    expect(put).not.toHaveBeenCalled();
    expect(recordExpense).not.toHaveBeenCalled();
  });

  it('stores the photo under a key named by its bytes, not by its filename, and records that key', async () => {
    const response = await send(withPhoto(fields()));
    expect(response.status).toBe(201);
    expect(put).toHaveBeenCalledTimes(1);
    const [key, bytes] = put.mock.calls[0] as [string, Buffer];
    // The file called itself HEIC; its bytes are a JPEG, and the bytes win.
    expect(key).toMatch(/^receipts\/[0-9a-f-]{36}\.jpg$/);
    expect(new Uint8Array(bytes)).toEqual(JPEG);
    expect(recordExpense.mock.calls[0][1].receiptKey).toBe(key);
  });

  it('refuses a file that is not a picture, and records nothing', async () => {
    const response = await send(withPhoto(fields(), new TextEncoder().encode('%PDF-1.7 receipt')));
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ ok: false, error: RECORD_REFUSALS.notAPicture });
    expect(put).not.toHaveBeenCalled();
    expect(recordExpense).not.toHaveBeenCalled();
  });

  it('refuses a photo over the cap, and records nothing', async () => {
    const big = new Uint8Array(MAX_RECEIPT_BYTES + 1);
    big.set(JPEG);
    const response = await send(withPhoto(fields(), big));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, error: RECORD_REFUSALS.tooLarge });
    expect(put).not.toHaveBeenCalled();
    expect(recordExpense).not.toHaveBeenCalled();
  });

  it('refuses a request that declares itself too large before reading it', async () => {
    const response = await send(fields(), { 'content-length': String(64 * 1024 * 1024) });
    expect(response.status).toBe(413);
    expect(recordExpense).not.toHaveBeenCalled();
  });

  it('does not record the expense when the photo could not be stored', async () => {
    put.mockRejectedValue(new Error('STORAGE_DRIVER must be "blob" or "local" in production'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await send(withPhoto(fields()));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: RECORD_REFUSALS.storage });
    expect(recordExpense).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('answers the library\'s refusal verbatim', async () => {
    recordExpense.mockRejectedValue(new HebrewRefusal(EXPENSE_REFUSALS.closedAccount));
    const response = await send(fields());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: EXPENSE_REFUSALS.closedAccount });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('never lets an English message through', async () => {
    recordExpense.mockRejectedValue(new Error('Failed query: insert into "ledger_entries"'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = await (await send(fields())).json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).not.toMatch(/[A-Za-z]/);
    expect(body.error).toMatch(/[א-ת]/);
    errors.mockRestore();
  });

  it('answers a body it cannot read as a refusal, not as a crash', async () => {
    const response = await POST(new Request('http://localhost/money/expenses/record', {
      method: 'POST', body: 'not a form', headers: { 'content-type': 'text/plain' },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: RECORD_REFUSALS.unreadable });
  });
});
