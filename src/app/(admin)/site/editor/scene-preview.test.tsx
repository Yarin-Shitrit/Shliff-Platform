/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EditorDoc } from '@/lib/site/editor/model';
import type { EditorStore } from './use-editor-store';

/*
 * TEMPORARY, like the file it tests: Task 26 deletes `scene-preview.tsx`, and
 * this file with it. Only the status line is checked here; the scene has its
 * own tests (scene/scene-view.test.tsx), and the store its own.
 */
const { current } = vi.hoisted(() => ({ current: { store: null as unknown } }));
vi.mock('./use-editor-store', () => ({ useEditorStore: () => current.store }));
vi.mock('../actions', () => ({ saveSiteChangesAction: vi.fn(), loadSiteDocAction: vi.fn() }));
vi.mock('next/dynamic', () => ({ default: () => function Scene() { return <div data-testid="scene" />; } }));

import { ScenePreview } from './scene-preview';

const DOC: EditorDoc = {
  plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 },
  items: [],
  defaults: {},
};

function fakeStore(save: EditorStore['save']): EditorStore {
  return {
    doc: DOC, selection: [], canUndo: false, canRedo: false,
    flags: { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: [] },
    save, conflict: save.status === 'conflict' ? { version: save.version } : null, notice: null,
    run: vi.fn(), undo: vi.fn(() => null), redo: vi.fn(() => null), select: vi.fn(),
    resolveConflict: vi.fn(async () => {}), retrySave: vi.fn(), dismissNotice: vi.fn(),
  };
}

function renderWith(store: EditorStore) {
  current.store = store;
  render(<ScenePreview initial={{ doc: DOC, version: 3 }} />);
  return store;
}

beforeEach(() => {
  current.store = null;
});

describe('the temporary 3D page’s save line', () => {
  it('says everything is saved, over the scene', () => {
    renderWith(fakeStore({ status: 'saved', version: 3, pending: 0, error: null, errorKind: null }));
    expect(screen.getByText('כל השינויים נשמרו')).toBeTruthy();
    expect(screen.getByTestId('scene')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers the newest version when the server refused the save, not a retry that would be refused again', () => {
    const store = renderWith(fakeStore({
      status: 'error', version: 3, pending: 1, error: 'הפריט נעול. אפשר לשחרר את הנעילה ואז לשנות אותו', errorKind: 'refused',
    }));
    expect(screen.getByText(/הפריט נעול/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ניסיון חוזר' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'טעינת הגרסה העדכנית' }));
    expect(store.resolveConflict).toHaveBeenCalledWith('theirs');
  });

  it('offers a retry when the network failed', () => {
    const store = renderWith(fakeStore({
      status: 'error', version: 3, pending: 1, error: 'השמירה נכשלה, אולי אין חיבור. אפשר לנסות שוב.', errorKind: 'network',
    }));
    expect(screen.queryByRole('button', { name: 'טעינת הגרסה העדכנית' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון חוזר' }));
    expect(store.retrySave).toHaveBeenCalledTimes(1);
  });

  it('asks which map wins after a conflict', () => {
    const store = renderWith(fakeStore({ status: 'conflict', version: 5, pending: 1, error: null, errorKind: null }));
    fireEvent.click(screen.getByRole('button', { name: 'שמירת השינויים שלי מעליה' }));
    expect(store.resolveConflict).toHaveBeenCalledWith('mine');
    fireEvent.click(screen.getByRole('button', { name: 'טעינת הגרסה העדכנית' }));
    expect(store.resolveConflict).toHaveBeenLastCalledWith('theirs');
  });
});
