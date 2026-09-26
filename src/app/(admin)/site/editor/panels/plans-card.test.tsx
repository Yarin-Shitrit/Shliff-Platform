/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { unnamedControls } from '@/test/a11y';
import type { EditorPlot } from '@/lib/site/editor/model';
import type { SnapshotSummary } from '@/lib/site/snapshots';
import { holdsText, PLANS_INVITATION, PlansCard, savedText, type PlansCardProps } from './plans-card';

const PLOT: EditorPlot = { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 };
const PLAN_PLOT = { widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 };

const plan = (over: Partial<SnapshotSummary> & { id: string }): SnapshotSummary => ({
  name: `תוכנית ${over.id}`, plot: PLAN_PLOT, itemCount: 12, lineCount: 0,
  createdAt: '2026-09-26T12:40:00.000Z', createdBy: 'lead@shliff.camp', ...over,
});

function renderCard(over: Partial<PlansCardProps> = {}) {
  const props: PlansCardProps = {
    plans: [], listError: null, plot: PLOT, plotHref: '/site?season=s26&act=plot', busy: null, saveError: null,
    suggestedName: 'תוכנית 1',
    onSave: vi.fn(), onLoad: vi.fn(), onDelete: vi.fn(), onRetry: vi.fn(), onClose: vi.fn(),
    ...over,
  };
  const view = render(<PlansCard {...props} />);
  return { ...view, props, rerenderWith: (next: Partial<PlansCardProps>) => { view.rerender(<PlansCard {...props} {...next} />); } };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('the saved plans’ card', () => {
  it('invites the first plan when there is none, and names every control', () => {
    const { container } = renderCard();
    expect(screen.getByText(PLANS_INVITATION)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(unnamedControls(container)).toEqual([]);
  });

  it('says it is reading the list, and offers to try again when the read failed', () => {
    const { rerenderWith, props } = renderCard({ plans: null });
    expect(screen.getByRole('status').textContent).toBe('טוען…');
    rerenderWith({ plans: null, listError: 'לא הצלחנו להגיע לשרת. אפשר לנסות שוב.' });
    expect(screen.getByRole('alert').textContent).toBe('לא הצלחנו להגיע לשרת. אפשר לנסות שוב.');
    fireEvent.click(button('ניסיון חוזר'));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it('saves the map under the proposed name, or the typed one, trimmed — and refuses a blank one before asking the server', () => {
    const { props } = renderCard({ suggestedName: 'תוכנית 3' });
    const box = screen.getByRole('textbox', { name: 'שם התוכנית' }) as HTMLInputElement;
    expect(box.value).toBe('תוכנית 3');
    fireEvent.click(button('שמירת המפה'));
    expect(props.onSave).toHaveBeenLastCalledWith('תוכנית 3');

    fireEvent.change(box, { target: { value: '  המטבח בצפון  ' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    expect(props.onSave).toHaveBeenLastCalledWith('המטבח בצפון');

    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.click(button('שמירת המפה'));
    expect(screen.getByRole('alert').textContent).toBe('לתוכנית צריך שם, כדי להבדיל בינה לבין אחרות.');
    expect(props.onSave).toHaveBeenCalledTimes(2);
    expect(box.getAttribute('aria-invalid')).toBe('true');
  });

  it('proposes the next number once a plan is saved, unless the lead typed a name of their own', () => {
    const { rerenderWith } = renderCard({ suggestedName: 'תוכנית 1' });
    const box = screen.getByRole('textbox', { name: 'שם התוכנית' }) as HTMLInputElement;
    rerenderWith({ suggestedName: 'תוכנית 2' });
    expect(box.value).toBe('תוכנית 2');
    fireEvent.change(box, { target: { value: 'המטבח בצפון' } });
    rerenderWith({ suggestedName: 'תוכנית 3' });
    expect(box.value).toBe('המטבח בצפון');
  });

  it('lists each plan with what it holds and when it was saved, loads one on its button, and asks before forgetting one', () => {
    const { props } = renderCard({ plans: [plan({ id: 'a', name: 'סידור א', lineCount: 3 }), plan({ id: 'b', name: 'סידור ב', itemCount: 1 })] });
    const rows = screen.getAllByRole('listitem');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('סידור א');
    expect(rows[0].textContent).toContain('12 פריטים · 3 קווים');
    expect(rows[0].textContent).toContain('נשמרה ב־26/09/2026 בשעה 15:40');
    expect(rows[1].textContent).toContain('פריט אחד');

    fireEvent.click(screen.getAllByRole('button', { name: 'טעינה למפה' })[1]);
    expect(props.onLoad).toHaveBeenCalledWith('b');

    fireEvent.click(button('מחיקת התוכנית סידור א'));
    expect(props.onDelete).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('התוכנית ⁨סידור א⁩ תימחק');
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת התוכנית' }));
    expect(props.onDelete).toHaveBeenCalledWith('a');
  });

  it('says on a plan’s row when it was saved on a plot of another size, and the figure opens the plot settings', () => {
    renderCard({ plans: [plan({ id: 'a', plot: { ...PLAN_PLOT, widthCm: 3000 } }), plan({ id: 'b' })] });
    const rows = screen.getAllByRole('listitem');
    expect(rows[0].textContent).toContain('נשמרה על מגרש 30 × 24 מ׳; המגרש עכשיו 26 × 24 מ׳');
    const link = rows[0].querySelector('a') as HTMLAnchorElement;
    expect(link.textContent).toBe('30 × 24 מ׳');
    expect(link.getAttribute('href')).toBe('/site?season=s26&act=plot');
    expect(rows[1].textContent).not.toContain('נשמרה על מגרש');
  });

  it('waits while a save, a load or a delete is under way, and says which', () => {
    const { rerenderWith } = renderCard({ plans: [plan({ id: 'a' })], busy: { what: 'save' } });
    expect((button('שמירת המפה') as HTMLButtonElement).disabled).toBe(true);
    expect((button('טעינה למפה') as HTMLButtonElement).disabled).toBe(true);
    rerenderWith({ plans: [plan({ id: 'a' })], busy: { what: 'load', id: 'a' } });
    expect(screen.getByRole('button', { name: 'טוען…' })).toBeTruthy();
    rerenderWith({ plans: [plan({ id: 'a' })], busy: { what: 'delete', id: 'a' } });
    expect(screen.getByRole('listitem').textContent).toContain('מוחק…');
  });

  it('shows why a save was refused, and closes', () => {
    const { props } = renderCard({ saveError: 'למפה יש כבר 30 תוכניות שמורות. כדי לשמור עוד אחת, מוחקים תוכנית שכבר לא צריך' });
    expect(screen.getByRole('alert').textContent).toContain('למפה יש כבר 30 תוכניות שמורות');
    fireEvent.click(button('סגירה'));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('counts in Hebrew, one and many', () => {
    expect(holdsText({ itemCount: 1, lineCount: 1 })).toBe('פריט אחד · קו אחד');
    expect(holdsText({ itemCount: 0, lineCount: 0 })).toBe('0 פריטים');
    expect(savedText('not a date')).toBe('נשמרה');
  });
});
