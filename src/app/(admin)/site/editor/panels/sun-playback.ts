/**
 * Shade by hour, played (ruling SIM2): the hours of a day, or of every day of
 * the burn back to back, fast-forwarded so the lead can watch when the nets
 * shade what stands under them. The first half is the arithmetic, pure: where
 * daylight begins and ends each day, and where a moment stands in a scope
 * measured in minutes of daylight — the nights are not in it, so playback
 * goes from one sunset to the next sunrise. The second half is the clock that
 * moves through it, on the browser's animation frames.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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

/* ── the clock ────────────────────────────────────────────────────────── */

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(REDUCED_MOTION);
  media.addEventListener('change', onChange);
  return () => { media.removeEventListener('change', onChange); };
}

function readReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;
}

/** The server cannot know; it assumes motion, and the client corrects it. */
function serverReducedMotion(): boolean {
  return false;
}

/** Whether the reader asked the system for less motion — read live, as the page's theme is. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, serverReducedMotion);
}

/**
 * How often, at most, playback hands a new hour up: about ten times a second.
 * Every frame moves the clock, but a commit re-renders the whole editor (and
 * re-lights the scene), and sixty of those a second would buy nothing the eye
 * can follow on a sun that moves a few minutes a frame.
 */
export const COMMIT_MS = 100;

/**
 * The most real time one frame may move the clock by. A tab in the background
 * gets no frames, and the first one back comes a minute late: counted in
 * full, playback would leap from morning to sunset. Counted up to this, it
 * picks up where the lead left it.
 */
export const MAX_FRAME_MS = 100;

/** A committed hour is a whole minute: the text and the scene never show a fraction of one. */
function toMinute(moment: Moment): Moment {
  return { day: moment.day, hour: Math.round(moment.hour * 60) / 60 };
}

export interface Playback {
  playing: boolean;
  /** Plays from `at`, or from the scope's start when `at` is already its end. */
  play: (at: Moment) => void;
  pause: () => void;
}

/**
 * Plays through `spans` at `minutesPerSecond`, on `requestAnimationFrame`,
 * handing each new moment to `onMoment` at most every `COMMIT_MS` — or, with
 * motion reduced, once a second in whole quarter hours. It stops at the
 * scope's end.
 *
 * Playback belongs to the scope it began in, named by `scopeKey` — its days,
 * as text. A new scope (another day, or the burn instead of a day) is another
 * key, so playing is false the moment the scope changes: derived, with no
 * effect to set it. The spans are read through the key, never by the array's
 * identity, so a caller that builds them afresh does not stop or restart the
 * clock. The frame is cancelled on pause, on unmount and on any change of
 * scope, speed or motion setting; a change of speed or motion picks up from
 * where the clock had got to.
 */
export function usePlayback({ scopeKey, spans, minutesPerSecond, reduced, onMoment }: {
  /** The scope's days, as text: the same days, the same key. */
  scopeKey: string;
  spans: readonly DaySpan[];
  minutesPerSecond: number;
  reduced: boolean;
  onMoment: (moment: Moment) => void;
}): Playback {
  const [playingIn, setPlayingIn] = useState<string | null>(null);
  const playing = playingIn !== null && playingIn === scopeKey;
  /** Minutes into the scope, as of the last frame. Written by the clock and by `play`; read when the clock (re)starts. */
  const position = useRef(0);
  /** Bumped by every pause and every start: a frame from a clock no longer running does nothing. */
  const generation = useRef(0);
  const report = useRef(onMoment);
  /** The spans of the scope `scopeKey` names, as of the last render. */
  const scope = useRef(spans);
  useEffect(() => {
    report.current = onMoment;
    scope.current = spans;
  });

  useEffect(() => {
    if (!playing) return undefined;
    generation.current += 1;
    const mine = generation.current;
    const spansNow = scope.current;
    const total = scopeLength(spansNow);
    const step = reducedStep(minutesPerSecond);
    const from = reduced ? Math.round(position.current / QUARTER) * QUARTER : position.current;
    let frame = 0;
    let last: number | null = null;
    let elapsed = 0;
    let committedAt = 0;
    let committed = from;

    const tick = (now: number): void => {
      if (generation.current !== mine) return;
      if (last === null) committedAt = now;
      else elapsed += Math.min(MAX_FRAME_MS, Math.max(0, now - last));
      last = now;
      const advanced = reduced
        ? from + Math.floor(elapsed / 1000) * step
        : from + (elapsed / 1000) * minutesPerSecond;
      const at = Math.min(total, advanced);
      position.current = at;
      const ended = at >= total;
      if (at !== committed && (ended || reduced || now - committedAt >= COMMIT_MS)) {
        committed = at;
        committedAt = now;
        report.current(toMinute(momentAt(spansNow, at)));
      }
      if (ended) {
        generation.current += 1;
        setPlayingIn(null);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); };
  }, [playing, scopeKey, minutesPerSecond, reduced]);

  function play(at: Moment): void {
    const total = scopeLength(spans);
    if (total <= 0) return;
    let start = positionOf(spans, at.day, at.hour);
    if (start >= total) {
      start = 0;
      onMoment(momentAt(spans, 0));
    }
    position.current = start;
    setPlayingIn(scopeKey);
  }

  function pause(): void {
    generation.current += 1;
    setPlayingIn(null);
  }

  return { playing, play, pause };
}
