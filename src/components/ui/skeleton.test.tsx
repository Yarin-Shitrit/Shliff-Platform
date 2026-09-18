/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkeletonPage, SkeletonTiles, SkeletonTable, SkeletonText } from './skeleton';

describe('skeletons', () => {
  it('announces once, in Hebrew, and not once per shape', () => {
    render(
      <SkeletonPage label="טוען את דמי הקאמפ…">
        <SkeletonTable rows={11} columns={6} />
      </SkeletonPage>,
    );
    expect(screen.getByRole('status').textContent).toBe('טוען את דמי הקאמפ…');
  });

  /**
   * The landmark survives the wait. Putting `role="status"` on the `<main>`
   * itself replaces the main landmark for as long as the screen is loading,
   * so a reader navigating by landmark loses the one they were heading for.
   */
  it('keeps the main landmark while it waits', () => {
    render(<SkeletonPage label="טוען…"><SkeletonText lines={3} /></SkeletonPage>);
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('hides every shape from the accessibility tree', () => {
    const { container } = render(
      <SkeletonPage label="טוען…"><SkeletonTiles count={4} /></SkeletonPage>,
    );
    const shapes = container.querySelectorAll('[data-skeleton]');
    expect(shapes.length).toBe(4);
    shapes.forEach((shape) => expect(shape.getAttribute('aria-hidden')).toBe('true'));
  });

  it('draws as many rows as are coming, so nothing jumps when the data lands', () => {
    const { container } = render(<SkeletonTable rows={11} columns={6} />);
    expect(container.querySelectorAll('[data-skeleton="row"]').length).toBe(11);
  });

  it('draws as many columns as are coming', () => {
    const { container } = render(<SkeletonTable rows={2} columns={6} />);
    const first = container.querySelector('[data-skeleton="row"]');
    expect(first?.childElementCount).toBe(6);
  });

  it('draws as many lines of text as are coming', () => {
    const { container } = render(<SkeletonText lines={3} />);
    expect(container.querySelectorAll('[data-skeleton="line"]').length).toBe(3);
  });

  /**
   * A spinner says "something is happening" where a skeleton says "four tiles
   * and eleven rows are happening", and the second is the one that stops a
   * lead re-clicking.
   */
  it('has no spinner in it anywhere', () => {
    const { container } = render(
      <SkeletonPage label="טוען…"><SkeletonTiles count={4} /></SkeletonPage>,
    );
    expect(container.querySelector('[class*="spinner"]')).toBeNull();
  });

  /**
   * Under `prefers-reduced-motion: reduce` the shimmer stops and a static
   * block remains — the shape is the information, the movement is not.
   * globals.css already clamps every animation's duration for that reader;
   * this drops the sweep entirely rather than running it 100 times a second.
   */
  it('stops sweeping for a reader who asked for less motion', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(process.cwd(), 'src/components/ui/skeleton.module.css'), 'utf8');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('animation: none');
  });
});
