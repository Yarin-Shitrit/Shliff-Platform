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
