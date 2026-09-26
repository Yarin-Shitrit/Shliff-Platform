/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SITE_OP_TYPES, type SiteOp } from '@/lib/site/editor/ops';
import { forgetUnsaved, isStaleBuild, keepUnsaved, readUnsaved } from './unsaved-work';

const MOVE = { type: 'update', id: 'a', patch: { xCm: 550 } } as const;

const TANK_ID = '0b9f6a8e-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const SINK_ID = '1c0a7b9f-2d3e-4f50-9b0c-1d2e3f4a5b6c';
const PIPE_ID = '2d1b8c0a-3e4f-4061-8c1d-2e3f4a5b6c7d';
/** One op of every kind, as the editor makes them — the stash must give each back. */
const EVERY_OP: SiteOp[] = [
  {
    type: 'add',
    item: {
      id: SINK_ID, kind: 'sink', label: 'כיור 1', xCm: 500, yCm: 300, widthCm: 100, depthCm: 50,
      heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 3, taskId: null, notes: null, facing: 0, locked: false,
    },
  },
  { type: 'update', id: TANK_ID, patch: { xCm: 620, label: 'מי שתייה 2' } },
  {
    type: 'addLine',
    line: { id: PIPE_ID, kind: 'water', label: 'צינור מים 1', fromId: TANK_ID, toId: SINK_ID, points: [[550, 300]], sort: 0, notes: null },
  },
  { type: 'updateLine', id: PIPE_ID, patch: { points: [[560, 320]] } },
  { type: 'setKindDefault', kind: 'tent', size: { widthCm: 350, depthCm: 300, heightCm: 210, insetCm: null, ropeAngleDeg: null } },
  { type: 'removeLine', id: PIPE_ID },
  { type: 'remove', id: TANK_ID },
  {
    type: 'setUnderlay',
    underlay: {
      storageKey: `site-underlays/3e2c1b0a-4f5e-4d6c-9b8a-7f6e5d4c3b2a/${'a'.repeat(64)}.png`,
      contentType: 'image/png', sizeBytes: 812_345, filename: 'שרטוט.png',
      centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 37,
      calibration: { from: [0.1, 0.5], to: [0.9, 0.5], distanceCm: 2600 },
    },
  },
];

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('work an older build left unsaved', () => {
  it('knows Next’s missing server action from a dropped connection', () => {
    const named = Object.assign(new Error('Server Action "7f" was not found on the server.'), { name: 'UnrecognizedActionError' });
    expect(isStaleBuild(named)).toBe(true);
    // The name can be lost crossing a boundary; the sentence is Next's own.
    expect(isStaleBuild(new Error('Server Action "7f" was not found on the server. \nRead more: …'))).toBe(true);
    expect(isStaleBuild(new TypeError('Failed to fetch'))).toBe(false);
    expect(isStaleBuild('Server Action "7f" was not found on the server.')).toBe(false);
  });

  it('keeps it per plan, reads it back, and forgets it', () => {
    keepUnsaved('p1', [MOVE]);
    expect(readUnsaved('p1')).toEqual([MOVE]);
    expect(readUnsaved('p2')).toEqual([]);
    forgetUnsaved('p1');
    expect(readUnsaved('p1')).toEqual([]);
    keepUnsaved('p1', [MOVE]);
    keepUnsaved('p1', []);
    expect(window.sessionStorage.getItem('site-editor:pending:p1')).toBeNull();
  });

  /*
   * #25 fix round, Critical: the stash knew only the item ops. Deleting a
   * tank with a pipe on it makes a `removeLine`, and a stash holding one was
   * read back as untrustworthy and dropped whole — every unsaved edit lost,
   * right after the banner promised it would wait for the refresh.
   */
  it('keeps a line op, and a stash of item and line ops together', () => {
    keepUnsaved('p1', [MOVE, { type: 'removeLine', id: PIPE_ID }]);
    expect(readUnsaved('p1')).toEqual([MOVE, { type: 'removeLine', id: PIPE_ID }]);
    keepUnsaved('p1', EVERY_OP);
    expect(readUnsaved('p1')).toEqual(EVERY_OP);
  });

  it('knows every op the editor can make — the list sits beside SiteOp, so a new one cannot be missed here', () => {
    expect(new Set(EVERY_OP.map((op) => op.type))).toEqual(new Set(SITE_OP_TYPES));
    for (const type of SITE_OP_TYPES) {
      const op = EVERY_OP.find((sample) => sample.type === type);
      expect(op, type).toBeDefined();
      keepUnsaved('p1', [op as SiteOp]);
      expect(readUnsaved('p1'), type).toEqual([op]);
    }
  });

  it('reads nothing back rather than half of something it cannot trust', () => {
    window.sessionStorage.setItem('site-editor:pending:p1', '{not json');
    expect(readUnsaved('p1')).toEqual([]);
    window.sessionStorage.setItem('site-editor:pending:p1', JSON.stringify({ type: 'update' }));
    expect(readUnsaved('p1')).toEqual([]);
    // One op the server would refuse spoils the batch: none of it is replayed.
    window.sessionStorage.setItem('site-editor:pending:p1', JSON.stringify([MOVE, { type: 'update', id: 'b', patch: { widthCm: 5 } }]));
    expect(readUnsaved('p1')).toEqual([]);
    window.sessionStorage.setItem('site-editor:pending:p1', JSON.stringify([MOVE, { type: 'teleport', id: 'c' }]));
    expect(readUnsaved('p1')).toEqual([]);
    // A picture op with no picture in it is not "take the picture off" (that is `underlay: null`).
    window.sessionStorage.setItem('site-editor:pending:p1', JSON.stringify([MOVE, { type: 'setUnderlay' }]));
    expect(readUnsaved('p1')).toEqual([]);
  });

  it('carries on without storage — a private window, or blocked site data', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => { keepUnsaved('p1', [MOVE]); }).not.toThrow();
    expect(readUnsaved('p1')).toEqual([]);
  });
});
