import { describe, it, expect } from 'vitest';
import { isAuthorized } from '@/lib/auth/authorized';

describe('isAuthorized', () => {
  it('authorizes a signed-in user', () => {
    expect(isAuthorized({ user: { email: 'admin@example.com' }, expires: '' })).toBe(true);
  });

  it('rejects an anonymous request', () => {
    expect(isAuthorized(null)).toBe(false);
  });
});
