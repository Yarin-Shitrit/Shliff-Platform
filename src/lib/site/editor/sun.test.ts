import { describe, it, expect } from 'vitest';
import type { EditorDoc, EditorItem } from './model';
import {
  CAMP_SITE, jerusalemInstant, mapDirection, shadeAtHour, shadowOffset, sunDirection, sunPosition,
  type SunPosition,
} from './sun';

const { latitude, longitude } = CAMP_SITE;

/** The sun at the camp site over one UTC day, minute by minute, and the moment it stands highest. */
function highestOn(date: string): { at: Date; sun: SunPosition } {
  const start = Date.parse(`${date}T00:00:00Z`);
  let best = { at: new Date(start), sun: sunPosition(new Date(start), latitude, longitude) };
  for (let minute = 1; minute < 1440; minute += 1) {
    const at = new Date(start + minute * 60_000);
    const sun = sunPosition(at, latitude, longitude);
    if (sun.elevationDeg > best.sun.elevationDeg) best = { at, sun };
  }
  return best;
}

/** The day's highest sun, sampled through Jerusalem clock hours 10–14 at one-minute resolution. */
function highestByClock(date: string): SunPosition {
  let best: SunPosition | null = null;
  for (let i = 0; i <= 240; i += 1) {
    const h = 10 + i / 60;
    const sun = sunPosition(jerusalemInstant(date, h), latitude, longitude);
    if (best === null || sun.elevationDeg > best.elevationDeg) best = sun;
  }
  return best as SunPosition;
}

describe('the clock in Asia/Jerusalem', () => {
  it('is UTC+3 in summer time and UTC+2 after it ends on 2026-10-25', () => {
    expect(jerusalemInstant('2026-07-01', 12).toISOString()).toBe('2026-07-01T09:00:00.000Z');
    expect(jerusalemInstant('2026-10-24', 12).toISOString()).toBe('2026-10-24T09:00:00.000Z');
    expect(jerusalemInstant('2026-10-25', 12).toISOString()).toBe('2026-10-25T10:00:00.000Z');
    expect(jerusalemInstant('2026-12-01', 12).toISOString()).toBe('2026-12-01T10:00:00.000Z');
  });

  it('starts summer time on the Friday before the last Sunday of March', () => {
    expect(jerusalemInstant('2026-03-26', 12).toISOString()).toBe('2026-03-26T10:00:00.000Z');
    expect(jerusalemInstant('2026-03-27', 12).toISOString()).toBe('2026-03-27T09:00:00.000Z');
  });

  it('takes a fractional hour as minutes', () => {
    expect(jerusalemInstant('2026-10-22', 14.25).toISOString()).toBe('2026-10-22T11:15:00.000Z');
    expect(jerusalemInstant('2026-10-22', 7).toISOString()).toBe('2026-10-22T04:00:00.000Z');
  });

  it('refuses a date it cannot read', () => {
    expect(() => jerusalemInstant('22/10/2026', 12)).toThrow('a sun date must be YYYY-MM-DD');
  });
});

