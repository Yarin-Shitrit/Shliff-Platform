/**
 * The two components that put a figure on a screen.
 *
 * Both do one thing: open a bidi isolate around a string that the library
 * already formatted. Nothing here decides what an amount or a date looks
 * like — `src/lib/money.ts` and `src/lib/dates.ts` do — and nothing anywhere
 * else opens the isolate.
 *
 * Server components. A figure is not interactive.
 */

import { formatShekels } from '@/lib/money';
import {
  formatDateShort, formatDateFull, formatDateProse, formatTime, formatDateTime,
} from '@/lib/dates';

/** A11: `1,200 ₪`, symbol last, sign welded to the digits, isolated. */
export function Money({ agorot }: { agorot: number }) {
  return <bdi>{formatShekels(agorot)}</bdi>;
}

export type DateForm = 'short' | 'full' | 'prose' | 'time' | 'datetime';

const FORMS: Record<DateForm, (at: Date) => string> = {
  short: formatDateShort,
  full: formatDateFull,
  prose: formatDateProse,
  time: formatTime,
  datetime: formatDateTime,
};

/** A12. `short` is the table form, which is where most dates are. */
export function DateText({ at, form = 'short' }: { at: Date; form?: DateForm }) {
  return <bdi>{FORMS[form](at)}</bdi>;
}
