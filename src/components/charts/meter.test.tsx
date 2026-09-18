/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Meter } from './meter';

describe('Meter', () => {
  it('names the ratio for assistive technology via an accessible image label', () => {
    render(<Meter label="שולם" valueAgorot={1000000} totalAgorot={2237530} />);
    // A meter is a single ratio drawn as an SVG mark: without an accessible
    // name it is a shape with no reading. role="img" plus aria-label is the
    // only channel that carries it, so this must exist — colour alone (the
    // filled portion of the bar) is not a substitute.
    expect(screen.getByRole('img', { name: /שולם/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /10,000/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /22,375.30/ })).toBeTruthy();
  });
});
