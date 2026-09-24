import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * `three` is the camp map's renderer and nothing else's (spec §3, D1). It stays
 * behind the scene adapter so every other page's bundle is untouched and every
 * pure module stays testable without it. This file is the one exception: it
 * loads `three` to prove it resolves in Node without a GPU.
 */
const SRC = join(process.cwd(), 'src');
const ALLOWED = 'app/(admin)/site/editor/scene/';
const SELF = 'app/(admin)/site/editor/three-guard.test.ts';
const IMPORTS_THREE = /from\s+['"]three(\/[^'"]*)?['"]|import\(\s*['"]three(\/[^'"]*)?['"]\s*\)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe('three stays inside the scene adapter', () => {
  it('is imported only under site/editor/scene', () => {
    const offenders = walk(SRC)
      .map((file) => relative(SRC, file).split('\\').join('/'))
      .filter((rel) => !rel.startsWith(ALLOWED) && rel !== SELF)
      .filter((rel) => IMPORTS_THREE.test(readFileSync(join(SRC, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('loads in Node without a GPU', async () => {
    const THREE = await import('three');
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    expect(scene.children).toHaveLength(1);
  });
});
