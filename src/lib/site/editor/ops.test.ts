import { describe, it, expect } from 'vitest';
import type { EditorItem } from './model';
import { nextLabel } from './model';
import { kindSizeRefusal, newItemRefusal, opRefusal, patchRefusal } from './ops';

export function item(over: Partial<EditorItem> = {}): EditorItem {
  return {
    id: '5b0f3c1e-2a4d-4f6b-9c8e-1d2a3b4c5d6e', kind: 'tent', label: 'אוהל 1',
    xCm: 0, yCm: 0, widthCm: 300, depthCm: 300, heightCm: null, insetCm: null,
    sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

describe('refusals', () => {
  it('accept an ordinary patch', () => {
    expect(patchRefusal({ xCm: 150, yCm: -50, widthCm: 350, heightCm: 180, locked: true })).toBeNull();
  });

  it('refuse what plan.ts has always refused, in the same words', () => {
    expect(patchRefusal({ label: '   ' })).toMatch(/^an item must have a label/);
    expect(patchRefusal({ widthCm: 5 })).toMatch(/^an item side must be/);
    expect(patchRefusal({ depthCm: 300.5 })).toMatch(/^an item side must be/);
    expect(patchRefusal({ xCm: 1.5 })).toMatch(/^an item position must be/);
    expect(patchRefusal({ insetCm: -1 })).toMatch(/^a shade inset must be/);
    expect(patchRefusal({ kind: 'spaceship' as never })).toMatch(/^unknown item kind/);
  });

  it('refuse a height outside 10 cm to 20 m, but accept null (the kind\'s height)', () => {
    expect(patchRefusal({ heightCm: 5 })).toMatch(/^an item height must be/);
    expect(patchRefusal({ heightCm: 2_001 })).toMatch(/^an item height must be/);
    expect(patchRefusal({ heightCm: null })).toBeNull();
  });

  it('refuse a new item whose id is not a uuid', () => {
    expect(newItemRefusal(item())).toBeNull();
    expect(newItemRefusal(item({ id: 'x1' }))).toMatch(/^an item id must be a uuid/);
  });

  it('refuse a kind default with a bad side', () => {
    expect(kindSizeRefusal({ widthCm: 300, depthCm: 300, heightCm: 200, insetCm: null })).toBeNull();
    expect(kindSizeRefusal({ widthCm: 300, depthCm: 0, heightCm: 200, insetCm: null })).toMatch(/^a kind default must be/);
  });

  it('check every kind of op, and name an unknown one', () => {
    expect(opRefusal({ type: 'remove', id: 'anything' })).toBeNull();
    expect(opRefusal({ type: 'setKindDefault', kind: 'tent', size: null })).toBeNull();
    expect(opRefusal({ type: 'update', id: 'a', patch: { widthCm: 1 } })).toMatch(/^an item side must be/);
    expect(opRefusal({ type: 'explode' } as never)).toMatch(/^unknown operation/);
  });
});

describe('the next label', () => {
  it('is one past the highest number of its kind, counting an unnumbered one as 1', () => {
    expect(nextLabel([], 'tent')).toBe('אוהל 1');
    expect(nextLabel([item({ label: 'אוהל 7' }), item({ label: 'אוהל 3' })], 'tent')).toBe('אוהל 8');
    expect(nextLabel([item({ kind: 'kitchen', label: 'מטבח' })], 'kitchen')).toBe('מטבח 2');
    expect(nextLabel([item({ label: 'אוהל 7' })], 'sofa')).toBe('ספה 1');
  });
});
