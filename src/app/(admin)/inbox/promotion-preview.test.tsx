/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PromotionPreview } from '@/lib/inbox/promotion';
import { PromotionPreviewPanel } from './promotion-preview';

function preview(over: Partial<PromotionPreview> = {}): PromotionPreview {
  return {
    ready: [], readyCount: 0, alreadyPromoted: 0,
    awaitingReview: 0, heldBySheet: 0, noPromoter: 0, ...over,
  };
}

const READY = {
  blockId: 'b7', uploadId: 'u9', sheetName: 'תקציב 26',
  archetype: 'budget_lines' as const, range: 'A3:H61',
  href: '/imports/u9?block=b7',
};

describe('PromotionPreviewPanel', () => {
  it('names the tables a promotion would write', () => {
    render(<PromotionPreviewPanel preview={preview({ ready: [READY], readyCount: 1 })} />);
    const region = screen.getByRole('region', { name: 'מה קידום היה כותב' });
    expect(within(region).getByText(/תקציב 26/)).toBeTruthy();
    expect(within(region).getByText('שורות תקציב')).toBeTruthy();
  });

  it('sends a lead to the screen that promotes one table and shows what it keeps', () => {
    render(<PromotionPreviewPanel preview={preview({ ready: [READY], readyCount: 1 })} />);
    const link = screen.getByRole('link', { name: /תקציב 26/ });
    expect(link.getAttribute('href')).toBe('/imports/u9?block=b7');
  });

  /**
   * A23, and the reason the whole panel exists in this shape. The register may
   * say what promotion would do; it may not offer to do it in bulk. A button
   * here is one edit away from the one the plan's file table describes, so the
   * absence is asserted rather than assumed.
   */
  it('offers no control that promotes anything', () => {
    render(<PromotionPreviewPanel preview={preview({ ready: [READY], readyCount: 1 })} />);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('says plainly that promotion happens one table at a time, and where', () => {
    render(<PromotionPreviewPanel preview={preview({ ready: [READY], readyCount: 1 })} />);
    expect(screen.getByText(/קידום נעשה טבלה אחת בכל פעם/)).toBeTruthy();
  });

  it('accounts for the tables it is not offering, rather than leaving a gap', () => {
    render(<PromotionPreviewPanel preview={preview({
      alreadyPromoted: 4, awaitingReview: 2, heldBySheet: 3, noPromoter: 1,
    })} />);
    const region = screen.getByRole('region', { name: 'מה קידום היה כותב' });
    expect(region.textContent).toContain('4');
    expect(region.textContent).toContain('2');
    expect(region.textContent).toContain('3');
    expect(region.textContent).toContain('1');
  });

  it('says there is nothing waiting rather than showing an empty list', () => {
    render(<PromotionPreviewPanel preview={preview({ alreadyPromoted: 9 })} />);
    expect(screen.getByText(/אין טבלה שממתינה לקידום/)).toBeTruthy();
  });

  // The count is of tables, never of rows. A row total here could only come
  // from a dry run on every page load, and claiming one without measuring it
  // is the register telling a lead something it has not checked.
  it('counts tables and promises no row total', () => {
    render(<PromotionPreviewPanel preview={preview({ ready: [READY], readyCount: 1 })} />);
    const region = screen.getByRole('region', { name: 'מה קידום היה כותב' });
    expect(region.textContent).not.toMatch(/\d+\s*שורות ייכתבו/);
  });
});

describe('A23 — the register ships no bulk promoter', () => {
  it('has no bulk-promote component anywhere in the route', () => {
    const dir = join(process.cwd(), 'src/app/(admin)/inbox');
    expect(() => readFileSync(join(dir, 'bulk-promote.tsx'), 'utf8')).toThrow();
  });

  it('names no bulk promoter in the preview it renders instead', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/(admin)/inbox/promotion-preview.tsx'), 'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('export function PromotionPreviewPanel');
    expect(code).not.toMatch(/promoteAll/);
    expect(code).not.toMatch(/promoteUpload/);
  });
});
