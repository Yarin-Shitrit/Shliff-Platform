import { describe, it, expect } from 'vitest';
import {
  parsePlanQuery, planHref, itemHref, topicHref, newTopicHref, newItemHref, scaleHref, adoptHref, PLAN_PATH,
} from './plan-views';

describe('the plan’s query', () => {
  it('reads a bare URL as nothing open', () => {
    expect(parsePlanQuery({})).toEqual({
      season: '', peek: null, peekTopic: null, creatingTopic: false, creatingItem: false,
      presetTopic: null, presetParent: null, scale: 'day', adopting: false,
    });
  });

  it('reads the timeline’s resolution, and falls back to days on nonsense and on the old ״הכול״', () => {
    expect(parsePlanQuery({ scale: 'week' })).toMatchObject({ scale: 'week' });
    expect(parsePlanQuery({ scale: 'month' })).toMatchObject({ scale: 'month' });
    expect(parsePlanQuery({ scale: 'decade' })).toMatchObject({ scale: 'day' });
    expect(parsePlanQuery({ scale: 'all' })).toMatchObject({ scale: 'day' });
    // A link from before, with the day of a window in it: the day is ignored, not an error.
    expect(parsePlanQuery({ scale: 'week', at: '2026-05-13' })).not.toHaveProperty('at');
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

  it('carries the timeline’s resolution through every link, so a drawer closes back onto the months', () => {
    const months = { season: 's1', scale: 'month' };
    expect(itemHref(months, 'i2')).toBe(`${PLAN_PATH}?season=s1&scale=month&peek=i2`);
    expect(planHref(months, {})).toBe(`${PLAN_PATH}?season=s1&scale=month`);
    // The day of an old window link is not carried on.
    expect(planHref({ season: 's1', scale: 'week', at: '2026-05-13' }, {})).toBe(`${PLAN_PATH}?season=s1&scale=week`);
  });

  it('spells the resolution links, and spells ״ימים״ by leaving the param out', () => {
    expect(scaleHref({ season: 's1' }, 'week')).toBe(`${PLAN_PATH}?season=s1&scale=week`);
    expect(scaleHref({ season: 's1', scale: 'week' }, 'month')).toBe(`${PLAN_PATH}?season=s1&scale=month`);
    expect(scaleHref({ season: 's1', scale: 'month' }, 'day')).toBe(`${PLAN_PATH}?season=s1`);
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
