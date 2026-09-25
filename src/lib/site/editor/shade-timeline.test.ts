import { describe, it, expect } from 'vitest';
import type { EditorDoc, EditorItem } from './model';
import { CAMP_SITE, jerusalemInstant, shadeAtHour, sunPosition, type ShadeAtHour } from './sun';
import { daylight, shadeRanking, shadeTimeline, shadeWindows, type ShadeSample } from './shade-timeline';

/** 'HH:MM:SS' on the clock as a fractional hour. */
function clock(text: string): number {
  const [h, m, s] = text.split(':').map(Number);
  return h + m / 60 + s / 3600;
}

const TWO_MINUTES = 2 / 60;

/*
 * The oracle. Reference sunrise and sunset at CAMP_SITE (30.6154 N,
 * 34.7988 E), computed 2026-09-25 with the Astronomical Almanac's
 * low-precision solar position (the `almanac` function of the lane's
 * scratchpad `almanac.mjs`), which shares no code with sun.ts's NOAA
 * algorithm. Bisected in UTC to 0.1 s for the disc's centre at −34′
 * geometric (the standard horizontal refraction), which is where sun.ts's
 * refraction-corrected `elevationDeg` reads 0, and read on an Asia/Jerusalem
 * clock through Intl, not through `jerusalemInstant`. For reference only,
 * the published upper-limb sunrise (−50′) on 2026-11-02 is 05:56:06 and the
 * sunset 16:52:14. Geometric 0 would be 06:00:09 and 16:48:11, which is
 * outside the ±2 minutes below. So the horizon choice is tested too.
 */
const REFERENCE = [
  { date: '2026-11-02', rise: '05:57:24', set: '16:50:56' }, // UTC+2: the burn's first day
  { date: '2026-11-07', rise: '06:01:25', set: '16:47:09' }, // UTC+2: its last
  { date: '2026-06-04', rise: '05:39:37', set: '19:38:51' }, // UTC+3: summer time
  // The two days of 2026 the clocks change, at 02:00, before sunrise.
  { date: '2026-03-27', rise: '06:37:32', set: '18:55:20' }, // summer time starts: UTC+3 by sunrise
  { date: '2026-10-25', rise: '05:51:17', set: '16:58:04' }, // summer time ends: UTC+2 by sunrise
] as const;

/** The sun's `elevationDeg` at a fractional clock hour, to the second. */
function elevationAt(date: string, hour: number): number {
  const minute = Math.floor(hour * 60);
  const at = jerusalemInstant(date, minute / 60).getTime() + (hour * 60 - minute) * 60_000;
  return sunPosition(new Date(at), CAMP_SITE.latitude, CAMP_SITE.longitude).elevationDeg;
}

describe('daylight', () => {
  it.each(REFERENCE)('matches the almanac on $date within two minutes', ({ date, rise, set }) => {
    const day = daylight(date);
    expect(day).not.toBeNull();
    expect(Math.abs(day!.rise - clock(rise))).toBeLessThan(TWO_MINUTES);
    expect(Math.abs(day!.set - clock(set))).toBeLessThan(TWO_MINUTES);
  });

  it('agrees with the rough local times the camp lead knows: sunrise near 06:00, sunset near 16:50', () => {
    const day = daylight('2026-11-02')!;
    expect(day.rise).toBeGreaterThan(clock('05:45:00'));
    expect(day.rise).toBeLessThan(clock('06:15:00'));
    expect(day.set).toBeGreaterThan(clock('16:40:00'));
    expect(day.set).toBeLessThan(clock('17:00:00'));
  });

  it('puts rise and set where the sun’s elevation crosses 0, within 30 seconds, sun up at both', () => {
    const halfMinute = 30 / 3600;
    for (const { date } of REFERENCE) {
      const day = daylight(date)!;
      expect(elevationAt(date, day.rise)).toBeGreaterThan(0);
      expect(elevationAt(date, day.rise - halfMinute)).toBeLessThanOrEqual(0);
      expect(elevationAt(date, day.set)).toBeGreaterThan(0);
      expect(elevationAt(date, day.set + halfMinute)).toBeLessThanOrEqual(0);
    }
  });

  it('is null in a polar night and under a midnight sun', () => {
    // At 80° N the sun culminates at 90 − 80 − 23.44 = −13.4° at the December
    // solstice, and bottoms out at 80 + 23.44 − 90 = +13.4° at the June one.
    expect(daylight('2026-12-21', { latitude: 80, longitude: 34.8 })).toBeNull();
    expect(daylight('2026-06-21', { latitude: 80, longitude: 34.8 })).toBeNull();
  });

  it('refuses a date that is not a real day', () => {
    expect(() => daylight('2026-11-2')).toThrow('a shade date must be a real YYYY-MM-DD day');
    expect(() => daylight('2026-02-30')).toThrow('a shade date must be a real YYYY-MM-DD day');
  });
});

