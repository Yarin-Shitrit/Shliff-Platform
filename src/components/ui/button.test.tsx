/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button, ButtonLink } from './button';

describe('Button', () => {
  it('is a button with its Hebrew label', () => {
    render(<Button>רישום תשלום</Button>);
    expect(screen.getByRole('button', { name: 'רישום תשלום' })).toBeTruthy();
  });

  it('defaults to type="button" so it cannot submit a form by accident', () => {
    render(<Button>ביטול</Button>);
    expect(screen.getByRole('button', { name: 'ביטול' }).getAttribute('type')).toBe('button');
  });

  it('submits when asked to, and carries its name and value for a Server Action', () => {
    render(<Button type="submit" name="intent" value="promote">אישור וקידום</Button>);
    const button = screen.getByRole('button', { name: 'אישור וקידום' }) as HTMLButtonElement;
    expect(button.type).toBe('submit');
    expect(button.name).toBe('intent');
    expect(button.value).toBe('promote');
  });

  it('names an icon-only button for assistive technology', () => {
    render(<Button iconLabel="סגירה"><svg aria-hidden="true" /></Button>);
    expect(screen.getByRole('button', { name: 'סגירה' })).toBeTruthy();
  });

  it('does not fire while disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>מחיקה</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'מחיקה' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a link as a link, not as a button', () => {
    render(<ButtonLink href="/imports">העלאת קובץ</ButtonLink>);
    const link = screen.getByRole('link', { name: 'העלאת קובץ' });
    expect(link.getAttribute('href')).toBe('/imports');
    expect(screen.queryByRole('button', { name: 'העלאת קובץ' })).toBeNull();
  });
});

/**
 * The second side of A26/A28's shared gap. `Button` assumes a form layout,
 * where the sentence explaining what a verb will do sits above it in the
 * form's own prose. A verb in a table row has that sentence somewhere else —
 * in the cell beside it, in the row's warning — and cannot swallow it: the
 * button's name has to stay the verb. So the sentence is carried by
 * reference, the way `Field` already ties a control to its hint.
 */
describe('Button — the sentence that explains it', () => {
  it('ties the verb to the sentence naming its consequence', () => {
    render(
      <>
        <span id="why">הקידום כותב 42 שורות לספר ואי אפשר לבטל אותו.</span>
        <Button aria-describedby="why">קידום הייבוא</Button>
      </>,
    );
    const button = screen.getByRole('button', { name: 'קידום הייבוא' });
    const describedBy = button.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent)
      .toBe('הקידום כותב 42 שורות לספר ואי אפשר לבטל אותו.');
  });

  it('leaves the name the verb, never the sentence', () => {
    render(
      <>
        <span id="why2">הקידום כותב 42 שורות לספר.</span>
        <Button aria-describedby="why2">קידום הייבוא</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'קידום הייבוא' })).toBeTruthy();
  });

  it('carries none when none is given', () => {
    render(<Button>קידום הייבוא</Button>);
    expect(screen.getByRole('button', { name: 'קידום הייבוא' }).hasAttribute('aria-describedby'))
      .toBe(false);
  });

  it('ties a link-shaped action to its sentence too', () => {
    render(
      <>
        <span id="why3">הייצוא מוריד קובץ ואינו משנה דבר.</span>
        <ButtonLink href="/members/export" aria-describedby="why3">ייצוא</ButtonLink>
      </>,
    );
    const link = screen.getByRole('link', { name: 'ייצוא' });
    expect(document.getElementById(link.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('הייצוא מוריד קובץ ואינו משנה דבר.');
  });
});
