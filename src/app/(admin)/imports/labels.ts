import type { BlockArchetype } from '@/lib/classify/types';
import type { BlockState } from '@/lib/import/register';
import type { PillTone } from '@/components/ui/pill';

/**
 * Moved verbatim out of `block-card.tsx` (E5), which Task 15 deleted along
 * with its private copy of this record. This is now the only one: the rail,
 * the detail pane and the archetype picker all read it from here.
 */
export const ARCHETYPE_LABELS: Record<BlockArchetype, string> = {
  ledger: 'תנועות קופה',
  budget_lines: 'שורות תקציב',
  event_lines: 'הוצאות והכנסות אירוע',
  ticket_rounds: 'סבבי כרטיסים',
  income_channels: 'ערוצי הכנסה',
  member_dues: 'דמי קאמפ',
  obligations: 'חובות וקיזוזים',
  account_balances: 'יתרות בקופות',
  unknown: 'לא זוהה',
};

/**
 * Every state carries a word, never colour alone (R3). `blocked` is the only
 * one that points elsewhere: a sheet awaiting a season or an authority
 * decision is a לטיפול item, and this screen links to it rather than growing
 * a second decision surface.
 *
 * `PillTone` is imported from the kit rather than re-declared, so a tone this
 * record names is a tone `Pill` can actually render.
 */
export const BLOCK_STATE_LABELS: Record<BlockState, { text: string; tone: PillTone }> = {
  'needs-review': { text: 'לבדיקה', tone: 'brand' },
  recognised: { text: 'זוהה', tone: 'neutral' },
  confirmed: { text: 'אושר', tone: 'ok' },
  promoted: { text: 'קודם', tone: 'ok' },
  'no-promoter': { text: 'אין מנגנון', tone: 'outline' },
  superseded: { text: 'עותק לא נבחר', tone: 'neutral' },
  blocked: { text: 'ממתין להחלטה', tone: 'warn' },
};
