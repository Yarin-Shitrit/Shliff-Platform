/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { setMarkAction } = vi.hoisted(() => ({
  setMarkAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => ({ setMarkAction }));

import { MarkToggle } from './mark-toggle';

function mount(present: boolean) {
  return render(
    <ToastProvider>
      <MarkToggle eventId="e1" personId="p1" personName="דנה" eventName="יום עבודה 14/03/27" present={present} />
    </ToastProvider>,
  );
}

beforeEach(() => { vi.clearAllMocks(); });

describe('one check on the attendance board', () => {
  it('names the verb and the two things it joins, and carries the state', () => {
    mount(false);
    const button = screen.getByRole('button', { name: 'סימון נוכחות · דנה · יום עבודה 14/03/27' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('marks on press, says so, and offers the inverse', async () => {
    mount(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /סימון נוכחות/ })); });
    expect(setMarkAction).toHaveBeenCalledWith('e1', 'p1', true);
    expect(screen.getByRole('button', { name: /הסרת סימון/ }).getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByText(/סומן כנוכח/)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ביטול' })); });
    expect(setMarkAction).toHaveBeenLastCalledWith('e1', 'p1', false);
  });

  it('takes a mark back from a pressed check', async () => {
    mount(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /הסרת סימון/ })); });
    expect(setMarkAction).toHaveBeenCalledWith('e1', 'p1', false);
    expect(await screen.findByText(/הסימון הוסר/)).toBeTruthy();
  });

  it('shows the action’s Hebrew refusal and puts the check back the way it was', async () => {
    setMarkAction.mockResolvedValueOnce({ ok: false, error: 'האדם הזה לא ברשימת החברים של השנה' });
    mount(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /סימון נוכחות/ })); });
    expect(await screen.findByText(/לא ברשימת החברים/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /סימון נוכחות/ }).getAttribute('aria-pressed')).toBe('false');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('says nothing in English', () => {
    const { container } = mount(false);
    expect(container.textContent ?? '').not.toMatch(/[A-Za-z]/);
    expect(screen.getByRole('button').getAttribute('aria-label')).not.toMatch(/[A-Za-z]/);
  });
});