describe('the sun over the camp', () => {
  /*
   * Physically grounded checks. At local noon the sun stands 90° − latitude +
   * declination high, due south. The declination is +23.44° at the June
   * solstice, −23.44° at the December one, and about −11.1° on 22 October;
   * the latitude is 30.6154°. Noon comes 4 minutes earlier per degree east of
   * Greenwich (34.7988° → 139 min before 12:00 UTC) and earlier again by the
   * equation of time, about 15½ minutes in late October.
   */
  it('stands about 48° high, due south, near 09:25 UTC on 2026-10-22', () => {
    const { at, sun } = highestOn('2026-10-22');
    expect(sun.elevationDeg).toBeGreaterThan(90 - 30.6154 - 11.1 - 1.5);
    expect(sun.elevationDeg).toBeLessThan(90 - 30.6154 - 11.1 + 1.5);
    expect(Math.abs(sun.azimuthDeg - 180)).toBeLessThan(3);
    const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
    expect(minutes).toBeGreaterThanOrEqual(9 * 60 + 15);
    expect(minutes).toBeLessThanOrEqual(9 * 60 + 35);
  });

  it('stands 82.8° high at the June solstice and 35.9° at the December one', () => {
    expect(highestOn('2026-06-21').sun.elevationDeg).toBeCloseTo(90 - 30.6154 + 23.44, 0);
    expect(highestOn('2026-12-21').sun.elevationDeg).toBeCloseTo(90 - 30.6154 - 23.44, 0);
  });

  it('stands 90° − latitude high at the March equinox', () => {
    expect(highestOn('2026-03-20').sun.elevationDeg).toBeCloseTo(90 - 30.6154, 0);
  });

  it('is east in the morning, west in the afternoon, and down at midnight', () => {
    const morning = sunPosition(jerusalemInstant('2026-10-22', 10), latitude, longitude);
    const afternoon = sunPosition(jerusalemInstant('2026-10-22', 15), latitude, longitude);
    const midnight = sunPosition(jerusalemInstant('2026-10-22', 0), latitude, longitude);
    expect(morning.azimuthDeg).toBeGreaterThan(90);
    expect(morning.azimuthDeg).toBeLessThan(180);
    expect(morning.elevationDeg).toBeGreaterThan(0);
    expect(afternoon.azimuthDeg).toBeGreaterThan(180);
    expect(afternoon.azimuthDeg).toBeLessThan(270);
    expect(afternoon.elevationDeg).toBeGreaterThan(0);
    expect(midnight.elevationDeg).toBeLessThan(0);
  });
});

/*
 * Controller ruling: fixed astronomical checks at CAMP_SITE, against
 * published constants independent of this implementation — not ranges
 * derived from the code under test. Culmination h = 90° − φ + δ at the camp
 * (φ = 30.6154°), with the published declination δ = +23.44° at the June
 * solstice and 0° at the March equinox: 82.82° and 59.38°. Beyond that
 * derivation this claims no more independence than the ruling states. "The
 * day's highest elevation" is found by sampling Jerusalem clock hours 10–14
 * at one-minute resolution, exactly as the ruling specifies; `jerusalemInstant`
 * resolves the UTC+3 (June) and UTC+2 (March) offsets on its own.
 */
describe('against published values', () => {
  it('June solstice 2026-06-21: elevation 82.82° ± 0.5°, azimuth 180° ± 2°', () => {
    const sun = highestByClock('2026-06-21');
    expect(sun.elevationDeg).toBeGreaterThan(82.82 - 0.5);
    expect(sun.elevationDeg).toBeLessThan(82.82 + 0.5);
    expect(Math.abs(sun.azimuthDeg - 180)).toBeLessThan(2);
  });

  it('March equinox 2026-03-20: elevation 59.38° ± 0.6°, azimuth 180° ± 2°', () => {
    const sun = highestByClock('2026-03-20');
    expect(sun.elevationDeg).toBeGreaterThan(59.38 - 0.6);
    expect(sun.elevationDeg).toBeLessThan(59.38 + 0.6);
    expect(Math.abs(sun.azimuthDeg - 180)).toBeLessThan(2);
  });
});

describe('directions on the map', () => {
  it('turns compass bearings into map vectors, with north up', () => {
    expectPair(mapDirection(0, 0), [0, -1]);
    expectPair(mapDirection(90, 0), [1, 0]);
    expectPair(mapDirection(180, 0), [0, 1]);
  });

  it('follows the plot’s north when the map is turned', () => {
    // The map's up points east: east is up, and north is to the left.
    expectPair(mapDirection(90, 90), [0, -1]);
    expectPair(mapDirection(0, 90), [-1, 0]);
  });

  it('points at the sun, up and across', () => {
    const toward = sunDirection({ azimuthDeg: 180, elevationDeg: 45 }, 0);
    expectPair(toward, [0, Math.SQRT1_2, Math.SQRT1_2]);
    expect(Math.hypot(...toward)).toBeCloseTo(1, 12);
  });
});

function expectPair(actual: readonly number[], expected: readonly number[]): void {
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 9));
}

