'use client';

/**
 * Nothing selected: the plot (spec §10). Its size, area, grid and north —
 * each a link to the drawer that changes it (§13, ruling P10) — what is on it
 * per group (a count selects what it counts), the shade its nets give (which
 * selects the nets), and every problem as a row that selects what it names.
 * All of it typed by a lead: "נרשם ידנית".
 */

import Link from 'next/link';
import type { ReactElement } from 'react';
import { cx } from '@/components/ui/cx';
import { SourceChip } from '@/components/ui/source-chip';
import { toPlaced } from '@/lib/site/derive';
import { areaM2, formatArea, formatMetres, formatSize, shadeCounts } from '@/lib/site/geometry';
import { KIND_GROUP_LABELS, KIND_GROUP_ORDER, SITE_KINDS, type SiteKindGroup } from '@/lib/site/kinds';
import { LINE_KIND_ORDER, LINE_KINDS, lineTotals, unconnected } from '@/lib/site/lines';
import { underlayOf, type EditorDoc, type EditorUnderlay } from '@/lib/site/editor/model';
import type { EditorFlags } from '../use-editor-store';
import { EMPTY_MAP } from '../notices';
import { northText } from './north';
import chrome from './panel.module.css';
import styles from './inspector.module.css';
import { outsideText, PlotRopes, PlotTaken, ropeProblems } from './ropes';

interface Problem {
  key: string;
  tone: 'bad' | 'warn';
  text: string;
  ids: string[];
}

function problemsOf(doc: EditorDoc, flags: EditorFlags): Problem[] {
  const labelOf = (id: string) => doc.items.find((entry) => entry.id === id)?.label ?? '';
  return [
    ...doc.items.filter((entry) => flags.outside.has(entry.id)).map((entry): Problem => ({
      key: `outside:${entry.id}`, tone: 'bad', text: `${outsideText(doc, entry)}: ${entry.label}`, ids: [entry.id],
    })),
    ...flags.pairs.map(([a, b]): Problem => ({
      key: `pair:${a}:${b}`, tone: 'warn', text: `חפיפה: ${labelOf(a)} · ${labelOf(b)}`, ids: [a, b],
    })),
    ...doc.items.filter((entry) => flags.partly.has(entry.id)).map((entry): Problem => ({
      key: `edge:${entry.id}`, tone: 'warn', text: `בשולי רשת צל: ${entry.label}`, ids: [entry.id],
    })),
    ...ropeProblems(doc, flags),
  ];
}

/** A name and the figure beside it, as one button that selects what the figure counts. */
function Count({ name, figure, ids, onPickIds, group, swatch }: {
  name: string;
  figure: string;
  ids: string[];
  onPickIds: (ids: string[]) => void;
  group?: SiteKindGroup;
  /** A swatch class of the panel chrome other than a group's: a line kind's. */
  swatch?: string;
}): ReactElement {
  const swatchClass = swatch ?? (group === undefined ? undefined : chrome[`g_${group}`]);
  return (
    <button type="button" className={styles.groupStat} onClick={() => { onPickIds(ids); }}>
      {swatchClass === undefined ? null : <span className={cx(chrome.swatch, swatchClass)} aria-hidden="true" />}
      <span className={styles.groupName}>{name}</span>
      {' '}
      <span className={styles.groupCount}><bdi>{figure}</bdi></span>
    </button>
  );
}

/**
 * The picture's row (spec §18.1): an invitation when there is none, its
 * missing scale, or what it was calibrated from. Each opens the picture's
 * card, since a figure links to what changes it.
 */
function underlayText(underlay: EditorUnderlay | null): string {
  if (underlay === null) return 'העלאת תמונה';
  if (underlay.calibration === null) return 'לא כוילה';
  return `כויל לפי ⁦${formatMetres(underlay.calibration.distanceCm)}⁩`;
}

