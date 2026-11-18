/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cleanup, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { EXPENSE_REFUSALS, RECORD_REFUSALS } from '@/lib/money/expense-refusals';

const { refresh, compressReceipt } = vi.hoisted(() => ({
  refresh: vi.fn(),
  compressReceipt: vi.fn<(file: File) => Promise<Blob>>(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
/** jsdom has no canvas; the shrinker has its own test. */
vi.mock('./compress-receipt', () => ({ compressReceipt }));

import { ExpenseForm } from './expense-form';

const SEASONS = [{ id: 's1', name: 'ברן 26' }, { id: 's0', name: 'ברן 25' }];
const ACCOUNTS = [
  { id: 'a1', name: 'קופת מזומן', fund: 'camp' as const },
  { id: 'a2', name: 'וייבז קלוז פרינדס', fund: 'gift' as const },
];
const SHRUNK = new Blob([new Uint8Array(2048)], { type: 'image/jpeg' });

let fetchMock: ReturnType<typeof vi.fn>;

function answer(body: unknown, status = 201) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  answer({ ok: true });
  compressReceipt.mockResolvedValue(SHRUNK);
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderForm() {
  return render(<ExpenseForm seasonId="s1" seasons={SEASONS} accounts={ACCOUNTS} today="2026-11-18" />);
}

const amount = () => screen.getByRole('textbox', { name: /כמה שולם/ }) as HTMLInputElement;
const what = () => screen.getByRole('textbox', { name: /על מה/ }) as HTMLInputElement;
const account = () => screen.getByRole('combobox', { name: /מאיזה חשבון שולם/ }) as HTMLSelectElement;
const save = () => screen.getByRole('button', { name: 'רישום ההוצאה' });
const fileInput = (container: HTMLElement) => container.querySelector('input[type="file"]') as HTMLInputElement;

function fillBasics() {
  fireEvent.change(amount(), { target: { value: '184.50' } });
  fireEvent.change(what(), { target: { value: 'קרח ומים' } });
  fireEvent.change(account(), { target: { value: 'a1' } });
}

function sent(): FormData {
  return fetchMock.mock.calls[0][1].body as FormData;
}

describe('the expense form', () => {
  it('starts with no account chosen, today as the date and the page\'s season', () => {
    renderForm();
    expect(account().value).toBe('');
    expect((screen.getByLabelText('תאריך') as HTMLInputElement).value).toBe('2026-11-18');
    expect((screen.getByRole('combobox', { name: /שנה/ }) as HTMLSelectElement).value).toBe('s1');
    expect((screen.getByRole('radio', { name: 'בלי קטגוריה' }) as HTMLInputElement).checked).toBe(true);
  });

  it('names whose money each account is, so the choice says what it means', () => {
    renderForm();
    const groups = [...account().querySelectorAll('optgroup')].map((group) => group.label);
    expect(groups).toHaveLength(2);
    for (const label of groups) expect(label).toMatch(/[א-ת]/);
  });

  it('asks for a phone\'s numeric keypad, and offers the gallery as well as the camera', () => {
    const { container } = renderForm();
    expect(amount().inputMode).toBe('decimal');
    expect(fileInput(container).accept).toBe('image/*');
    expect(fileInput(container).hasAttribute('capture')).toBe(false);
  });

  it.each([
    ['no amount', () => { fireEvent.change(what(), { target: { value: 'קרח' } }); }, EXPENSE_REFUSALS.amount],
    ['a zero amount', () => { fillBasics(); fireEvent.change(amount(), { target: { value: '0' } }); }, EXPENSE_REFUSALS.amount],
    ['an amount that is not a number', () => { fillBasics(); fireEvent.change(amount(), { target: { value: 'מאה' } }); }, EXPENSE_REFUSALS.amount],
    ['no description', () => { fillBasics(); fireEvent.change(what(), { target: { value: '  ' } }); }, EXPENSE_REFUSALS.description],
    ['no account', () => { fillBasics(); fireEvent.change(account(), { target: { value: '' } }); }, EXPENSE_REFUSALS.pickAccount],
  ])('refuses %s in the library\'s own words, and sends nothing', async (_label, arrange, sentence) => {
    renderForm();
    arrange();
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toBe(sentence);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the fields as one multipart request', async () => {
    renderForm();
    fillBasics();
    fireEvent.click(screen.getByRole('radio', { name: 'אוכל ושתייה' }));
    fireEvent.click(save());
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1); });
    expect(fetchMock.mock.calls[0][0]).toBe('/money/expenses/record');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(Object.fromEntries(sent().entries())).toEqual({
      amount: '184.50', description: 'קרח ומים', category: 'food',
      accountId: 'a1', seasonId: 's1', occurredOn: '2026-11-18',
    });
  });

  it('shrinks the photo before sending it, and sends the shrunk one', async () => {
    const { container } = renderForm();
    fillBasics();
    const original = new File([new Uint8Array(6 * 1024 * 1024)], 'IMG_0412.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput(container), { target: { files: [original] } });
    expect(await screen.findByText('הקבלה צורפה')).toBeTruthy();
    expect(compressReceipt).toHaveBeenCalledWith(original);
    expect(screen.getByText('2 KB')).toBeTruthy();

    fireEvent.click(save());
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1); });
    const receipt = sent().get('receipt') as File;
    expect(receipt.size).toBe(SHRUNK.size);
    expect(receipt.type).toBe('image/jpeg');
  });

  it('lets the photo be taken off again before sending', async () => {
    const { container } = renderForm();
    fillBasics();
    fireEvent.change(fileInput(container), {
      target: { files: [new File([new Uint8Array(10)], 'r.jpg', { type: 'image/jpeg' })] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'הסרה' }));
    fireEvent.click(save());
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1); });
    expect(sent().has('receipt')).toBe(false);
  });

  it('after a save: says what was recorded, clears the expense, keeps the account, and refreshes the list', async () => {
    renderForm();
    fillBasics();
    fireEvent.click(screen.getByRole('radio', { name: 'ציוד' }));
    fireEvent.click(save());
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('קרח ומים');
    expect(status.textContent).toContain('184.50');
    expect(amount().value).toBe('');
    expect(what().value).toBe('');
    expect((screen.getByRole('radio', { name: 'בלי קטגוריה' }) as HTMLInputElement).checked).toBe(true);
    expect(account().value).toBe('a1');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('offers the last account used here the next time, and only if it still exists', async () => {
    renderForm();
    fillBasics();
    fireEvent.change(account(), { target: { value: 'a2' } });
    fireEvent.click(save());
    await screen.findByRole('status');
    cleanup();

    renderForm();
    await waitFor(() => { expect(account().value).toBe('a2'); });
    cleanup();

    render(<ExpenseForm seasonId="s1" seasons={SEASONS} accounts={[ACCOUNTS[0]]} today="2026-11-18" />);
    expect(account().value).toBe('');
  });

  it('shows the server\'s refusal and keeps everything that was typed', async () => {
    answer({ ok: false, error: EXPENSE_REFUSALS.closedAccount }, 400);
    renderForm();
    fillBasics();
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toBe(EXPENSE_REFUSALS.closedAccount);
    expect(amount().value).toBe('184.50');
    expect(what().value).toBe('קרח ומים');
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each([
    ['the request never arrives', () => { fetchMock.mockRejectedValue(new TypeError('Failed to fetch')); }],
    ['the answer is an error page, not ours', () => {
      fetchMock.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    }],
    ['the refusal carries no sentence', () => { answer({ ok: false }, 500); }],
  ])('says so in Hebrew when %s, and keeps what was typed', async (_label, arrange) => {
    arrange();
    renderForm();
    fillBasics();
    fireEvent.click(save());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(RECORD_REFUSALS.offline);
    expect(alert.textContent).not.toMatch(/[A-Za-z]/);
    expect(amount().value).toBe('184.50');
    expect(refresh).not.toHaveBeenCalled();
  });
});
