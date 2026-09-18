/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SourceChip, formatSourceRef } from './source-chip';

describe('formatSourceRef', () => {
  it('writes a workbook reference as sheet!cell', () => {
    expect(formatSourceRef({ kind: 'workbook', sheet: 'תנועות קופה', cell: 'A14' }))
      .toBe('תנועות קופה!A14');
  });

  it('says so in Hebrew when a lead typed the number', () => {
    expect(formatSourceRef({ kind: 'manual' })).toBe('נרשם ידנית');
  });
});

describe('SourceChip', () => {
  it('shows the cell and names it as a source', () => {
    render(<SourceChip source={{ kind: 'workbook', sheet: 'תנועות קופה', cell: 'A14' }} />);
    expect(screen.getByText('תנועות קופה!A14')).toBeTruthy();
    // `getByLabelText` matches the `aria-label` *attribute*, not the computed
    // accessible name — it would pass even on a plain `<span>`, whose generic
    // role forbids ARIA from naming it at all, so browsers never expose that
    // attribute as a name. `getByRole` asks for the name the same way a
    // screen reader does: through the accessibility tree.
    expect(screen.getByRole('img', { name: 'מקור: תנועות קופה!A14' })).toBeTruthy();
  });

  it('links to the block when the caller knows where it lives', () => {
    render(
      <SourceChip
        source={{ kind: 'workbook', sheet: 'תנועות קופה', cell: 'A14', blockHref: '/imports/7#b3' }}
      />,
    );
    expect(screen.getByRole('link', { name: 'מקור: תנועות קופה!A14' }).getAttribute('href'))
      .toBe('/imports/7#b3');
  });

  it('is not a link when there is no block to open, and still names itself as a source', () => {
    render(<SourceChip source={{ kind: 'manual' }} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('נרשם ידנית')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'מקור: נרשם ידנית' })).toBeTruthy();
  });

  it('renders a workbook reference left-to-right and a manual note right-to-left', () => {
    const { container: workbook } = render(
      <SourceChip source={{ kind: 'workbook', sheet: 'קופה 25', cell: 'D31' }} />,
    );
    expect(workbook.firstElementChild?.className).not.toContain('manual');
    const { container: manual } = render(<SourceChip source={{ kind: 'manual' }} />);
    expect(manual.firstElementChild?.className).toContain('manual');
  });
});
