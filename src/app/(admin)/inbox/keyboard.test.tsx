/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { InboxKeyboard } from './keyboard';

function setup(digits: Record<string, string> = { Digit1: 'act-1' }) {
  const button = document.createElement('button');
  button.id = 'act-1';
  const clicked = vi.fn();
  button.addEventListener('click', clicked);
  document.body.append(button);
  render(
    <InboxKeyboard digits={digits} prevHref="/inbox?item=a" nextHref="/inbox?item=c" />,
  );
  return { clicked };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('InboxKeyboard', () => {
  it('presses the numbered button by its physical key, not its letter', () => {
    const { clicked } = setup();
    fireEvent.keyDown(window, { code: 'Digit1', key: '1' });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('works on a Hebrew layout, where event.key is not what the cap says', () => {
    const { clicked } = setup();
    // A Hebrew layout reports the letter, never the digit's Latin name.
    fireEvent.keyDown(window, { code: 'Digit1', key: 'ז' });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('ignores a key it has no action for', () => {
    const { clicked } = setup();
    fireEvent.keyDown(window, { code: 'Digit9', key: '9' });
    expect(clicked).not.toHaveBeenCalled();
  });

  it('moves along the rail with the arrows', () => {
    setup();
    fireEvent.keyDown(window, { code: 'ArrowDown', key: 'ArrowDown' });
    expect(push).toHaveBeenCalledWith('/inbox?item=c');
    fireEvent.keyDown(window, { code: 'ArrowUp', key: 'ArrowUp' });
    expect(push).toHaveBeenCalledWith('/inbox?item=a');
  });

  it('stays out of the way while someone is typing', () => {
    const { clicked } = setup();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { code: 'Digit1', key: '1' });
    expect(clicked).not.toHaveBeenCalled();
  });

  it('binds no single-letter shortcut (R10)', () => {
    const { clicked } = setup({ Digit1: 'act-1', KeyZ: 'act-1' });
    fireEvent.keyDown(window, { code: 'KeyZ', key: 'ז' });
    expect(clicked).not.toHaveBeenCalled();
  });

  it('lets a modifier combination through to the browser', () => {
    const { clicked } = setup();
    fireEvent.keyDown(window, { code: 'Digit1', key: '1', metaKey: true });
    expect(clicked).not.toHaveBeenCalled();
  });

  // The digit must press the very control the pointer presses. A handler that
  // called the action itself would be a second path to the same write, free to
  // skip the confirmation the button raises — which is how a keyboard shortcut
  // quietly becomes the unguarded way to do something.
  it('presses the control rather than taking its own path to the action', () => {
    const order: string[] = [];
    const button = document.createElement('button');
    button.id = 'act-2';
    button.addEventListener('click', () => order.push('click'));
    document.body.append(button);
    render(<InboxKeyboard digits={{ Digit2: 'act-2' }} prevHref={null} nextHref={null} />);
    fireEvent.keyDown(window, { code: 'Digit2', key: '2' });
    expect(order).toEqual(['click']);
  });

  it('does nothing at the ends of the rail rather than navigating to nowhere', () => {
    setup();
    render(<InboxKeyboard digits={{}} prevHref={null} nextHref={null} />);
    vi.mocked(push).mockClear();
    fireEvent.keyDown(window, { code: 'ArrowDown', key: 'ArrowDown' });
    fireEvent.keyDown(window, { code: 'ArrowUp', key: 'ArrowUp' });
    // The first instance from `setup` still has hrefs, so it navigates; what
    // must not happen is a push with null.
    for (const call of vi.mocked(push).mock.calls) {
      expect(call[0]).not.toBeNull();
    }
  });
});
