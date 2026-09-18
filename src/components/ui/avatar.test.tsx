/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar, AvatarStack, initials, tintIndex } from './avatar';

describe('initials', () => {
  it('takes one letter from each of the first two words', () => {
    expect(initials('רוני אדלר')).toBe('רא');
    expect(initials('מאיה בת שבע פרץ')).toBe('מב');
  });

  it('takes one letter from a one-word name', () => {
    expect(initials('נועה')).toBe('נ');
  });
});

describe('tintIndex', () => {
  it('is stable for the same name, so the server and the browser agree', () => {
    expect(tintIndex('רוני אדלר')).toBe(tintIndex('רוני אדלר'));
  });

  it('stays inside the six tints', () => {
    for (const name of ['רוני אדלר', 'איתי כהן', 'נועה לוי', 'מאיה פרץ', 'Ofek', 'ש']) {
      expect(tintIndex(name)).toBeGreaterThanOrEqual(0);
      expect(tintIndex(name)).toBeLessThan(6);
    }
  });
});

describe('Avatar', () => {
  it('is decorative beside a name it sits next to', () => {
    const { container } = render(<Avatar name="רוני אדלר" />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('names itself when it stands alone', () => {
    render(<Avatar name="רוני אדלר" decorative={false} />);
    expect(screen.getByRole('img', { name: 'רוני אדלר' })).toBeTruthy();
  });

  it('renders an empty dashed slot with its own label', () => {
    render(<Avatar empty label="משבצת פנויה" />);
    expect(screen.getByRole('img', { name: 'משבצת פנויה' })).toBeTruthy();
  });
});

describe('AvatarStack', () => {
  const people = [
    { id: '1', name: 'רוני אדלר' },
    { id: '2', name: 'איתי כהן' },
    { id: '3', name: 'נועה לוי' },
    { id: '4', name: 'מאיה פרץ' },
    { id: '5', name: 'יואב שפירא' },
    { id: '6', name: 'שירה מזרחי' },
  ];

  it('names the group and caps the overflow', () => {
    render(<AvatarStack people={people} max={4} label="משובצים למשמרת שער" />);
    expect(screen.getByRole('group', { name: 'משובצים למשמרת שער' })).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('shows every person when there is no overflow', () => {
    render(<AvatarStack people={people.slice(0, 3)} max={4} label="משובצים" />);
    expect(screen.queryByText(/^\+/)).toBeNull();
    expect(screen.getByRole('img', { name: 'נועה לוי' })).toBeTruthy();
  });

  it('turns each empty slot into a link when one is offered', () => {
    render(
      <AvatarStack
        people={people.slice(0, 2)}
        emptySlots={2}
        emptySlotHref={(i) => `/tasks?assign=gate&slot=${i}`}
        label="משובצים למשמרת שער"
      />,
    );
    const links = screen.getAllByRole('link', { name: 'שיבוץ לתפקיד פנוי' });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('/tasks?assign=gate&slot=0');
  });
});
