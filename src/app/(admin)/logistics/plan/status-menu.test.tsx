/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { WorkItemStatus } from '@/db/schema/logistics';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { setItemStatusAction } = vi.hoisted(() => ({
  setItemStatusAction: vi.fn(async (_id: string, status: WorkItemStatus): Promise<ActionResult<WorkItemStatus>> => ({ ok: true, value: status })),
}));
vi.mock('./actions', () => ({ setItemStatusAction }));

import { StatusMenu } from './status-menu';

function mount(status: WorkItemStatus) {
  return render(
    <ToastProvider>
      <StatusMenu item={{ id: 'i', title: 'לקנות מכולה', status }} />
    </ToastProvider>,
  );
}

async function choose(label: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /עדכון מצב/ })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })); });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('the quick status control on a row of the plan', () => {
  it('writes the state that was chosen and says it', async () => {
    mount('open');
    await choose('בוטלה');
    expect(setItemStatusAction).toHaveBeenCalledWith('i', 'cancelled');
    expect(await screen.findByText('לקנות מכולה · בוטלה')).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it('names the state the server landed on, not the one that was asked for', async () => {
    // A cancelled purchase line whose purchase arrived in the meantime:
    // reopening it lands on done, because it is.
    setItemStatusAction.mockResolvedValueOnce({ ok: true, value: 'done' });
    mount('cancelled');
    await choose('פתוחה');
    expect(setItemStatusAction).toHaveBeenCalledWith('i', 'open');
    expect(await screen.findByText('לקנות מכולה · הושלמה')).toBeTruthy();
    expect(screen.queryByText('לקנות מכולה · פתוחה')).toBeNull();
  });

  it('offers to undo by writing the previous state back', async () => {
    mount('cancelled');
    await choose('פתוחה');
    const undo = await screen.findByRole('button', { name: /ביטול/ });
    setItemStatusAction.mockClear();
    await act(async () => { fireEvent.click(undo); });
    expect(setItemStatusAction).toHaveBeenCalledWith('i', 'cancelled');
  });
});
