import { describe, it, expect } from 'vitest';
import { accessSummary } from './summary';

describe('accessSummary', () => {
  it('says everything for an admin, whatever rows it has', () => {
    expect(accessSummary({ admin: true, pages: {} })).toBe('כל העמודים');
  });

  it('says nothing for an account with no page', () => {
    expect(accessSummary({ admin: false, pages: {} })).toBe('אף עמוד');
  });

  it('counts each level, naming only the ones that are there', () => {
    expect(accessSummary({ admin: false, pages: { people: 'view', dues: 'view', tasks: 'edit' } }))
      .toBe('2 לצפייה · 1 לעריכה');
    expect(accessSummary({ admin: false, pages: { people: 'edit' } })).toBe('1 לעריכה');
    expect(accessSummary({ admin: false, pages: { people: 'view' } })).toBe('1 לצפייה');
  });
});
