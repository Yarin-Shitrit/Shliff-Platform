/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import { SiteBoard, type BoardItem } from './site-board';

const { updateItemAction, addItemAction } = vi.hoisted(() => ({
  updateItemAction: vi.fn(), addItemAction: vi.fn(),
}));
const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh }),
}));
vi.mock('./actions', () => ({ updateItemAction, addItemAction }));

const PLAN = { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50 };
/** The canvas is `viewBox` wide plus the padding on both sides. */
const VIEW_W = 2600 + 400;

function tent(over: Partial<BoardItem> = {}): BoardItem {
  return {
    id: 'a', kind: 'tent', label: 'אוהל 1', sort: 0,
    xCm: 0, yCm: 0, widthCm: 300, depthCm: 300, insetCm: null, ...over,
  };
}

function renderBoard(items: BoardItem[], selected: string | null = null) {
  return render(
    <ToastProvider>
      <SiteBoard plan={PLAN} items={items} season="s26" initialSelected={selected} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  updateItemAction.mockResolvedValue({ ok: true });
  addItemAction.mockResolvedValue({ ok: true, value: 'new' });
  /* jsdom lays nothing out and captures no pointer. One pixel per
     centimetre keeps the drag arithmetic readable, and capture is a no-op. */
  Element.prototype.getBoundingClientRect = () => ({
    width: VIEW_W, height: 2800, x: 0, y: 0, top: 0, left: 0, right: VIEW_W, bottom: 2800, toJSON: () => ({}),
  });
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

describe('the board', () => {
  it('names every item for a reader who cannot see it, with its size, place and state', () => {
    renderBoard([
      tent(),
      tent({ id: 'out', label: 'קראוון 1', kind: 'caravan', xCm: 2500, widthCm: 700, depthCm: 250 }),
    ]);
    const canvas = screen.getByRole('group', { name: 'מפת הקאמפ' });
    expect(within(canvas).getByRole('button', { name: 'אוהל 1, 3 × 3 מ׳, מיקום 0 על 0 מטר, ללא צל' })).toBeTruthy();
    expect(within(canvas).getByRole('button', { name: /קראוון 1, 7 × 2.5 מ׳, מיקום 25 על 0 מטר, מחוץ למגרש/ })).toBeTruthy();
  });

  it('offers every kind in the palette, and drops one through the action', async () => {
    renderBoard([tent()]);
    const palette = screen.getByRole('group', { name: 'הוספה למפה' });
    fireEvent.click(within(palette).getByRole('button', { name: 'קראוון' }));
    await waitFor(() => { expect(addItemAction).toHaveBeenCalledWith('p1', 'caravan'); });
    expect(refresh).toHaveBeenCalled();
  });

  it('moves one grid step on an arrow key and saves it', async () => {
    renderBoard([tent()]);
    const item = screen.getByRole('button', { name: /אוהל 1/ });
    fireEvent.keyDown(item, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(updateItemAction).toHaveBeenCalledWith('a', { xCm: 50, yCm: 0, widthCm: 300, depthCm: 300 });
    });
    expect(screen.getByRole('button', { name: /מיקום 0.5 על 0 מטר/ })).toBeTruthy();
  });

  it('resizes on a shifted arrow and turns on the letter', async () => {
    renderBoard([tent({ widthCm: 300, depthCm: 200 })]);
    const item = screen.getByRole('button', { name: /אוהל 1/ });
    fireEvent.keyDown(item, { key: 'ArrowDown', shiftKey: true });
    await waitFor(() => {
      expect(updateItemAction).toHaveBeenCalledWith('a', { xCm: 0, yCm: 0, widthCm: 300, depthCm: 250 });
    });
    fireEvent.keyDown(item, { key: 'ר' });
    await waitFor(() => {
      expect(updateItemAction).toHaveBeenLastCalledWith('a', { xCm: 0, yCm: 0, widthCm: 250, depthCm: 300 });
    });
  });

  it('snaps a drag of 37 centimetres to the 50 grid and saves once, on release', async () => {
    renderBoard([tent()]);
    const item = screen.getByRole('button', { name: /אוהל 1/ });
    fireEvent.pointerDown(item, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(item, { clientX: 137, clientY: 100, pointerId: 1 });
    expect(updateItemAction).not.toHaveBeenCalled();
    fireEvent.pointerUp(item, { clientX: 137, clientY: 100, pointerId: 1 });
    await waitFor(() => {
      expect(updateItemAction).toHaveBeenCalledTimes(1);
    });
    expect(updateItemAction).toHaveBeenCalledWith('a', { xCm: 50, yCm: 0, widthCm: 300, depthCm: 300 });
  });

  it('treats a click that did not move as a selection, not a save', () => {
    renderBoard([tent()]);
    const item = screen.getByRole('button', { name: /אוהל 1/ });
    fireEvent.pointerDown(item, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(item, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(updateItemAction).not.toHaveBeenCalled();
    expect(item.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('link', { name: 'עריכה' }).getAttribute('href')).toBe('/site?season=s26&peek=a');
    expect(screen.getByRole('link', { name: 'הסרה' }).getAttribute('href')).toBe('/site?season=s26&peek=a&act=remove');
  });

  it('puts the item back and says why when the save is refused', async () => {
    updateItemAction.mockResolvedValue({ ok: false, error: 'לא מצאנו את הפריט הזה במפה — אולי הוסר בינתיים' });
    renderBoard([tent()]);
    const item = screen.getByRole('button', { name: /אוהל 1/ });
    fireEvent.keyDown(item, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(screen.getByText('לא מצאנו את הפריט הזה במפה — אולי הוסר בינתיים')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /מיקום 0 על 0 מטר/ })).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('flags what the drag itself put outside the fence, before the server answers', () => {
    renderBoard([tent({ xCm: 2300 })]);
    const item = screen.getByRole('button', { name: /אוהל 1/ });
    expect(item.getAttribute('aria-label')).not.toContain('מחוץ למגרש');
    fireEvent.keyDown(item, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: /מחוץ למגרש/ })).toBeTruthy();
  });

  it('says a sofa in the sag strip of a net is only partly in shade', () => {
    renderBoard([
      tent({ id: 'net', kind: 'shade', label: 'רשת צל 1', widthCm: 800, depthCm: 800, insetCm: 50 }),
      // In the strip: the net's shaded ground starts at 50, the sofa at 0.
      tent({ id: 'sofa', kind: 'sofa', label: 'ספה 1', xCm: 0, yCm: 0, widthCm: 200, depthCm: 90, sort: 1 }),
    ]);
    expect(screen.getByRole('button', { name: /ספה 1.*חלקית בצל/ })).toBeTruthy();
    expect(screen.getByText('8 × 8 מ׳ · בצל 7 × 7')).toBeTruthy();
  });

  it('opens the drawer on enter', () => {
    renderBoard([tent()]);
    fireEvent.keyDown(screen.getByRole('button', { name: /אוהל 1/ }), { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/site?season=s26&peek=a');
  });
});
