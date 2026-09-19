import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, UPLOAD_EXTENSION,
  UPLOAD_RULES_HE, TOO_LARGE_HE,
} from './upload-limits';

describe('upload limits', () => {
  it('stays inside the 4.5 MB body limit Vercel enforces before the route runs', () => {
    // Above Vercel's cap the platform refuses the request itself, with its own
    // English error page -- on a Hebrew screen. Keeping the app's own limit
    // below it means the Hebrew refusal in TOO_LARGE_HE is what a member sees.
    // The largest real workbook in docs/reference-data/ is 0.07 MB, so this is
    // ~57x the observed need.
    expect(MAX_UPLOAD_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_UPLOAD_MB).toBe(4);
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });

  it('states a whole number of megabytes, because the Hebrew interpolates it', () => {
    expect(Number.isInteger(MAX_UPLOAD_MB)).toBe(true);
  });

  it('accepts one extension, in lower case', () => {
    expect(UPLOAD_EXTENSION).toBe('.xlsx');
  });

  it('states the same number in the rules line and in the refusal', () => {
    expect(UPLOAD_RULES_HE).toContain(String(MAX_UPLOAD_MB));
    expect(TOO_LARGE_HE).toContain(String(MAX_UPLOAD_MB));
  });

  it('is the only place the route gets its limit from', () => {
    const route = readFileSync(
      join(process.cwd(), 'src/app/api/uploads/route.ts'), 'utf8',
    );
    expect(route).toContain("from '@/lib/import/upload-limits'");
    expect(route).not.toMatch(/const MAX_BYTES\s*=/);
    expect(route).not.toMatch(/const XLSX_EXTENSION\s*=/);
  });
});
