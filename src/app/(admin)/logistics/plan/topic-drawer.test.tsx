/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/action-result';
import type { Topic } from '@/lib/logistics/plan';

const { push, replace, refresh } = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh }) }));

const { createTopicAction, updateTopicAction, setTopicArchivedAction } = vi.hoisted(() => ({
  createTopicAction: vi.fn(async (): Promise<ActionResult<string>> => ({ ok: true, value: 'new' })),
  updateTopicAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  setTopicArchivedAction: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));
vi.mock('./actions', () => ({ createTopicAction, updateTopicAction, setTopicArchivedAction }));

import { TopicDrawer } from './topic-drawer';

const LOUNGE: Topic = {
  id: 'l', seasonId: 's1', name: 'סלון', position: 0, notes: null, archivedAt: null,
  updatedAt: new Date('2026-05-01T09:00:00Z'), updatedBy: 'lead@shliff.camp',
};

function mount(topic: Topic | null) {
  return render(
    <ToastProvider>
      <TopicDrawer topic={topic} seasonId="s1" seasonName="ברן 26" closeHref="/logistics/plan?season=s1" />
    </ToastProvider>,
  );
}

async function press(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('the drawer that adds a topic', () => {
  it('says nothing in English', () => {
    mount(null);
    expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/[A-Za-z]/);
  });

  it('refuses a blank name beside the field, without a round trip', async () => {
    mount(null);
    await press('הוספת הנושא');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/שם/);
    expect(createTopicAction).not.toHaveBeenCalled();
  });

  it('sends the name for the season, then closes', async () => {
    mount(null);
    fireEvent.change(screen.getByLabelText(/שם הנושא/), { target: { value: ' מטבח ' } });
    await press('הוספת הנושא');
    expect(createTopicAction).toHaveBeenCalledWith('s1', { name: ' מטבח ', notes: null });
    expect(push).toHaveBeenCalledWith('/logistics/plan?season=s1');
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the action’s Hebrew refusal and stays open', async () => {
    createTopicAction.mockResolvedValueOnce({ ok: false, error: 'כבר יש נושא בשם הזה בשנה הזו' });
    mount(null);
    fireEvent.change(screen.getByLabelText(/שם הנושא/), { target: { value: 'מטבח' } });
    await press('הוספת הנושא');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('כבר יש נושא בשם הזה בשנה הזו');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('the drawer over a topic', () => {
  it('saves an edit in place', async () => {
    mount(LOUNGE);
    fireEvent.change(screen.getByLabelText(/שם הנושא/), { target: { value: 'סלון ובר' } });
    await press('שמירה');
    expect(updateTopicAction).toHaveBeenCalledWith('l', { name: 'סלון ובר', notes: null });
  });

  it('archives only after a confirmation that names the consequence', async () => {
    mount(LOUNGE);
    await press('העברה לארכיון');
    expect(setTopicArchivedAction).not.toHaveBeenCalled();
    const confirm = screen.getByRole('alertdialog');
    expect(confirm.textContent).toMatch(/המשימות שתחתיו נשארות/);
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'העברה לארכיון' })); });
    expect(setTopicArchivedAction).toHaveBeenCalledWith('l', true);
  });

  it('restores an archived topic with one press', async () => {
    mount({ ...LOUNGE, archivedAt: new Date('2026-05-02T09:00:00Z') });
    await press('החזרה ללוח');
    expect(setTopicArchivedAction).toHaveBeenCalledWith('l', false);
  });
});
