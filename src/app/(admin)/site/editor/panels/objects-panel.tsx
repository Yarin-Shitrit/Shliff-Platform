'use client';

/**
 * במפה (spec §10): every item, grouped as the library groups kinds,
 * searchable. A row selects its item and flies to it; shift or ⌘ adds it to
 * the selection. A group's count selects the rows it counts (§13: a figure
 * selects what it counts). Each group can be hidden from the scene. This list
 * is also the keyboard's and the screen reader's way through the map, so
 * every row says in words what the screen shows as a padlock, a dot or a dim
 * row: its lock, every problem it has, and that it is hidden.
 */

import { useRef, useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icon';
import { formatSize } from '@/lib/site/geometry';
import { KIND_GROUP_LABELS, KIND_GROUP_ORDER, SITE_KINDS, type SiteKindGroup } from '@/lib/site/kinds';
import type { EditorItem } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { EditorIcon } from './editor-icons';
import chrome from './panel.module.css';
import styles from './objects-panel.module.css';

interface Issue {
  tone: 'bad' | 'warn';
  text: string;
}

/** Every problem the item has, worst first. */
function issuesOf(item: EditorItem, flags: EditorFlags): Issue[] {
  const issues: Issue[] = [];
  if (flags.outside.has(item.id)) issues.push({ tone: 'bad', text: 'מחוץ לגדר' });
  if (flags.overlapping.has(item.id)) issues.push({ tone: 'warn', text: 'חפיפה עם פריט אחר' });
  if (flags.partly.has(item.id)) issues.push({ tone: 'warn', text: 'בשולי רשת צל' });
  return issues;
}

export function ObjectsPanel({
  items, selection, flags, hiddenGroups, netsHidden, onPick, onPickIds, onToggleGroup, onShowLibrary,
}: {
  items: readonly EditorItem[];
  selection: readonly string[];
  flags: EditorFlags;
  hiddenGroups: readonly SiteKindGroup[];
  /** The tool row's "הסתרת רשתות צל": a net's row is hidden too, whatever its group. */
  netsHidden: boolean;
  onPick: (id: string, additive: boolean) => void;
  /** A group's count: exactly the rows it counts. */
  onPickIds: (ids: string[]) => void;
  onToggleGroup: (group: SiteKindGroup) => void;
  /** The empty map's way to the library tab; without it, the invitation offers no button. */
  onShowLibrary?: () => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const searchBox = useRef<HTMLInputElement>(null);
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

  /* The button that cleared the search leaves with the empty result, so the
     focus goes to the box the next search is typed in. */
  function clearSearch(): void {
    setQuery('');
    searchBox.current?.focus();
  }

  if (items.length === 0) {
    return (
      <div className={styles.offer}>
        <p className={chrome.invite}>
          המפה ריקה. בלשונית ״הוספה למפה״ גוררים פריט אל המפה או לוחצים עליו.
        </p>
        {onShowLibrary === undefined ? null : (
          <Button size="sm" onClick={onShowLibrary}>מעבר להוספה למפה</Button>
        )}
      </div>
    );
  }

  return (
    <div className={chrome.stack}>
      <label className={chrome.search}>
        <Icon name="search" size={15} />
        <input
          ref={searchBox}
          type="search"
          className={chrome.searchInput}
          placeholder="חיפוש במפה"
          aria-label="חיפוש במפה"
          value={query}
          onChange={(event) => { setQuery(event.target.value); }}
        />
      </label>
      {groups.map(({ group, rows }) => {
        const groupHidden = hiddenGroups.includes(group);
        return (
          <div key={group}>
            <div className={styles.groupHead}>
              <span className={cx(chrome.swatch, chrome[`g_${group}`])} aria-hidden="true" />
              <span>{KIND_GROUP_LABELS[group]}</span>
              {/* The number and what it selects are one set: the rows shown under it.
                  Its name carries the number it shows (label-in-name), so a
                  voice user saying the number reaches it. */}
              <button
                type="button"
                className={styles.count}
                aria-label={`בחירת הפריטים בקבוצה ${KIND_GROUP_LABELS[group]} (${rows.length})`}
                onClick={() => { onPickIds(rows.map((item) => item.id)); }}
              >
                <bdi>{rows.length}</bdi>
              </button>
              <button
                type="button"
                className={styles.eye}
                aria-label={`הסתרת ${KIND_GROUP_LABELS[group]}`}
                aria-pressed={groupHidden}
                onClick={() => { onToggleGroup(group); }}
              >
                {groupHidden ? <EditorIcon name="eyeOff" /> : <Icon name="eye" size={16} />}
              </button>
            </div>
            {rows.map((item) => {
              const issues = issuesOf(item, flags);
              const hidden = groupHidden || (netsHidden && item.kind === 'shade');
              const size = formatSize(item.widthCm, item.depthCm);
              /* Spoken in full, commas between. The name starts with the
                 visible label (label-in-name). The hiding and the lock are
                 noun phrases (ruling P11): an adjective would have to agree
                 with whatever the item is called. */
              const name = [
                item.label,
                hidden ? 'בהסתרה' : null,
                item.locked ? 'בנעילה' : null,
                ...issues.map((issue) => issue.text),
                size,
              ].filter((part): part is string => part !== null).join(', ');
              return (
                <button
                  key={item.id}
                  type="button"
                  className={styles.row}
                  data-row="true"
                  data-id={item.id}
                  data-hidden={hidden ? 'true' : undefined}
                  aria-label={name}
                  aria-pressed={selected.has(item.id)}
                  onClick={(event) => { onPick(item.id, event.shiftKey || event.metaKey || event.ctrlKey); }}
                >
                  <span className={cx(styles.rowSwatch, chrome[`g_${group}`])} aria-hidden="true" />
                  <span className={styles.rowLabel}>{item.label}</span>
                  {item.locked ? <EditorIcon name="lock" size={14} /> : null}
                  {issues.length === 0 ? null : (
                    <span
                      className={chrome.issueDot}
                      data-tone={issues.some((issue) => issue.tone === 'bad') ? 'bad' : 'warn'}
                      aria-hidden="true"
                    />
                  )}
                  <span className={styles.rowSize}><bdi>{size}</bdi></span>
                </button>
              );
            })}
          </div>
        );
      })}
      {groups.length === 0 ? (
        <div className={styles.offer}>
          <p className={chrome.hint}>אין במפה פריט בשם הזה. אפשר לחפש בשם אחר, או לחזור לכל הרשימה.</p>
          <Button size="sm" tone="ghost" onClick={clearSearch}>ניקוי החיפוש</Button>
        </div>
      ) : null}
    </div>
  );
}
