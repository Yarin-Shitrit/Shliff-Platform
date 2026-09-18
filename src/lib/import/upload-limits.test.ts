import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, UPLOAD_EXTENSION,
  UPLOAD_RULES_HE, TOO_LARGE_HE,
} from './upload-limits';

describe('upload limits', () => {
  it('keeps the 25 MB the route has always enforced', () => {
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_UPLOAD_MB).toBe(25);
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
