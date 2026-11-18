import { describe, it, expect, beforeEach, vi } from 'vitest';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import type { AdminCheck } from '@/lib/auth/guard';

const { grants, receiptOf, get } = vi.hoisted(() => ({
  grants: { current: {} as Record<string, AdminCheck> },
  receiptOf: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({
  requireAdmin: async (page: string) => grants.current[page] ?? { ok: false },
}));
vi.mock('@/lib/storage', () => ({ getStorage: () => ({ get, put: vi.fn() }) }));
vi.mock('@/lib/money/expenses', () => ({ receiptOf }));

import { config } from '@/proxy';
import { GET } from './route';

const ID = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const KEY = 'receipts/5e1d2c3b-4a59-4876-9e0f-a1b2c3d4e5f6.jpg';
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const BUYER = 'buyer@example.com';

const ask = (id: string) =>
  GET(new Request(`http://localhost/money/expenses/receipt/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  grants.current = {};
  receiptOf.mockResolvedValue({ receiptKey: KEY, recordedBy: BUYER });
  get.mockResolvedValue(BYTES);
});

describe('GET /money/expenses/receipt/<id>', () => {
  it('sits behind the proxy as well: its path does not end in an image extension', () => {
    expect(unstable_doesMiddlewareMatch({ config, url: `/money/expenses/receipt/${ID}` })).toBe(true);
  });

  it('answers 401 with no grant at all, and asks neither the database nor storage', async () => {
    const response = await ask(ID);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    expect(receiptOf).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('serves any receipt to an account that may open the ledger', async () => {
    grants.current = { ledger: { ok: true, email: 'lead@example.com' } };
    const response = await ask(ID);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BYTES);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(get).toHaveBeenCalledWith(KEY);
  });

  it('serves an expenses-only account the receipt of an expense it typed', async () => {
    grants.current = { expenses: { ok: true, email: BUYER } };
    expect((await ask(ID)).status).toBe(200);
  });

  it('answers an expenses-only account 404 for somebody else\'s receipt, without reading it', async () => {
    grants.current = { expenses: { ok: true, email: 'other@example.com' } };
    const response = await ask(ID);
    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it('answers 404 for an id that is not an id, without asking the database', async () => {
    grants.current = { ledger: { ok: true, email: 'lead@example.com' } };
    for (const id of ['x', '..', `${ID}.jpg`, `${ID}/..`, "' or 1=1 --"]) {
      expect((await ask(id)).status, id).toBe(404);
    }
    expect(receiptOf).not.toHaveBeenCalled();
  });

  it('answers 404 for a movement with no receipt', async () => {
    grants.current = { ledger: { ok: true, email: 'lead@example.com' } };
    receiptOf.mockResolvedValue(null);
    expect((await ask(ID)).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it('never asks storage for a key that is not a receipt key, whatever the row holds', async () => {
    grants.current = { ledger: { ok: true, email: 'lead@example.com' } };
    receiptOf.mockResolvedValue({ receiptKey: 'uploads/camp-fees.xlsx', recordedBy: BUYER });
    expect((await ask(ID)).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it('answers 404, not a crash, when the photo is gone from storage', async () => {
    grants.current = { ledger: { ok: true, email: 'lead@example.com' } };
    get.mockRejectedValue(new Error('failed to read blob'));
    expect((await ask(ID)).status).toBe(404);
  });
});
