'use client';

/**
 * במפה (spec §10): every item, grouped as the library groups kinds,
 * searchable. A row selects its item and flies to it; shift or ⌘ adds it to
 * the selection. Each group can be hidden from the scene. This list is also
 * the keyboard's and the screen reader's way through the map, so every row
 * says its problem and its lock in words, not only in a dot.
 */

import { useState, type ReactElement } from 'react';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { formatSize } from '@/lib/site/geometry';
import { KIND_GROUP_LABELS, KIND_GROUP_ORDER, SITE_KINDS, type SiteKindGroup } from '@/lib/site/kinds';
import type { EditorItem } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { EditorIcon } from './editor-icons';
import styles from './objects-panel.module.css';

function issueOf(item: EditorItem, flags: EditorFlags): { tone: 'bad' | 'warn'; text: string } | null {
  if (flags.outside.has(item.id)) return { tone: 'bad', text: 'מחוץ לגדר' };
  if (flags.overlapping.has(item.id)) return { tone: 'warn', text: 'חפיפה עם פריט אחר' };
  if (flags.partly.has(item.id)) return { tone: 'warn', text: 'בשולי רשת צל' };
  return null;
}

export function ObjectsPanel({ items, selection, flags, hiddenGroups, onPick, onToggleGroup }: {
  items: readonly EditorItem[];
  selection: readonly string[];
  flags: EditorFlags;
  hiddenGroups: readonly SiteKindGroup[];
  onPick: (id: string, additive: boolean) => void;
  onToggleGroup: (group: SiteKindGroup) => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const wanted = query.trim();
  const selected = new Set(selection);
  const groups = KIND_GROUP_ORDER
    .map((group) => ({
      group,
      rows: items
        .filter((item) => SITE_KINDS[item.kind].group === group && (wanted === '' || item.label.includes(wanted)))
        .sort((a, b) => a.label.localeCompare(b.label, 'he', { numeric: true })),
    }))
    .filter((entry) => entry.rows.length > 0);

  if (items.length === 0) {
    return (
      <p className={styles.invite}>
        המפה ריקה. בלשונית ״הוספה למפה״ גוררים פריט אל המפה או לוחצים עליו.
      </p>
    );
  }

  return (
    <div className={styles.stack}>
      <label className={styles.search}>
        <Icon name="search" size={15} />
        <input
          type="search"
          className={styles.searchInput}
          placeholder="חיפוש במפה"
          aria-label="חיפוש במפה"
          value={query}
          onChange={(event) => { setQuery(event.target.value); }}
        />
      </label>
      {groups.map(({ group, rows }) => (
        <div key={group}>
          <div className={styles.groupHead}>
            <span className={cx(styles.swatch, styles[`g_${group}`])} aria-hidden="true" />
            <span>{KIND_GROUP_LABELS[group]}</span>
            <span aria-hidden="true">·</span>
            <bdi>{rows.length}</bdi>
            <button
              type="button"
              className={styles.eye}
              aria-label={`הסתרת ${KIND_GROUP_LABELS[group]}`}
              aria-pressed={hiddenGroups.includes(group)}
              onClick={() => { onToggleGroup(group); }}
            >
              {hiddenGroups.includes(group) ? <EditorIcon name="eyeOff" /> : <Icon name="eye" size={16} />}
            </button>
          </div>
          {rows.map((item) => {
            const issue = issueOf(item, flags);
            const size = formatSize(item.widthCm, item.depthCm);
            /* Spoken in full, commas between: the lock and the problem are
               words here, where the screen shows a padlock and a dot. The
               name starts with the visible label (label-in-name). The lock is
               a noun phrase (ruling P11): an adjective would have to agree
               with whatever the item is called. */
            const name = [item.label, item.locked ? 'בנעילה' : null, issue?.text ?? null, size]
              .filter((part): part is string => part !== null)
              .join(', ');
            return (
              <button
                key={item.id}
                type="button"
                className={styles.row}
                data-row="true"
                data-id={item.id}
                aria-label={name}
                aria-pressed={selected.has(item.id)}
                onClick={(event) => { onPick(item.id, event.shiftKey || event.metaKey || event.ctrlKey); }}
              >
                <span className={cx(styles.rowSwatch, styles[`g_${group}`])} aria-hidden="true" />
                <span className={styles.rowLabel}>{item.label}</span>
                {item.locked ? <EditorIcon name="lock" size={14} /> : null}
                {issue === null ? null : <span className={styles.issueDot} data-tone={issue.tone} aria-hidden="true" />}
                <span className={styles.rowSize}><bdi>{size}</bdi></span>
              </button>
            );
          })}
        </div>
      ))}
      {groups.length === 0 ? <p className={styles.hint}>אין במפה פריט בשם הזה.</p> : null}
    </div>
  );
}
