/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserBlock, initialsFromEmail } from '@/app/(admin)/shell/user-block';

describe('initialsFromEmail', () => {
  it('takes two letters from the part before the @', () => {
    expect(initialsFromEmail('shira@shliff.camp')).toBe('SH');
  });

  it('takes the first letter of each word in a dotted address', () => {
    expect(initialsFromEmail('roni.adler@shliff.camp')).toBe('RA');
  });

  it('never returns an empty badge', () => {
    expect(initialsFromEmail('@shliff.camp')).toBe('?');
  });
});

describe('UserBlock', () => {
  const noop = vi.fn(async () => {});

  it('shows who is signed in', () => {
    render(<UserBlock email="shira@shliff.camp" onSignOut={noop} />);
    expect(screen.getByText('shira@shliff.camp')).toBeTruthy();
    expect(screen.getByText('SH')).toBeTruthy();
  });

  it('offers a way out (B9)', () => {
    render(<UserBlock email="shira@shliff.camp" onSignOut={noop} />);
    expect(screen.getByRole('button', { name: 'יציאה מהחשבון' })).toBeTruthy();
  });

  it('makes room for the theme toggle beside it', () => {
    render(
      <UserBlock email="shira@shliff.camp" onSignOut={noop}>
        <button type="button">ערכת צבעים</button>
      </UserBlock>,
    );
    expect(screen.getByRole('button', { name: 'ערכת צבעים' })).toBeTruthy();
  });
});
