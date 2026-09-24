/**
 * Shade by hour, played (ruling SIM2): the hours of a day, or of every day of
 * the burn back to back, fast-forwarded so the lead can watch when the nets
 * shade what stands under them. This half is the arithmetic, pure: where
 * daylight begins and ends each day, and where a moment stands in a scope
 * measured in minutes of daylight — the nights are not in it, so playback
 * goes from one sunset to the next sunrise.
 */

import { daylight } from '@/lib/site/editor/shade-timeline';

/** A day's daylight on the quarter-hour grid: the first and last quarter hours the sun is up, inclusive. */
export interface DaySpan {
  day: string;
  from: number;
  to: number;
}

export interface Moment {
  day: string;
  /** A fractional clock hour: 14.25 is 14:15. */
  hour: number;
}

/** Simulated minutes per real second, named for the lead. */
export const SPEEDS = [
  { id: 'slow', label: 'איטי', minutesPerSecond: 10 },
  { id: 'normal', label: 'רגיל', minutesPerSecond: 30 },
  { id: 'fast', label: 'מהיר', minutesPerSecond: 90 },
] as const;

export type SpeedId = (typeof SPEEDS)[number]['id'];

const QUARTER = 15;

/**
 * The quarter hours of `day` with the sun up, by `daylight` — the same first
 * and last quarter hours `shadeTimeline` samples at a 15-minute step, so the
 * slider, the strip and playback share one grid. Null when the day has no
 * single sunrise and sunset (never at the camp).
 */
export function daySpan(day: string): DaySpan | null {
  const light = daylight(day);
  if (light === null) return null;
  const from = (Math.ceil((light.rise * 60) / QUARTER) * QUARTER) / 60;
  const to = (Math.floor((light.set * 60) / QUARTER) * QUARTER) / 60;
  return from <= to ? { day, from, to } : null;
}

function minutesOf(span: DaySpan): number {
  return (span.to - span.from) * 60;
}

/** The minutes of daylight in the scope — its nights not among them. */
export function scopeLength(spans: readonly DaySpan[]): number {
  return spans.reduce((total, span) => total + minutesOf(span), 0);
}

/**
 * Where a moment stands in the scope, in minutes of daylight from its start.
 * An hour before sunrise or after sunset stands at that day's edge; a day
 * outside the scope stands at its start.
 */
export function positionOf(spans: readonly DaySpan[], day: string, hour: number): number {
  let before = 0;
  for (const span of spans) {
    if (span.day === day) return before + (Math.min(span.to, Math.max(span.from, hour)) - span.from) * 60;
    before += minutesOf(span);
  }
  return 0;
}

/**
 * The moment `position` minutes into the scope. A day's last quarter hour is
 * that day's; the minute after it is the next day's sunrise. Clamped to the
 * scope, which must hold at least one day.
 */
export function momentAt(spans: readonly DaySpan[], position: number): Moment {
  let left = Math.max(0, position);
  for (const span of spans) {
    const length = minutesOf(span);
    if (left <= length) return { day: span.day, hour: span.from + left / 60 };
    left -= length;
  }
  const last = spans[spans.length - 1];
  return { day: last.day, hour: last.to };
}

/**
 * With motion reduced, playback jumps once a second instead of gliding: by
 * the speed's minutes, in whole quarter hours — at least one.
 */
export function reducedStep(minutesPerSecond: number): number {
  return Math.max(1, Math.round(minutesPerSecond / QUARTER)) * QUARTER;
}
