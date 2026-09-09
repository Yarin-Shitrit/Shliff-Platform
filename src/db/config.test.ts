import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import config from '../../drizzle.config';

describe('drizzle schema configuration', () => {
  it('lists every schema file in the directory', () => {
    const dir = join(process.cwd(), 'src', 'db', 'schema');
    const onDisk = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => `./src/db/schema/${f}`)
      .sort();

    const configured = [config.schema].flat().sort();
    expect(configured).toEqual(onDisk);
  });
});
