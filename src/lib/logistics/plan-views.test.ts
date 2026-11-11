import { describe, it, expect } from 'vitest';
import {
  parsePlanQuery, planHref, itemHref, topicHref, newTopicHref, newItemHref, PLAN_PATH,
} from './plan-views';

describe('the plan’s query', () => {
  it('reads a bare URL as nothing open', () => {
    expect(parsePlanQuery({})).toEqual({
      season: '', peek: null, peekTopic: null, creatingTopic: false, creatingItem: false,
      presetTopic: null, presetParent: null,
    });
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

  it('builds every drawer from one place', () => {
    expect(itemHref(here, 'i2')).toBe(`${PLAN_PATH}?season=s1&peek=i2`);
    expect(topicHref(here, 't1')).toBe(`${PLAN_PATH}?season=s1&topic=t1`);
    expect(newTopicHref(here)).toBe(`${PLAN_PATH}?season=s1&act=topic`);
    expect(newItemHref(here)).toBe(`${PLAN_PATH}?season=s1&act=item`);
    expect(newItemHref(here, { topicId: 't1' })).toBe(`${PLAN_PATH}?season=s1&act=item&topic=t1`);
    expect(newItemHref(here, { parentId: 'p1' })).toBe(`${PLAN_PATH}?season=s1&act=item&parent=p1`);
  });
});
