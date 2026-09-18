import type { TaskKind } from '@/db/schema/camp';

/**
 * The library home for task-kind labels (A39). Four maps of this idea used to
 * exist across three files; they are all here now.
 *
 * They are three *registers*, not three copies — which is why the fix is three
 * exports rather than one. A group heading counts things and is plural; a
 * row's second line is written out at length; a kind named on its own is
 * singular and short. Collapsing them into one map would have made some screen
 * read `אחריות תקציבית` where it used to say `אחריות על סעיף תקציב`, which is
 * a copy change dressed up as a refactor.
 *
 * What was actually wrong was the distribution: one of the four lived in
 * `members/[id]/page.tsx` typed `Record<string, string>`, so a fifth `TaskKind`
 * could be added and that screen would silently render the raw enum value. Every
 * map here is `Record<TaskKind, string>`, which makes tsc the exhaustiveness
 * check. `labels.test.ts` nets the repo for a fifth copy appearing.
 */

/** The kind on its own, singular: a person's responsibility list, a chip. */
export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  shift: 'משמרת',
  event_task: 'משימה באירוע',
  deliverable: 'אחריות תקציבית',
  build: 'הקמה ולוגיסטיקה',
};

/** A group heading over a list of them, so plural: D9's task board. */
export const TASK_KIND_GROUP_LABELS: Record<TaskKind, string> = {
  build: 'הקמה ולוגיסטיקה',
  shift: 'משמרות',
  event_task: 'משימות באירועים',
  deliverable: 'אחריות תקציבית',
};

/** A task row's own second line, under its title — the longest register. */
export const TASK_KIND_ROW_LABELS: Record<TaskKind, string> = {
  build: 'משימת הקמה',
  shift: 'משמרת',
  event_task: 'משימה באירוע',
  deliverable: 'אחריות על סעיף תקציב',
};