describe('shadows', () => {
  it('fall away from the sun, height · cot(elevation) long', () => {
    // Sun due south at 45°: a 3 m cloth casts its shade 3 m north.
    const south = shadowOffset({ azimuthDeg: 180, elevationDeg: 45 }, 0, 300);
    expectPair([south!.dxCm, south!.dyCm], [0, -300]);
    // Sun due east at 30°: cot 30° = √3, so 1 m casts √3 m west.
    const east = shadowOffset({ azimuthDeg: 90, elevationDeg: 30 }, 0, 100);
    expectPair([east!.dxCm, east!.dyCm], [-100 * Math.sqrt(3), 0]);
    // The same sun with the map's up pointing east: the shade falls down the map.
    const turned = shadowOffset({ azimuthDeg: 90, elevationDeg: 30 }, 90, 100);
    expectPair([turned!.dxCm, turned!.dyCm], [0, 100 * Math.sqrt(3)]);
  });

  it('are not cast while the sun is down', () => {
    expect(shadowOffset({ azimuthDeg: 270, elevationDeg: 0 }, 0, 300)).toBeNull();
    expect(shadowOffset({ azimuthDeg: 270, elevationDeg: -4 }, 0, 300)).toBeNull();
  });
});

describe('shade at an hour', () => {
  function make(over: Partial<EditorItem> & Pick<EditorItem, 'id' | 'kind'>): EditorItem {
    return {
      label: 'x', xCm: 0, yCm: 0, widthCm: 100, depthCm: 100, heightCm: null, insetCm: null,
      sort: 0, taskId: null, notes: null, locked: false, ...over,
    };
  }

  /*
   * A net 8 × 8 at (1000,1000), strip 50: its shaded ground is 1050–1750
   * each way. Under it: a sofa at y 1100–1190, a table at y 1400–1480, and a
   * fridge at y 1700–1770. A tent far away is under nothing.
   */
  const NET = make({ id: 'n', kind: 'shade', xCm: 1000, yCm: 1000, widthCm: 800, depthCm: 800, insetCm: 50 });
  const ITEMS = [
    NET,
    make({ id: 'sofa', kind: 'sofa', xCm: 1100, yCm: 1100, widthCm: 200, depthCm: 90 }),
    make({ id: 'table', kind: 'table', xCm: 1100, yCm: 1400, widthCm: 180, depthCm: 80 }),
    make({ id: 'fridge', kind: 'fridge', xCm: 1100, yCm: 1700, widthCm: 70, depthCm: 70 }),
    make({ id: 'tent', kind: 'tent', xCm: 100, yCm: 100, widthCm: 300, depthCm: 300 }),
  ];

  function docOf(items: EditorItem[], northDeg: number): EditorDoc {
    return { plot: { id: 'p', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg }, items, lines: [], defaults: {} };
  }

  const NOON = { azimuthDeg: 180, elevationDeg: 45 };

  it('casts a 3 m net’s shade 3 m north under a southern sun at 45°', () => {
    // Shade at y 750–1450: the sofa is in it, the table half in it, the fridge out of it.
    expect(shadeAtHour(docOf(ITEMS, 0), NOON)).toEqual({ under: 3, full: 1, partial: 1, sun: 1 });
  });

  it('turns the shade with the plot’s north', () => {
    // North at 180: the map's up is south, so the sun is up the map and the shade falls down it, y 1350–2050.
    expect(shadeAtHour(docOf(ITEMS, 180), NOON)).toEqual({ under: 3, full: 2, partial: 0, sun: 1 });
  });

  it('casts from the net’s own height when it has one', () => {
    // A 2 m cloth: shade at y 850–1550, over the sofa and the table.
    const low = ITEMS.map((entry) => (entry.id === 'n' ? { ...entry, heightCm: 200 } : entry));
    expect(shadeAtHour(docOf(low, 0), NOON)).toEqual({ under: 3, full: 2, partial: 0, sun: 1 });
  });

  it('says nothing while the sun is down', () => {
    expect(shadeAtHour(docOf(ITEMS, 0), { azimuthDeg: 270, elevationDeg: -2 })).toBeNull();
  });
});
