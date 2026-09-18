/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkBar, selectionLabel, type DestructiveBulkAction } from './bulk-bar';

const actions = [
  { id: 'season', label: 'שיוך לשנה', onSelect: vi.fn() },
  { id: 'export', label: 'ייצוא', onSelect: vi.fn() },
];

function destructiveAction(onConfirmed: () => void = vi.fn()): DestructiveBulkAction {
  return {
    id: 'remove',
    label: 'הסרה מהשנה',
    confirm: {
      title: 'הסרת שיוך מהשנה',
      consequence: (count) => `${count} תשלומים יוסרו מהשנה הנוכחית.`,
      confirmLabel: 'הסרת השיוך',
    },
    onConfirmed,
  };
}

describe('selectionLabel', () => {
  it('agrees with the number', () => {
    expect(selectionLabel(1)).toBe('נבחר אחד');
    expect(selectionLabel(2)).toBe('2 נבחרו');
    expect(selectionLabel(35)).toBe('35 נבחרו');
  });
});

describe('BulkBar', () => {
  it('keeps no toolbar in view or in the tree when nothing is selected', () => {
    render(
      <BulkBar count={0} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />,
    );
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the live region mounted before the first selection, so it is announced', () => {
    const { container, rerender } = render(
      <BulkBar count={0} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />,
    );
    expect(container.querySelector('[aria-live]')).not.toBeNull();

    rerender(<BulkBar count={2} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />);
    const region = screen.getByRole('region', { name: 'פעולות על הנבחרים' });
    expect(region).toBeTruthy();
    const live = screen.getByText(/נבחרו/);
    expect(live.getAttribute('aria-live')).toBe('polite');
  });

  it('fires a non-destructive action immediately, with no dialog', () => {
    render(<BulkBar count={2} label="פעולות על הנבחרים" actions={actions} onClear={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'שיוך לשנה' }));
    expect(actions[0].onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('keeps a destructive action behind עוד, hidden until opened', () => {
    render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={actions}
        moreActions={[destructiveAction()]}
        onClear={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'הסרה מהשנה' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    expect(screen.getByRole('button', { name: 'הסרה מהשנה' })).toBeTruthy();
  });

  it('opens a confirmation instead of running the destructive action immediately', () => {
    const onConfirmed = vi.fn();
    render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={actions}
        moreActions={[destructiveAction(onConfirmed)]}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרה מהשנה' }));
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'הסרת שיוך מהשנה' })).toBeTruthy();
  });

  it('names the selection count in the confirmation sentence', () => {
    render(
      <BulkBar
        count={7}
        label="פעולות על הנבחרים"
        actions={actions}
        moreActions={[destructiveAction()]}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרה מהשנה' }));
    expect(screen.getByText('7 תשלומים יוסרו מהשנה הנוכחית.')).toBeTruthy();
  });

  it('runs onConfirmed exactly once when the reader confirms', () => {
    const onConfirmed = vi.fn();
    render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={actions}
        moreActions={[destructiveAction(onConfirmed)]}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרה מהשנה' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרת השיוך' }));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('runs onConfirmed zero times when the reader cancels', () => {
    const onConfirmed = vi.fn();
    render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={actions}
        moreActions={[destructiveAction(onConfirmed)]}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרה מהשנה' }));
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('offers a way out of the selection', () => {
    const onClear = vi.fn();
    render(<BulkBar count={2} label="פעולות על הנבחרים" actions={actions} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'ביטול הבחירה' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe('BulkBar — the additive guarantee', () => {
  /**
   * The net under the concurrent screen lanes: recorded against the
   * implementation as it stood before `href` existed, from the action shape
   * every existing caller passes. If a later change alters what those screens
   * render, this fails and nothing else has to notice.
   */
  it('renders the pre-href action shape byte for byte', () => {
    const { container } = render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={[
          { id: 'season', label: 'שיוך לברן 26', icon: 'userplus', onSelect: vi.fn() },
          { id: 'merge', label: 'מיזוג', icon: 'merge', disabled: true, onSelect: vi.fn() },
        ]}
        moreActions={[destructiveAction()]}
        onClear={vi.fn()}
      />,
    );
    expect(container.innerHTML).toMatchInlineSnapshot(`"<div class="_bar_aca7da" role="region" aria-label="פעולות על הנבחרים"><span class="_count_aca7da" aria-live="polite">2 נבחרו</span><button class="_btn_852a75 _sm_852a75" type="button"><svg class="_icon_098686" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" x2="19" y1="8" y2="14"></line><line x1="22" x2="16" y1="11" y2="11"></line></svg>שיוך לברן 26</button><button class="_btn_852a75 _sm_852a75" type="button" disabled=""><svg class="_icon_098686" data-direction="inline" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M6 21V9a9 9 0 0 0 9 9"></path></svg>מיזוג</button><span class="_root_dc8c79"><button type="button" class="_trigger_dc8c79 _bulk_dc8c79" aria-label="עוד" aria-expanded="false" aria-controls="bulk-more-panel" aria-haspopup="true">עוד</button></span><button class="_btn_852a75 _sm_852a75 _icon_852a75" type="button" aria-label="ביטול הבחירה"><svg class="_icon_098686" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div>"`);
  });
});

/**
 * An action that only navigates was a button that navigated: merge pushed
 * through the router, and export reached for `window.location.assign` plus an
 * eslint disable, because Next's client router would have fetched the CSV as
 * an RSC payload and left nothing in the lead's downloads folder. The disable
 * was the tell — a link had been written as a button.
 */
describe('BulkBar — an action that navigates is a link', () => {
  it('renders a navigating action as a link, never as a button that navigates', () => {
    render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={[{ id: 'merge', label: 'מיזוג', icon: 'merge', href: '/members?act=merge' }]}
        onClear={vi.fn()}
      />,
    );
    const link = screen.getByRole('link', { name: 'מיזוג' });
    expect(link.getAttribute('href')).toBe('/members?act=merge');
    expect(screen.queryByRole('button', { name: 'מיזוג' })).toBeNull();
  });

  /* Next's Link declines to intercept a click on an anchor carrying
     `download`, so the file lands instead of being fetched as a payload —
     which is the whole reason the export action had to reach past the kit. */
  it('marks a download as one, so the file lands rather than being routed', () => {
    render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={[{ id: 'export', label: 'ייצוא', icon: 'download', href: '/members/export?ids=a,b', download: true }]}
        onClear={vi.fn()}
      />,
    );
    const link = screen.getByRole('link', { name: 'ייצוא' });
    expect(link.hasAttribute('download')).toBe(true);
    expect(link.getAttribute('href')).toBe('/members/export?ids=a,b');
  });

  it('renders a navigating action that is unavailable as a disabled button, not a dead link', () => {
    render(
      <BulkBar
        count={3}
        label="פעולות על הנבחרים"
        actions={[{ id: 'merge', label: 'מיזוג', href: '/members?act=merge', disabled: true }]}
        onClear={vi.fn()}
      />,
    );
    expect(screen.queryByRole('link', { name: 'מיזוג' })).toBeNull();
    expect((screen.getByRole('button', { name: 'מיזוג' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('stands beside a callback action without disturbing it', () => {
    const onSelect = vi.fn();
    render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={[
          { id: 'season', label: 'שיוך לשנה', onSelect },
          { id: 'export', label: 'ייצוא', href: '/members/export', download: true },
        ]}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'שיוך לשנה' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'ייצוא' })).toBeTruthy();
  });

  /* R8: `href` is a variant of the non-destructive list only. A link cannot
     carry a confirmation, so the destructive slot behind עוד is untouched and
     still runs every entry through the dialog BulkBar owns. */
  it('never puts a navigating action behind עוד, where the confirmation lives', () => {
    render(
      <BulkBar
        count={2}
        label="פעולות על הנבחרים"
        actions={[{ id: 'export', label: 'ייצוא', href: '/members/export', download: true }]}
        moreActions={[destructiveAction()]}
        onClear={vi.fn()}
      />,
    );
    const region = screen.getByRole('region', { name: 'פעולות על הנבחרים' });
    const link = screen.getByRole('link', { name: 'ייצוא' });
    expect(link.parentElement).toBe(region);

    fireEvent.click(screen.getByRole('button', { name: 'עוד' }));
    fireEvent.click(screen.getByRole('button', { name: 'הסרה מהשנה' }));
    expect(screen.getByRole('alertdialog', { name: 'הסרת שיוך מהשנה' })).toBeTruthy();
  });
});
