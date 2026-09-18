import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws "Cannot access before
 * initialization" — `vi.hoisted` gives the factories something to close
 * over instead (see `src/lib/auth/guard.test.ts`).
 */
const { requireAdmin, listSeasons, listRoster } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listSeasons: vi.fn(),
  listRoster: vi.fn(),
}));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/members/roster', () => ({ listSeasons, listRoster }));
vi.mock('@/lib/fees/dues', () => ({ listDues: vi.fn(async () => []) }));
vi.mock('@/lib/fees/payments', () => ({ settlementFor: vi.fn() }));

import { GET } from './route';

describe('GET /members/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSeasons.mockResolvedValue([{ id: 's1', name: 'ברן 26', year: 2026 }]);
    listRoster.mockResolvedValue([
      { personId: 'p1', displayName: 'אופק', role: 'member', joinedAt: new Date() },
    ]);
  });

  it('refuses an unauthenticated request', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    const response = await GET(new Request('http://x/members/export'));
    expect(response.status).toBe(401);
  });

  it('returns UTF-8 CSV with a BOM so Excel reads the Hebrew', async () => {
    requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
    const response = await GET(new Request('http://x/members/export'));
    /**
     * `Response.text()` decodes and strips a leading BOM (WHATWG
     * `TextDecoder`'s default `ignoreBOM: false`) -- correct decoder
     * behaviour, but it means the marker Excel actually reads on disk has to
     * be checked in the raw bytes, not in the decoded string.
     */
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    const body = await response.text();

    expect(response.headers.get('content-type')).toContain('charset=utf-8');
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(body).toContain('אופק');
  });

  it('neutralises a name that would be read as a formula', async () => {
    requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
    listRoster.mockResolvedValue([
      { personId: 'p1', displayName: '=1+1', role: 'member', joinedAt: new Date() },
    ]);
    const body = await (await GET(new Request('http://x/members/export'))).text();
    expect(body).toContain(`"'=1+1"`);
  });
});
