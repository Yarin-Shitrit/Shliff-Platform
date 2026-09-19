/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { UploadDrop } from './upload-drop';
import { MAX_UPLOAD_BYTES } from '@/lib/import/upload-limits';

/** A file whose size is dictated rather than allocated. */
function fakeFile(name: string, size: number): File {
  const file = new File(['zip-magic'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function dropZone() {
  return screen.getByRole('button', { name: /גררו לכאן קובץ/ });
}

beforeEach(() => {
  push.mockClear();
  vi.stubGlobal('fetch', vi.fn());
});

describe('UploadDrop', () => {
  it('states the rules before anything is chosen', () => {
    render(<UploadDrop />);
    expect(screen.getByText(/קובץ אקסל \(xlsx\) בלבד, עד 4 מגה־בייט/)).toBeTruthy();
  });

  it('refuses the wrong extension without reaching the server', () => {
    render(<UploadDrop />);
    fireEvent.drop(dropZone(), { dataTransfer: { files: [fakeFile('תקציב.csv', 1024)] } });
    expect(screen.getByText('אפשר להעלות רק קובץ אקסל בפורמט xlsx.')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses an oversized file without reaching the server', () => {
    render(<UploadDrop />);
    fireEvent.drop(dropZone(), {
      dataTransfer: { files: [fakeFile('ענק.xlsx', MAX_UPLOAD_BYTES + 1)] },
    });
    expect(screen.getByText('הקובץ גדול מדי — עד 4 מגה־בייט.')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends an accepted file and opens its review', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => ({ uploadId: 'u1' }),
    });
    render(<UploadDrop />);
    fireEvent.drop(dropZone(), {
      dataTransfer: { files: [fakeFile('קופת קאמפ 2026.xlsx', 2048)] },
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/imports/u1'));
  });

  it('carries the duplicate flag into the review rather than swallowing it', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => ({ uploadId: 'u9', duplicate: true }),
    });
    render(<UploadDrop />);
    fireEvent.drop(dropZone(), { dataTransfer: { files: [fakeFile('שוב.xlsx', 2048)] } });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/imports/u9?duplicate=1'));
  });

  it('shows Hebrew for a server refusal and lets the lead try again', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, json: async () => ({ error: 'import failed' }),
    });
    render(<UploadDrop />);
    fireEvent.drop(dropZone(), { dataTransfer: { files: [fakeFile('שבור.xlsx', 2048)] } });
    await waitFor(() => expect(screen.getByText(
      'לא הצלחנו לקרוא את הקובץ. ודאו שזה קובץ אקסל תקין ונסו שוב.',
    )).toBeTruthy());
    await waitFor(() => expect(dropZone().hasAttribute('disabled')).toBe(false));
  });

  it('survives a response that is not JSON at all', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    });
    render(<UploadDrop />);
    fireEvent.drop(dropZone(), { dataTransfer: { files: [fakeFile('שבור.xlsx', 2048)] } });
    await waitFor(() => expect(screen.getByText('ההעלאה נכשלה, נסו שוב.')).toBeTruthy());
  });
});
