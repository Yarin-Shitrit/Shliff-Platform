import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('the /data route', () => {
  it('is gone, with every file it owned', () => {
    for (const file of [
      'src/app/(admin)/data/page.tsx',
      'src/app/(admin)/data/data-explorer.tsx',
      'src/app/(admin)/data/data.module.css',
      'src/app/(admin)/data/register.tsx',
      'src/app/(admin)/data/actions.ts',
    ]) {
      expect(existsSync(join(root, file)), `${file} still exists`).toBe(false);
    }
  });

  it('sends anyone who had it bookmarked to the register', () => {
    const config = readFileSync(join(root, 'next.config.ts'), 'utf8');
    expect(config).toMatch(/source:\s*'\/data'/);
    expect(config).toMatch(/destination:\s*'\/inbox'/);
    expect(config).toMatch(/permanent:\s*true/);
  });

  // The hardening lane owns this key and this plan appends beside it. Losing
  // it would put the camp's real workbooks back into a deployed bundle, which
  // is the kind of regression a merge makes silently.
  it('keeps the hardening lane’s tracing exclusion alongside the redirect', () => {
    const config = readFileSync(join(root, 'next.config.ts'), 'utf8');
    expect(config).toMatch(/outputFileTracingExcludes/);
    expect(config).toMatch(/reference-data/);
  });

  it('leaves no link anywhere still pointing at it', () => {
    const files = [
      'src/app/(admin)/nav.tsx',
      'src/app/(admin)/members/page.tsx',
      'src/app/(admin)/money/page.tsx',
      'src/app/(admin)/upload/page.tsx',
    ].filter((file) => existsSync(join(root, file)));

    // A filter that matched nothing would make the loop below vacuous.
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source, `${file} still links to /data`).not.toMatch(/href=["'{`]\/data/);
    }
  });

  it('keeps docs/reference-data out of the runtime module graph (W16, M14)', () => {
    const files = [
      'src/app/(admin)/inbox/page.tsx',
      'src/app/(admin)/members/page.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source).not.toMatch(/reference-data|readFileSync|extractWorkbook/);
    }
  });
});

describe('the unlinked queue moved rather than being copied', () => {
  // W24: surfaced by a link, not by a second implementation. Plan 06 kept the
  // queue on /members with a comment saying it would go when /inbox existed,
  // because a banner pointing at a 404 helps nobody. /inbox exists now.
  it('is gone from the members screen, with its test', () => {
    for (const file of [
      'src/app/(admin)/members/unlinked-queue.tsx',
      'src/app/(admin)/members/unlinked-queue.test.tsx',
    ]) {
      expect(existsSync(join(root, file)), `${file} still exists`).toBe(false);
    }
  });

  it('left a link to the register behind it', () => {
    const source = readFileSync(
      join(root, 'src/app/(admin)/members/page.tsx'), 'utf8',
    );
    expect(source).toMatch(/\/inbox\?tab=decide&kind=names/);
    expect(source).not.toMatch(/UnlinkedQueue/);
  });
});
