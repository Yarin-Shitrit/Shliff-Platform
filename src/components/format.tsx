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

/**
 * A11: `1,200 ₪`, symbol last, sign welded to the digits, isolated — and now
 * pinned `ltr` explicitly.
 *
 * That pin is a no-op today. `<bdi>` with no `dir` is `dir=auto`, and `auto`
 * resolves `ltr` whenever the string has no character of bidi class L, AL or
 * R — it does not fall back to the parent's `direction: rtl`. Every string
 * `formatShekels` produces, positive or negative, is digits, punctuation and
 * `₪`, none of which is a strong character, so it was already resolving
 * `ltr` on its own. Measured in Chromium: the positive amount and the
 * LRM-led negative amount both compute `direction: ltr` and render digits to
 * the left of `₪`, with or without this attribute.
 *
 * `dir="ltr"` is added anyway, as defence: `formatShekels` is declared the
 * one place an amount gets its symbol, and the guarantee should be explicit
 * rather than emergent from "these strings happen to contain no strong
 * character." The day it emits a Hebrew abbreviation (`1,200 ש״ח`) instead of
 * the `₪` glyph, `dir=auto` would flip the whole run to RTL and reorder the
 * digits; `dir="ltr"` costs nothing and prevents that. `dir` does not remove
 * the isolation — `unicode-bidi: isolate` on `<bdi>` comes from the UA
 * stylesheet regardless of `dir`.
 *
 * `formatShekels` does not emit the LRM itself to get this guarantee: a
 * control character in the string would land in `.length`, in string
 * comparisons and in any CSV export.
 */
export function Money({ agorot }: { agorot: number }) {
  return <bdi dir="ltr">{formatShekels(agorot)}</bdi>;
}

export type DateForm = 'short' | 'full' | 'prose' | 'time' | 'datetime';

const FORMS: Record<DateForm, (at: Date) => string> = {
  short: formatDateShort,
  full: formatDateFull,
  prose: formatDateProse,
  time: formatTime,
  datetime: formatDateTime,
};

/**
 * A12. `short` is the table form, which is where most dates are.
 *
 * `short`, `full`, `time` and `datetime` get the same explicit `dir="ltr"` as
 * `Money`, for the same reason — see the note above it: a no-op defence
 * today, since none of those forms produce a strong bidi character, made
 * explicit so the guarantee does not depend on that staying true. `prose`
 * (`7 בספט׳ 2026`) is left with no `dir`: it contains Hebrew letters, which
 * are bidi class R, so `dir=auto` already resolves it `rtl` correctly on its
 * own, and forcing `ltr` on it would break it.
 */
export function DateText({ at, form = 'short' }: { at: Date; form?: DateForm }) {
  return <bdi dir={form === 'prose' ? undefined : 'ltr'}>{FORMS[form](at)}</bdi>;
}
