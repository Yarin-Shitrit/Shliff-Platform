/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EditorDoc, EditorUnderlay } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { PlotInspector } from './inspector-plot';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const IMAGE: EditorUnderlay = {
  storageKey: `site-underlays/${PLAN}/${'a'.repeat(64)}.png`, contentType: 'image/png', sizeBytes: 1000, filename: 'שרטוט.png',
  centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0, calibration: null,
};
const FLAGS: EditorFlags = { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: [] };

function renderPlot(underlay: EditorUnderlay | null, onUnderlay?: () => void) {
  const doc: EditorDoc = { plot: { id: PLAN, widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items: [], lines: [], defaults: {}, underlay };
  render(<PlotInspector doc={doc} flags={FLAGS} plotHref="/site?act=plot" onPickIds={() => {}} onUnderlay={onUnderlay} />);
}

describe('the plot’s row for the picture under the map', () => {
  it('invites an upload, and opens the picture’s card', () => {
    const onUnderlay = vi.fn();
    renderPlot(null, onUnderlay);
    expect(screen.getByText('תמונת רקע')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'העלאת תמונה' }));
    expect(onUnderlay).toHaveBeenCalled();
  });

  it('says a picture is not calibrated yet, and opens its card', () => {
    const onUnderlay = vi.fn();
    renderPlot(IMAGE, onUnderlay);
    fireEvent.click(screen.getByRole('button', { name: 'לא כוילה' }));
    expect(onUnderlay).toHaveBeenCalledTimes(1);
  });

  it('says what a calibrated picture was calibrated from', () => {
    renderPlot({ ...IMAGE, calibration: { from: [0.1, 0.5], to: [0.9, 0.5], distanceCm: 2600 } }, vi.fn());
    expect(screen.getByRole('button', { name: /כויל לפי/ }).textContent).toBe('כויל לפי ⁦26 מ׳⁩');
  });

  it('has no row when the editor gives it nowhere to open', () => {
    renderPlot(null);
    expect(screen.queryByText('תמונת רקע')).toBeNull();
  });
});
