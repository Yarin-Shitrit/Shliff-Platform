'use client';

import dynamic from 'next/dynamic';
import { useState, useSyncExternalStore } from 'react';
import type { EditorDoc } from '@/lib/site/editor/model';
import { parseTheme } from '@/lib/theme';
import { loadSiteDocAction, saveSiteChangesAction } from '../actions';
import type { EditorUi, ViewInfo } from './scene/scene-view';
import type { SceneTheme } from './scene/palette';
import type { QueueSnapshot } from './save-queue';
import { useEditorStore } from './use-editor-store';
import styles from './scene/scene.module.css';

/**
 * TEMPORARY — the bare 3D map at `/site?editor=3d` (plan 03, Task 20), so the
 * scene can be checked in a browser before any panel is built on it. Task 26
 * deletes this file (and its test) when `site-editor.tsx` becomes the page.
 *
 * It shows the scene and one line of save status, and nothing else.
 */

// `ssr: false` is allowed only in a Client Component (next/dist/docs, 01-app/02-guides/lazy-loading.md).
const SceneView = dynamic(() => import('./scene/scene-view').then((m) => m.SceneView), { ssr: false });

const UI_BASE: Omit<EditorUi, 'theme'> = {
  tool: 'select', mode: '3d', labels: true, sun: false, netsHidden: false,
  snap: true, hiddenGroups: [], hour: 14,
};
const NO_INSETS = { left: 0, right: 0, top: 0, bottom: 0 };
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The theme on screen: the reader's choice on <html>, else the OS's (as `theme-toggle.tsx` reads it). */
function subscribeTheme(onChange: () => void): () => void {
  const query = window.matchMedia?.(DARK_QUERY);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  query?.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    query?.removeEventListener('change', onChange);
  };
}

function shownTheme(): SceneTheme {
  const chosen = parseTheme(document.documentElement.dataset.theme);
  if (chosen !== null) return chosen;
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

/** The spec's three sentences (§6.3), and the conflict banner's (§6.4). */
function statusText(save: QueueSnapshot): string {
  switch (save.status) {
    case 'saved': return 'כל השינויים נשמרו';
    case 'pending':
    case 'saving': return 'שומר…';
    case 'conflict': return 'המפה שונתה ממקום אחר מאז שנפתחה. השינויים האחרונים שלך עוד לא נשמרו.';
    case 'error': return `לא נשמר — ${save.error ?? ''}`;
  }
}

export function ScenePreview({ initial }: { initial: { doc: EditorDoc; version: number } }) {
  const planId = initial.doc.plot.id;
  const store = useEditorStore({
    doc: initial.doc,
    version: initial.version,
    save: (baseVersion, ops) => saveSiteChangesAction(planId, baseVersion, ops),
    load: () => loadSiteDocAction(planId),
  });
  const theme = useSyncExternalStore(subscribeTheme, shownTheme, () => 'light' as const);
  const [view, setView] = useState<ViewInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const shown = notice ?? store.notice;
  /* A batch the server refused would be refused again: the way on is the
     map as the server has it. One the network lost can simply go again. */
  const refused = store.save.status === 'error' && store.save.errorKind === 'refused';
  const retryable = store.save.status === 'error' && !refused;

  return (
    <div className={styles.preview}>
      <p className={styles.previewStatus} role="status">
        <span>{statusText(store.save)}</span>
        {retryable ? (
          <button type="button" onClick={() => store.retrySave()}>ניסיון חוזר</button>
        ) : null}
        {store.conflict !== null || refused ? (
          <button type="button" onClick={() => { void store.resolveConflict('theirs'); }}>טעינת הגרסה העדכנית</button>
        ) : null}
        {store.conflict !== null ? (
          <button type="button" onClick={() => { void store.resolveConflict('mine'); }}>שמירת השינויים שלי מעליה</button>
        ) : null}
        {view === null ? null : <bdi>{`זום ${view.zoomPct}% · ${Math.round(view.yaw)}°`}</bdi>}
        {shown === null ? null : (
          <>
            <span>{shown}</span>
            <button type="button" onClick={() => { setNotice(null); store.dismissNotice(); }}>סגירה</button>
          </>
        )}
      </p>
      <div className={styles.previewScene}>
        <SceneView
          store={store}
          ui={{ ...UI_BASE, theme }}
          insets={NO_INSETS}
          sunDate={null}
          onView={setView}
          onNotice={setNotice}
        />
      </div>
    </div>
  );
}