function make(over: Partial<EditorItem> & Pick<EditorItem, 'id' | 'kind'>): EditorItem {
  return {
    label: 'x', xCm: 0, yCm: 0, widthCm: 100, depthCm: 100, heightCm: null, insetCm: null,
    sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function docOf(items: EditorItem[]): EditorDoc {
  return { plot: { id: 'p', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, lines: [], defaults: {} };
}

/*
 * One 8 × 8 net at (1000,1000), strip 50, the kind's 3 m cloth: shaded
 * ground 1050–1750 each way. Under its northern edge, a sofa at x 1100–1300
 * and a table at x 1400–1580, both at y 1100–1190.
 *
 * Hand geometry from the almanac (not sun.ts), 2026-11-02 at 11:30 (09:30
 * UTC): the sun stands 44.56° high at azimuth 181.9°, so the cloth's shade
 * falls 10 cm east and 305 cm north: x 1060–1760, y 745–1445, over both. At
 * 06:00 and 16:45 the sun is within a degree of the horizon, and the shade
 * lands hundreds of metres away: both are in the sun.
 */
const NET_DOC = docOf([
  make({ id: 'n', kind: 'shade', xCm: 1000, yCm: 1000, widthCm: 800, depthCm: 800, insetCm: 50 }),
  make({ id: 'sofa', kind: 'sofa', xCm: 1100, yCm: 1100, widthCm: 200, depthCm: 90 }),
  make({ id: 'table', kind: 'table', xCm: 1400, yCm: 1100, widthCm: 180, depthCm: 80 }),
]);

describe('shadeTimeline', () => {
  it('follows the shade as it moves over the day', () => {
    const samples = shadeTimeline(NET_DOC, ['2026-11-02'], 15);
    expect(samples[0].hour).toBe(6);
    expect(samples[0].counts).toEqual({ under: 2, full: 0, partial: 0, sun: 2 });
    expect(samples.find((sample) => sample.hour === 11.5)?.counts).toEqual({ under: 2, full: 2, partial: 0, sun: 0 });
    expect(samples.at(-1)!.hour).toBe(16.75);
    expect(samples.at(-1)!.counts).toEqual({ under: 2, full: 0, partial: 0, sun: 2 });
    for (const { counts } of samples) {
      expect(counts.under).toBe(2);
      expect(counts.full + counts.partial + counts.sun).toBe(2);
    }
  });

  it('counts nothing under nets where there are no nets', () => {
    const doc = docOf([
      make({ id: 'sofa', kind: 'sofa', xCm: 1100, yCm: 1100, widthCm: 200, depthCm: 90 }),
      make({ id: 'tent', kind: 'tent', xCm: 100, yCm: 100, widthCm: 300, depthCm: 300 }),
    ]);
    const samples = shadeTimeline(doc, ['2026-11-02'], 30);
    expect(samples.length).toBeGreaterThan(0);
    for (const { counts } of samples) expect(counts).toEqual({ under: 0, full: 0, partial: 0, sun: 0 });
  });

  it('samples on whole steps of the clock, from the first after sunrise to the last before sunset', () => {
    // From the almanac: 05:57:24 and 16:50:56, ±2 min. Quarter hours: 06:00 to 16:45, 44 samples.
    const quarters = shadeTimeline(NET_DOC, ['2026-11-02'], 15);
    expect(quarters.map(({ hour }) => hour)).toEqual(Array.from({ length: 44 }, (_, i) => 6 + i / 4));
    // Every 20 minutes: 06:00 to 16:40.
    const thirds = shadeTimeline(NET_DOC, ['2026-11-02'], 20);
    expect(thirds[0].hour).toBe(6);
    expect(thirds.at(-1)!.hour).toBeCloseTo(16 + 40 / 60, 12);
    // A step that does not divide the hour still counts from midnight: every 7 minutes.
    const day = daylight('2026-11-02')!;
    const sevens = shadeTimeline(NET_DOC, ['2026-11-02'], 7);
    for (const { hour } of sevens) {
      const minute = hour * 60;
      expect(Math.abs(minute - Math.round(minute))).toBeLessThan(1e-9);
      expect(Math.round(minute) % 7).toBe(0);
      expect(hour).toBeGreaterThanOrEqual(day.rise);
      expect(hour).toBeLessThanOrEqual(day.set);
    }
    expect(sevens[0].hour - 7 / 60).toBeLessThan(day.rise);
    expect(sevens.at(-1)!.hour + 7 / 60).toBeGreaterThan(day.set);
  });

  it('keeps two days in order, each on its own', () => {
    const samples = shadeTimeline(NET_DOC, ['2026-11-02', '2026-11-07'], 15);
    const first = samples.filter(({ date }) => date === '2026-11-02');
    const last = samples.filter(({ date }) => date === '2026-11-07');
    expect(first.length).toBe(44);
    expect(last.length).toBeGreaterThan(40);
    expect(samples).toEqual([...first, ...last]);
    for (let i = 1; i < samples.length; i += 1) {
      const before = samples[i - 1];
      const after = samples[i];
      expect(before.date < after.date || (before.date === after.date && before.hour < after.hour)).toBe(true);
    }
  });

  it('reads the sun at the instant jerusalemInstant gives each clock hour, the days the clocks change included', () => {
    const samples = shadeTimeline(NET_DOC, ['2026-03-27', '2026-10-25', '2026-11-02'], 15);
    expect(new Set(samples.map(({ date }) => date)).size).toBe(3);
    for (const { date, hour, counts } of samples) {
      const sun = sunPosition(jerusalemInstant(date, hour), CAMP_SITE.latitude, CAMP_SITE.longitude);
      expect(counts).toEqual(shadeAtHour(NET_DOC, sun));
    }
  });

  it('returns nothing for no dates', () => {
    expect(shadeTimeline(NET_DOC, [], 15)).toEqual([]);
  });

  it('refuses a step that is not a whole number of minutes above 0', () => {
    for (const step of [0, -15, 7.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => shadeTimeline(NET_DOC, ['2026-11-02'], step)).toThrow('a shade step must be a whole number of minutes above 0');
    }
  });

  it('refuses a date that is not a real day', () => {
    for (const date of ['2026-11-2', '02/11/2026', '2026-13-01', '2026-02-30', '']) {
      expect(() => shadeTimeline(NET_DOC, [date], 15)).toThrow('a shade date must be a real YYYY-MM-DD day');
    }
  });

  it('refuses dates out of order or repeated, rather than reordering them', () => {
    expect(() => shadeTimeline(NET_DOC, ['2026-11-07', '2026-11-02'], 15)).toThrow('shade dates must be in order, each once');
    expect(() => shadeTimeline(NET_DOC, ['2026-11-02', '2026-11-02'], 15)).toThrow('shade dates must be in order, each once');
  });

  /*
   * The simulation fast-forwards the burn: six days at quarter hours with 40
   * items must take under 20 ms. The best of five runs is timed, which a
   * busy machine slows down the least; the bound is the requirement itself.
   */
  it('simulates six days at quarter hours over 40 items in under 20 ms', () => {
    const items: EditorItem[] = [];
    for (let n = 0; n < 4; n += 1) {
      items.push(make({ id: `n${n}`, kind: 'shade', xCm: n * 900, yCm: 0, widthCm: 800, depthCm: 800, insetCm: 50 }));
      for (let k = 0; k < 9; k += 1) {
        items.push(make({
          id: `i${n}-${k}`, kind: 'sofa', xCm: n * 900 + 60 + (k % 3) * 240, yCm: 60 + Math.floor(k / 3) * 240,
          widthCm: 200, depthCm: 90,
        }));
      }
    }
    expect(items.length).toBe(40);
    const doc = docOf(items);
    const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
    let samples: ShadeSample[] = shadeTimeline(doc, dates, 15);
    let best = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 5; run += 1) {
      const start = performance.now();
      samples = shadeTimeline(doc, dates, 15);
      best = Math.min(best, performance.now() - start);
    }
    expect(samples.length).toBeGreaterThan(6 * 40);
    expect(samples.every(({ counts }) => counts.under === 36)).toBe(true);
    console.info(`shadeTimeline: 6 days × 15 min × 40 items, best of 5: ${best.toFixed(2)} ms, ${samples.length} samples`);
    expect(best).toBeLessThan(20);
  });
});

/** A hand-built sample; whatever is not in shade is in the sun. */
function sample(date: string, hour: number, under: number, full: number, partial = 0): ShadeSample {
  const counts: ShadeAtHour = { under, full, partial, sun: under - full - partial };
  return { date, hour, counts };
}

const D1 = '2026-11-02';
const D2 = '2026-11-03';

describe('shadeWindows', () => {
  it('finds a run at the start of the day', () => {
    const samples = [sample(D1, 6, 3, 2), sample(D1, 6.25, 3, 3), sample(D1, 6.5, 3, 1), sample(D1, 6.75, 3, 0)];
    expect(shadeWindows(samples, 'full')).toEqual([{ date: D1, from: 6, to: 6.25 }]);
  });

  it('finds a run at the end of the day', () => {
    const samples = [sample(D1, 16, 3, 0), sample(D1, 16.25, 3, 2), sample(D1, 16.5, 3, 3)];
    expect(shadeWindows(samples, 'full')).toEqual([{ date: D1, from: 16.25, to: 16.5 }]);
  });

  it('finds two runs, a single sample being a window of its own', () => {
    const samples = [
      sample(D1, 8, 2, 2), sample(D1, 8.25, 2, 1), sample(D1, 8.5, 2, 2), sample(D1, 8.75, 2, 2), sample(D1, 9, 2, 0),
    ];
    expect(shadeWindows(samples, 'full')).toEqual([
      { date: D1, from: 8, to: 8 },
      { date: D1, from: 8.5, to: 8.75 },
    ]);
  });

  it('stops a run at the end of the day instead of carrying it across the night', () => {
    const samples = [sample(D1, 16.5, 2, 2), sample(D1, 16.75, 2, 2), sample(D2, 6, 2, 2), sample(D2, 6.25, 2, 0)];
    expect(shadeWindows(samples, 'full')).toEqual([
      { date: D1, from: 16.5, to: 16.75 },
      { date: D2, from: 6, to: 6 },
    ]);
  });

  it('has no windows when nothing stands under a net', () => {
    const samples = [sample(D1, 10, 0, 0), sample(D1, 10.25, 0, 0)];
    expect(shadeWindows(samples, 'full')).toEqual([]);
    expect(shadeWindows(samples, 'any')).toEqual([]);
  });

  it('counts part shade only for "any", and needs strictly more than half', () => {
    const samples = [
      sample(D1, 10, 4, 1, 2), // 1 of 4 in full shade, 3 of 4 in some shade
      sample(D1, 10.25, 4, 2, 0), // exactly half: not most
      sample(D1, 10.5, 4, 2, 1), // full: half; any: 3 of 4
      sample(D1, 10.75, 4, 3, 1), // most, either way
    ];
    expect(shadeWindows(samples, 'full')).toEqual([{ date: D1, from: 10.75, to: 10.75 }]);
    expect(shadeWindows(samples, 'any')).toEqual([
      { date: D1, from: 10, to: 10 },
      { date: D1, from: 10.5, to: 10.75 },
    ]);
  });

  it('has no windows for no samples', () => {
    expect(shadeWindows([], 'any')).toEqual([]);
  });

  it('refuses a kind it does not know', () => {
    expect(() => shadeWindows([sample(D1, 10, 2, 2)], 'partial' as never)).toThrow('a shade window kind must be full or any');
  });

  it('refuses samples out of time order', () => {
    expect(() => shadeWindows([sample(D1, 10.25, 2, 2), sample(D1, 10, 2, 2)], 'full')).toThrow('shade samples must be in time order');
    expect(() => shadeWindows([sample(D2, 6, 2, 2), sample(D1, 16, 2, 2)], 'full')).toThrow('shade samples must be in time order');
  });

  it('reads windows off a simulated day', () => {
    // 11:30 is in full shade (hand geometry above); 06:00 and 16:45 are not.
    const windows = shadeWindows(shadeTimeline(NET_DOC, [D1], 15), 'full');
    expect(windows.length).toBe(1);
    const [only] = windows;
    expect(only.date).toBe(D1);
    expect(only.from).toBeGreaterThan(6);
    expect(only.from).toBeLessThanOrEqual(11.5);
    expect(only.to).toBeGreaterThanOrEqual(11.5);
    expect(only.to).toBeLessThan(16.75);
  });
});

/*
 * The tents ranked by shade (MST). The net is NET_DOC's: 8 × 8 m at
 * (1000,1000), a 3 m cloth, shaded ground 1050–1750 each way. In November
 * the sun never leaves the southern sky (it rises about 108° and sets about
 * 252°), so a net's shade always falls north of it — west of north in the
 * morning, east of north in the afternoon. At 11:30 on 2 November it lies at
 * x 1060–1760, y 745–1445 (the hand geometry above). So, by position alone:
 *
 *   north — 2 × 2 m under the net's northern half (y 1050–1250): in that
 *           noon shade, and the most shaded;
 *   south — across the net's southern edge (y 1600–1800): never shaded.
 *           Shade reaches it only when cast less than 150 cm north
 *           (1750 − 1600), which needs the sun above 63°; on 2 November it
 *           peaks at 44.6° (305 cm north);
 *   west  — beside the net, west of it: shaded only in the morning;
 *   east  — beside the net, east of it: shaded only in the afternoon;
 *   far   — south-east of the net: no shade ever reaches it.
 */
const NET = make({ id: 'n', kind: 'shade', xCm: 1000, yCm: 1000, widthCm: 800, depthCm: 800, insetCm: 50 });
const tent = (id: string, xCm: number, yCm: number) => make({ id, kind: 'tent', label: `אוהל ${id}`, xCm, yCm, widthCm: 200, depthCm: 200 });
const NORTH = tent('north', 1300, 1050);
const SOUTH = tent('south', 1300, 1600);
const WEST = tent('west', 700, 1000);
const EAST = tent('east', 1900, 1000);
const FAR = tent('far', 2200, 2000);

describe('shadeRanking', () => {
  /** A tent's three counts, to pin a known answer whole. */
  const countsOf = (ranking: ReturnType<typeof shadeRanking>, id: string) => {
    const found = ranking.find((entry) => entry.id === id);
    if (found === undefined) throw new Error(`no ${id} in the ranking`);
    return { shaded: found.shadedMinutes, full: found.fullMinutes, partial: found.partialMinutes };
  };

  it('ranks the tents by their minutes in shade, the most shaded first', () => {
    const ranking = shadeRanking(docOf([NET, SOUTH, FAR, NORTH]), [D1], 15);
    expect(ranking.map(({ id }) => id)).toEqual(['north', 'south', 'far']);
    // Pinned (sim-2-report, MST): four hours of full shade and two of part shade, to 15:00.
    expect(countsOf(ranking, 'north')).toEqual({ shaded: 300, full: 240, partial: 120 });
    // …and the day's own entry says the same, with part shade counted half there too.
    expect(ranking[0].days).toEqual([{ date: D1, shadedMinutes: 300, fullMinutes: 240, partialMinutes: 120, untilSunset: false }]);
    expect(countsOf(ranking, 'south')).toEqual({ shaded: 0, full: 0, partial: 0 });
    expect(countsOf(ranking, 'far')).toEqual({ shaded: 0, full: 0, partial: 0 });
    expect(ranking[0].label).toBe('אוהל north');
  });

  it('counts full-shade minutes whole and part-shade minutes as half', () => {
    const ranking = shadeRanking(docOf([NET, NORTH, SOUTH, WEST]), [D1], 15);
    for (const entry of ranking) {
      expect(entry.shadedMinutes).toBe(entry.fullMinutes + entry.partialMinutes / 2);
      // Sunrise to 15:00 is 06:00–15:00 on the quarter-hour grid: nine hours at most.
      expect(entry.fullMinutes + entry.partialMinutes).toBeLessThanOrEqual(9 * 60);
    }
    expect(ranking.find(({ id }) => id === 'north')!.fullMinutes).toBeGreaterThan(0);
  });

  it('agrees, sample for sample, with the shade the timeline counts under the net', () => {
    // NORTH alone under the net: the timeline's full and part counts are its own.
    const doc = docOf([NET, NORTH]);
    let expected = 0;
    for (const { hour, counts } of shadeTimeline(doc, [D1], 15)) {
      if (hour < 15) expected += counts.full * 15 + counts.partial * 7.5;
    }
    expect(expected).toBeGreaterThan(0);
    expect(shadeRanking(doc, [D1], 15)[0].shadedMinutes).toBe(expected);
  });

  it('counts only from sunrise to the end hour: the morning’s tent, then the afternoon’s', () => {
    const doc = docOf([NET, WEST, EAST]);
    const toNoon = shadeRanking(doc, [D1], 15, { endHour: 12 });
    const toAfternoon = shadeRanking(doc, [D1], 15, { endHour: 15 });
    const toEvening = shadeRanking(doc, [D1], 15, { endHour: 17 });
    expect(toNoon.map(({ id }) => id)).toEqual(['west', 'east']);
    // Pinned (sim-2-report, MST): the west tent's shade is all before noon; the east tent's all after it.
    for (const ranking of [toNoon, toAfternoon, toEvening]) {
      expect(countsOf(ranking, 'west')).toEqual({ shaded: 135, full: 90, partial: 90 });
    }
    expect(countsOf(toNoon, 'east')).toEqual({ shaded: 0, full: 0, partial: 0 });
    expect(countsOf(toAfternoon, 'east')).toEqual({ shaded: 97.5, full: 60, partial: 75 });
    expect(countsOf(toEvening, 'east')).toEqual({ shaded: 135, full: 90, partial: 90 });
  });

  /*
   * A net 2 km across, centred on a tent: its shade covers the tent whenever
   * the sun is up at all — a 3 m cloth throws its shade under 1 km once the
   * sun is 0.17° high, and at 06:00, 2½ minutes after sunrise, it is about
   * half a degree up. So every sample from 06:00 is full shade, and what the
   * end hour and sunset do to the count is all there is to see.
   */
  const WIDE = make({ id: 'wide', kind: 'shade', xCm: -100_000, yCm: -100_000, widthCm: 200_000, depthCm: 200_000, insetCm: 50 });
  const MIDDLE = tent('middle', -100, -100);

  it('stops the last sample at sunset when the end hour is later — about six minutes, not fifteen', () => {
    const doc = docOf([WIDE, MIDDLE]);
    const set = daylight(D1)!.set;
    const [toEvening] = shadeRanking(doc, [D1], 15, { endHour: 17 });
    // 06:00 to 16:30 is 43 whole quarter hours; then 16:45 to sunset (16:50:56 by the almanac, ±2 min).
    expect(toEvening.fullMinutes).toBeCloseTo(43 * 15 + (set * 60 - (16 * 60 + 45)), 9);
    expect(toEvening.fullMinutes - 43 * 15).toBeGreaterThan(4);
    expect(toEvening.fullMinutes - 43 * 15).toBeLessThan(8);
    expect(toEvening.partialMinutes).toBe(0);
    // Later end hours stop at the same sunset.
    expect(shadeRanking(doc, [D1], 15, { endHour: 23 })[0].fullMinutes).toBe(toEvening.fullMinutes);
    // An end hour before sunset is whole steps: 06:00 to 15:00.
    expect(shadeRanking(doc, [D1], 15, { endHour: 15 })[0].fullMinutes).toBe(540);
  });

  it('says for each day whether the count stopped at sunset rather than at the end hour', () => {
    const doc = docOf([WIDE, MIDDLE]);
    expect(shadeRanking(doc, [D1, D2], 15, { endHour: 17 })[0].days.map(({ untilSunset }) => untilSunset)).toEqual([true, true]);
    expect(shadeRanking(doc, [D1, D2], 15, { endHour: 15 })[0].days.map(({ untilSunset }) => untilSunset)).toEqual([false, false]);
  });

  it('sums the days of the burn, and keeps each day’s own count', () => {
    const doc = docOf([NET, NORTH]);
    const [both] = shadeRanking(doc, [D1, D2], 15);
    const [first] = shadeRanking(doc, [D1], 15);
    const [second] = shadeRanking(doc, [D2], 15);
    expect(both.days.map(({ date }) => date)).toEqual([D1, D2]);
    expect(both.days[0]).toEqual(first.days[0]);
    expect(both.days[1]).toEqual(second.days[0]);
    expect(both.shadedMinutes).toBe(first.shadedMinutes + second.shadedMinutes);
  });

  it('has nothing to rank without tents, and ranks every tent at no shade without nets', () => {
    expect(shadeRanking(docOf([NET, make({ id: 'sofa', kind: 'sofa' })]), [D1], 15)).toEqual([]);
    const bare = shadeRanking(docOf([NORTH, SOUTH]), [D1], 15);
    expect(bare.map(({ id, shadedMinutes }) => [id, shadedMinutes])).toEqual([['north', 0], ['south', 0]]);
  });

  it('refuses an end hour that is not an hour of the day, and dates and steps as the timeline does', () => {
    for (const endHour of [0, -1, 24.5, Number.NaN]) {
      expect(() => shadeRanking(docOf([NET, NORTH]), [D1], 15, { endHour })).toThrow('a shade end hour must be an hour of the day');
    }
    expect(() => shadeRanking(docOf([NET, NORTH]), ['2026-02-30'], 15)).toThrow('a shade date must be a real YYYY-MM-DD day');
    expect(() => shadeRanking(docOf([NET, NORTH]), [D1], 0)).toThrow('a shade step must be a whole number of minutes above 0');
  });
});
