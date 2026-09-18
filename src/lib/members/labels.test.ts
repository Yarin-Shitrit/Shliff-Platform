import { describe, it, expect } from 'vitest';
import { ROLE_LABELS, DUE_KIND_LABELS, roleLabel, dueKindLabel } from './labels';

describe('labels', () => {
  it('gives the two roles the words the screens already use', () => {
    expect(ROLE_LABELS.member).toBe('חבר/ה');
    expect(ROLE_LABELS.lead).toBe('ראש/ת צוות');
  });

  it('gives the two due kinds the words /fees already uses', () => {
    expect(DUE_KIND_LABELS.flat).toBe('רגיל');
    expect(DUE_KIND_LABELS.exception).toBe('חריג');
  });

  it('renders an unmapped value as itself rather than as nothing', () => {
    expect(roleLabel('treasurer')).toBe('treasurer');
    expect(dueKindLabel('')).toBe('');
  });
});
