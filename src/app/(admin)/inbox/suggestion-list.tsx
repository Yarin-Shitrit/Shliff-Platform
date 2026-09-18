import type { ReactElement } from 'react';
import type { NameSuggestion, MatchConfidence } from '@/lib/members/suggest';
import type { InboxAction } from '@/lib/inbox/items';
import { Pill, type PillTone } from '@/components/ui/pill';
import styles from './inbox.module.css';

/**
 * Ruling 5: confidence is a word, never a number.
 *
 * The tone carries no meaning a colour-blind reader needs — the word does
 * (R3) — and no percentage is rendered anywhere in this component. A test
 * scans the whole rendered panel for a digit-and-percent to keep it that way,
 * because the cheap way to "improve" this panel is to put the score back.
 */
const CONFIDENCE_TONE: Record<MatchConfidence, PillTone> = {
  'חזקה': 'ok',
  'אפשרית': 'neutral',
  'חלשה': 'outline',
};

export function SuggestionList({
  suggestions, actions,
}: { suggestions: NameSuggestion[]; actions: InboxAction[] }): ReactElement {
  const links = actions.filter((action) => action.kind === 'link-name');

  return (
    <section className={styles.panel}>
      <div className={styles.sectionTitle}>מי זה יכול להיות</div>
      {suggestions.length === 0 ? (
        <p className={styles.muted}>אין מועמדים. אפשר ליצור אדם חדש או לחפש ידנית.</p>
      ) : (
        <ul className={styles.suggestions}>
          {suggestions.map((suggestion, index) => {
            const action = links[index];
            return (
              <li key={suggestion.personId} className={styles.suggestion}>
                <span className={styles.suggestionName}>{suggestion.displayName}</span>
                <Pill tone={CONFIDENCE_TONE[suggestion.confidence]}>{suggestion.confidence}</Pill>
                <ul className={styles.reasons}>
                  {suggestion.reasons.map((reason) => (
                    <li key={reason.key}>
                      <Pill tone="outline">{reason.label}</Pill>
                    </li>
                  ))}
                </ul>
                {action?.digit === null || action === undefined ? null : (
                  <span className={styles.kbd} aria-hidden="true">{action.digit}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
