/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';

const { nameObligationAction, refresh, replace } = vi.hoisted(() => ({
  nameObligationAction: vi.fn<(input: unknown) => Promise<ActionResult>>(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({ nameObligationAction }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace }) }));

import { NameForm } from './name-form';

const PEOPLE = [
  { id: 'p1', displayName: 'רוני אדלר' },
  { id: 'p2', displayName: 'מאיה פרץ' },
];

/** U+200F, a right-to-left mark: invisible, and truthy to `.trim()`. */
const RLM = '‏';

function renderForm(over: Record<string, unknown> = {}) {
  render(
    <NameForm
      obligationId="o1"
      people={PEOPLE}
      closeHref="/money/debts?season=s1"
      {...over}
    />,
  );
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'רישום למי החוב' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  nameObligationAction.mockResolvedValue({ ok: true });
});

describe('NameForm', () => {
  it('starts on the roster, and sends the chosen person and nothing else', async () => {
    renderForm();
    fireEvent.change(screen.getByRole('combobox', { name: 'מי' }), { target: { value: 'p2' } });
    submit();
    await waitFor(() => expect(nameObligationAction).toHaveBeenCalledWith({
      obligationId: 'o1', personId: 'p2', partyName: undefined,
    }));
    expect(replace).toHaveBeenCalledWith('/money/debts?season=s1');
    expect(refresh).toHaveBeenCalled();
  });

  it('refuses to send with nobody chosen, in its own words, and writes nothing', async () => {
    renderForm();
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('צריך לבחור אדם מהרשימה');
    expect(nameObligationAction).not.toHaveBeenCalled();
  });

  it('sends a bare name for someone the roster does not know', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('radio', { name: 'שם שאינו ברשימה' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'שם' }), { target: { value: 'חנות הקרח' } });
    submit();
    await waitFor(() => expect(nameObligationAction).toHaveBeenCalledWith({
      obligationId: 'o1', personId: undefined, partyName: 'חנות הקרח',
    }));
  });

  it('treats a name of only an invisible mark as no name', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('radio', { name: 'שם שאינו ברשימה' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'שם' }), { target: { value: RLM } });
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('צריך לרשום שם');
    expect(nameObligationAction).not.toHaveBeenCalled();
  });

  it('shows the action’s Hebrew refusal and stays open', async () => {
    nameObligationAction.mockResolvedValue({ ok: false, error: 'לחוב הזה כבר רשום אדם' });
    renderForm();
    fireEvent.change(screen.getByRole('combobox', { name: 'מי' }), { target: { value: 'p1' } });
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('לחוב הזה כבר רשום אדם');
    expect(replace).not.toHaveBeenCalled();
  });

  it('offers only the bare name when the roster is empty, and says so', () => {
    renderForm({ people: [] });
    expect(screen.getByText('עדיין אין אנשים ברשימה, אז אפשר לרשום רק שם.')).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'אדם מהרשימה' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('textbox', { name: 'שם' })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