export function PlotInspector({ doc, flags, plotHref, onPickIds, onUnderlay }: {
  doc: EditorDoc;
  flags: EditorFlags;
  plotHref: string;
  onPickIds: (ids: string[]) => void;
  /** Opens the picture's card (spec §18.1). Without it, no row. */
  onUnderlay?: () => void;
}): ReactElement {
  const { plot, items } = doc;
  const shade = shadeCounts(items.map((entry) => toPlaced(entry, doc.defaults)));
  const netIds = items.filter((entry) => entry.kind === 'shade').map((entry) => entry.id);
  const problems = problemsOf(doc, flags);
  const groups = KIND_GROUP_ORDER
    .map((group) => ({ group, ids: items.filter((entry) => SITE_KINDS[entry.kind].group === group).map((entry) => entry.id) }))
    .filter((entry) => entry.ids.length > 0);
  /* The pipes and cables (`lines.ts`): how many runs and how many metres per
     utility — the figure the camp buys by — and the consumers no run reaches
     yet, each a button that selects what it counts. */
  const totals = lineTotals(doc);
  const utilities = LINE_KIND_ORDER.map((kind) => ({
    kind, total: totals[kind], missing: unconnected(doc, kind),
  })).filter(({ total, missing }) => total.ids.length > 0 || missing.length > 0);

  return (
    <>
      <header className={styles.head}>
        <h2 className={styles.headTitle}>המגרש</h2>
        <span className={styles.headEnd}><SourceChip source={{ kind: 'manual' }} /></span>
      </header>
      <div className={chrome.body}>
        <dl className={styles.kv}>
          <dt>גודל</dt>
          <dd><Link href={plotHref} className={chrome.link}><bdi>{formatSize(plot.widthCm, plot.depthCm)}</bdi></Link></dd>
          <dt>שטח</dt>
          <dd><Link href={plotHref} className={chrome.link}><bdi>{formatArea(areaM2(plot))}</bdi></Link></dd>
          <PlotTaken doc={doc} onPickIds={onPickIds} />
          <dt>רשת הצמדה</dt>
          <dd><Link href={plotHref} className={chrome.link}><bdi>{formatMetres(plot.gridCm)}</bdi></Link></dd>
          <dt>צפון</dt>
          <dd><Link href={plotHref} className={chrome.link}><bdi>{northText(plot.northDeg)}</bdi></Link></dd>
          {onUnderlay === undefined ? null : (
            <>
              <dt>תמונת רקע</dt>
              <dd>
                <button type="button" className={chrome.link} onClick={onUnderlay}>
                  <bdi>{underlayText(underlayOf(doc))}</bdi>
                </button>
              </dd>
            </>
          )}
        </dl>

        <div className={styles.divider} />
        <div className={styles.section}>
          {/* The total beside the heading, not in it, so the heading is named by its words alone. */}
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>מה יש במפה</h3>
            {items.length === 0 ? null : (
              <span className={styles.sectionMeta}>
                <button
                  type="button"
                  className={chrome.link}
                  onClick={() => { onPickIds(items.map((entry) => entry.id)); }}
                >
                  <bdi>{items.length === 1 ? 'פריט אחד' : `${items.length} פריטים`}</bdi>
                </button>
              </span>
            )}
          </div>
          {groups.length === 0 ? (
            <p className={chrome.hint}>{EMPTY_MAP}</p>
          ) : groups.map(({ group, ids }) => (
            <Count
              key={group}
              group={group}
              name={KIND_GROUP_LABELS[group]}
              figure={String(ids.length)}
              ids={ids}
              onPickIds={onPickIds}
            />
          ))}
        </div>

        <div className={styles.divider} />
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>צל</h3>
          {shade.nets === 0 ? (
            <p className={chrome.hint}>אין עדיין רשתות צל. גרירה של רשת צל מהספרייה תוסיף אחת.</p>
          ) : (
            <>
              <Count name="שטח בצל" figure={formatArea(shade.shadedAreaM2)} ids={netIds} onPickIds={onPickIds} />
              <Count name="רשתות צל" figure={String(shade.nets)} ids={netIds} onPickIds={onPickIds} />
              <PlotRopes doc={doc} onPickIds={onPickIds} />
            </>
          )}
          <p className={chrome.hint}>
            רשת של 8 × 8 עם חצי מטר שוליים מצלה על 7 × 7. מה שיושב בשוליים מסומן, כי בשרטוט הוא נראה מכוסה.
          </p>
        </div>

        <div className={styles.divider} />
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            צנרת וכבלים
            <span className={styles.sectionMeta}>אורך על המפה</span>
          </h3>
          {utilities.length === 0 ? (
            <p className={chrome.hint}>
              אין עדיין צינורות או כבלים. בוחרים מיכל מים, מקלחת, כיור, גנרטור, מקרר או תאורה, ובמאפייני הפריט מחברים אותו.
            </p>
          ) : utilities.map(({ kind, total, missing }) => (
            <div key={kind} className={styles.section}>
              {total.ids.length === 0 ? null : (
                <Count
                  name={LINE_KINDS[kind].plural}
                  figure={`${total.ids.length} · ${formatMetres(total.lengthCm)}`}
                  ids={total.ids}
                  onPickIds={onPickIds}
                  swatch={chrome[`l_${kind}`]}
                />
              )}
              {missing.length === 0 ? null : (
                <Count
                  name={`בלי חיבור ל${LINE_KINDS[kind].noun}`}
                  figure={String(missing.length)}
                  ids={missing}
                  onPickIds={onPickIds}
                  swatch={chrome[`l_${kind}`]}
                />
              )}
            </div>
          ))}
          {utilities.length === 0 ? null : (
            <p className={chrome.hint}>
              האורך נמדד מקיר לקיר דרך נקודות הפנייה, בלי רזרבה לגובה, לחיבורים או לרפיון.
            </p>
          )}
        </div>

        <div className={styles.divider} />
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>בדיקות</h3>
          {problems.length === 0 ? (
            <p className={chrome.hint}>הכול בתוך הגדר, ושום דבר לא יושב על משהו אחר.</p>
          ) : problems.map((problem) => (
            <button key={problem.key} type="button" className={styles.issue} onClick={() => { onPickIds(problem.ids); }}>
              <span className={chrome.issueDot} data-tone={problem.tone} aria-hidden="true" />
              <span className={styles.issueText}>{problem.text}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
