/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EditorUi } from '../scene/scene-view';
import { Toolbar } from './toolbar';

const UI: EditorUi = {
  tool: 'select', mode: '3d', labels: true, sun: false, netsHidden: false, snap: true,
  hiddenGroups: [], hour: 14, theme: 'light', underlay: { shown: true, opacity: 0.5 },
};

function renderToolbar(ui: EditorUi, hasUnderlay?: boolean) {
  const onUi = vi.fn();
  render(<Toolbar ui={ui} onUi={onUi} canUndo={false} canRedo={false} onUndo={() => {}} onRedo={() => {}} hasUnderlay={hasUnderlay} />);
  return { onUi };
}

describe('the tool row’s switch for the picture', () => {
  it('is not there until the map has a picture', () => {
    renderToolbar(UI, false);
    expect(screen.queryByRole('button', { name: 'תמונת רקע' })).toBeNull();
  });

  it('shows and hides the picture for this viewer, with a label that does not change', () => {
    const { onUi } = renderToolbar(UI, true);
    const toggle = screen.getByRole('button', { name: 'תמונת רקע' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(onUi).toHaveBeenCalledWith({ underlay: { shown: false, opacity: 0.5 } });
  });

  it('presses neither tool while the picture is being calibrated or aligned', () => {
    renderToolbar({ ...UI, tool: 'calibrate' }, true);
    expect(screen.getByRole('button', { name: /בחירה/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /מדידה/ }).getAttribute('aria-pressed')).toBe('false');
  });
});
