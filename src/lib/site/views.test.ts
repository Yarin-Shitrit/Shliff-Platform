import { describe, it, expect } from 'vitest';
import { parseSiteQuery } from './views';

describe('the camp map’s address', () => {
  it('asks for the 3D map only with ?editor=3d', () => {
    expect(parseSiteQuery({ season: 's26', editor: '3d' }).editor3d).toBe(true);
    expect(parseSiteQuery({ editor: ['3d', '2d'] }).editor3d).toBe(true);
    expect(parseSiteQuery({ season: 's26' }).editor3d).toBe(false);
    expect(parseSiteQuery({ editor: '2d' }).editor3d).toBe(false);
    expect(parseSiteQuery({ editor: '' }).editor3d).toBe(false);
  });
});
