import { describe, it, expect } from 'vitest';
import {
  parsePlanQuery, planHref, itemHref, topicHref, newTopicHref, newItemHref, scaleHref, adoptHref, PLAN_PATH,
} from './plan-views';

describe('the plan’s query', () => {
  it('reads a bare URL as nothing open', () => {
    expect(parsePlanQuery({})).toEqual({
      season: '', peek: null, peekTopic: null, creatingTopic: false, creatingItem: false,
      presetTopic: null, presetParent: null, scale: 'all', at: null, adopting: false,
    });
  });

  it('reads the timeline’s scale and day, and falls back to everything on nonsense', () => {
    expect(parsePlanQuery({ scale: 'week', at: '2026-05-13' })).toMatchObject({ scale: 'week', at: '2026-05-13' });
    expect(parsePlanQuery({ scale: 'month' })).toMatchObject({ scale: 'month', at: null });
    expect(parsePlanQuery({ scale: 'decade', at: '13/05/2026' })).toMatchObject({ scale: 'all', at: null });
  });

  it('opens the move-to-acquisitions drawer only with nothing else named', () => {
    expect(parsePlanQuery({ act: 'purchases' })).toMatchObject({ adopting: true, creatingItem: false, creatingTopic: false });
    expect(parsePlanQuery({ act: 'purchases', peek: 'i1' })).toMatchObject({ adopting: false, peek: 'i1' });
    expect(parsePlanQuery({ act: 'purchases', topic: 't1' })).toMatchObject({ adopting: false, peekTopic: 't1' });
  });

  it('opens one item, and lets it win over everything else', () => {
    const query = parsePlanQuery({ peek: 'i1', act: 'item', topic: 't1', parent: 'p1', season: 's1' });
    expect(query.peek).toBe('i1');
    expect(query.creatingItem).toBe(false);
    expect(query.peekTopic).toBeNull();
    expect(query.season).toBe('s1');
  });

  it('pre-fills the new-item drawer from the topic or the parent', () => {
    expect(parsePlanQuery({ act: 'item', topic: 't1' })).toMatchObject({ creatingItem: true, presetTopic: 't1', peekTopic: null });
    expect(parsePlanQuery({ act: 'item', parent: 'p1' })).toMatchObject({ creatingItem: true, presetParent: 'p1' });
  });

  it('opens a topic on its own, and the new-topic drawer only with no topic named', () => {
    expect(parsePlanQuery({ topic: 't1' })).toMatchObject({ peekTopic: 't1', creatingTopic: false });
    expect(parsePlanQuery({ act: 'topic' })).toMatchObject({ creatingTopic: true });
    expect(parsePlanQuery({ act: 'topic', topic: 't1' })).toMatchObject({ creatingTopic: false, peekTopic: 't1' });
  });

  it('takes the first of a repeated param and never throws', () => {
    expect(parsePlanQuery({ peek: ['a', 'b'] }).peek).toBe('a');
    expect(parsePlanQuery({ act: ['x'] }).creatingItem).toBe(false);
  });
});

describe('the plan’s links', () => {
  const here = { season: 's1', peek: 'i1', act: 'item' };

  it('carries the season and drops the open drawer', () => {
    expect(planHref(here, {})).toBe(`${PLAN_PATH}?season=s1`);
    expect(planHref({}, {})).toBe(PLAN_PATH);
  });

  it('carries the timeline’s scale and day through every link, so a drawer closes back onto the week', () => {
    const week = { season: 's1', scale: 'week', at: '2026-05-13' };
    expect(itemHref(week, 'i2')).toBe(`${PLAN_PATH}?season=s1&scale=week&at=2026-05-13&peek=i2`);
    expect(planHref(week, {})).toBe(`${PLAN_PATH}?season=s1&scale=week&at=2026-05-13`);
  });

  it('spells the scale links, and spells ״הכול״ by leaving both params out', () => {
    expect(scaleHref({ season: 's1' }, 'week', '2026-05-13')).toBe(`${PLAN_PATH}?season=s1&scale=week&at=2026-05-13`);
    expect(scaleHref({ season: 's1', scale: 'week', at: '2026-05-13' }, 'month', '2026-06-01'))
      .toBe(`${PLAN_PATH}?season=s1&scale=month&at=2026-06-01`);
    expect(scaleHref({ season: 's1', scale: 'week', at: '2026-05-13' }, 'all')).toBe(`${PLAN_PATH}?season=s1`);
  });

  it('builds every drawer from one place', () => {
    expect(itemHref(here, 'i2')).toBe(`${PLAN_PATH}?season=s1&peek=i2`);
    expect(topicHref(here, 't1')).toBe(`${PLAN_PATH}?season=s1&topic=t1`);
    expect(newTopicHref(here)).toBe(`${PLAN_PATH}?season=s1&act=topic`);
    expect(newItemHref(here)).toBe(`${PLAN_PATH}?season=s1&act=item`);
    expect(newItemHref(here, { topicId: 't1' })).toBe(`${PLAN_PATH}?season=s1&act=item&topic=t1`);
    expect(newItemHref(here, { parentId: 'p1' })).toBe(`${PLAN_PATH}?season=s1&act=item&parent=p1`);
    expect(adoptHref(here)).toBe(`${PLAN_PATH}?season=s1&act=purchases`);
  });
});
