import type { TaskKind } from '@/db/schema/camp';

/**
 * The singular Hebrew name of each kind — "משמרת", not "משמרות".
 *
 * A `Record<TaskKind, string>` makes tsc the exhaustiveness check, so a fifth
 * kind cannot be added without naming it here.
 *
 * **Consolidation debt, recorded rather than paid here.** Three other maps of
 * the same idea exist today: `src/app/(admin)/tasks/rows.ts` holds `KIND_LABELS`
 * (plural, for group headings) and `KIND_ROW_LABELS` (singular, in a different
 * register — `משימת הקמה`, `אחריות על סעיף תקציב`), and
 * `src/app/(admin)/members/[id]/page.tsx` holds a fourth, typed
 * `Record<string, string>` so it is not exhaustiveness-checked at all. The
 * spellings below match that last one. Both screens belong to other plans, so
 * folding them in is D9's to do when it rewrites the task board — this file is
 * the library home they should fold into, not a fourth dialect meant to stay.
 */
export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  shift: 'משמרת',
  event_task: 'משימה באירוע',
  deliverable: 'אחריות תקציבית',
  build: 'הקמה ולוגיסטיקה',
};
