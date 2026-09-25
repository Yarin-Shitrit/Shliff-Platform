/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { unnamedControls } from '@/test/a11y';
import type { EditorUnderlay } from '@/lib/site/editor/model';
import { UnderlayCard, type UnderlayCardProps } from './underlay-card';

const LRI = '⁦';
const PDI = '⁩';
const IMAGE: EditorUnderlay = {
  storageKey: `site-underlays/0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a/${'a'.repeat(64)}.png`, contentType: 'image/png',
  sizeBytes: 812_345, filename: 'שרטוט המגרש.png', centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0, calibration: null,
};
const CALIBRATED: EditorUnderlay = { ...IMAGE, calibration: { from: [0.1, 0.5], to: [0.9, 0.5], distanceCm: 2600 } };

function renderCard(over: Partial<UnderlayCardProps> = {}) {
  const props: UnderlayCardProps = {
    underlay: IMAGE, status: { state: 'ready', aspect: 0.75 }, view: { shown: true, opacity: 0.5 }, tool: 'select',
    sending: false, uploadError: null, draft: { points: [], refusal: null },
    onFile: vi.fn(), onCalibrate: vi.fn(), onApplyCalibration: vi.fn(), onCancelCalibration: vi.fn(), onAlign: vi.fn(),
    onFinishAlign: vi.fn(), onTurn: vi.fn(), onOpacity: vi.fn(), onRemove: vi.fn(), onRetry: vi.fn(), onClose: vi.fn(),
    ...over,
  };
  const view = render(<UnderlayCard {...props} />);
  return { ...view, props, rerenderWith: (next: Partial<UnderlayCardProps>) => { view.rerender(<UnderlayCard {...props} {...next} />); } };
}

const button = (name: string) => screen.getByRole('button', { name });
const fileInput = (container: HTMLElement) => container.querySelector('input[type="file"]') as HTMLInputElement;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the picture’s card', () => {
  it('invites an upload when the map has no picture, by its button or by a drop', () => {
    const picked = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const { container, props } = renderCard({ underlay: null, status: { state: 'none' } });
    expect(screen.getByText('אפשר להעלות צילום או סריקה של שרטוט המגרש ולהניח עליו את הפריטים ביד. אחרי ההעלאה, סימון של מרחק ידוע על התמונה — למשל אורך הגדר — קובע את קנה המידה. צילום ישר מלמעלה, או סריקה, ייתנו את התוצאה המדויקת ביותר.')).toBeTruthy();
    expect(screen.getByText('PNG,‏ JPEG או WebP, עד 4 מגה־בייט')).toBeTruthy();
    fireEvent.click(button('העלאת תמונה'));
    expect(picked).toHaveBeenCalled();
    const sketch = new File(['x'], 'sketch.png', { type: 'image/png' });
    fireEvent.change(fileInput(container), { target: { files: [sketch] } });
    expect(props.onFile).toHaveBeenLastCalledWith(sketch);
    const dropped = new File(['y'], 'scan.jpg', { type: 'image/jpeg' });
    fireEvent.drop(screen.getByRole('group', { name: 'תמונת רקע' }), { dataTransfer: { files: [dropped] } });
    expect(props.onFile).toHaveBeenLastCalledWith(dropped);
  });

  it('says it is uploading, and why an upload was refused', () => {
    const { rerenderWith } = renderCard({ underlay: null, sending: true });
    expect(screen.getByRole('status').textContent).toBe('מעלה…');
    expect(screen.queryByRole('button', { name: 'העלאת תמונה' })).toBeNull();
    rerenderWith({ underlay: null, sending: false, uploadError: 'קובץ PDF אי אפשר להעלות כרקע. צילום מסך של העמוד יעבוד.' });
    expect(screen.getByRole('alert').textContent).toBe('קובץ PDF אי אפשר להעלות כרקע. צילום מסך של העמוד יעבוד.');
  });

  it('says it is loading the picture, and offers no calibration or moving until it can be shown', () => {
    renderCard({ status: { state: 'loading' } });
    expect(screen.getByText('טוען…')).toBeTruthy();
    expect((button('כיול') as HTMLButtonElement).disabled).toBe(true);
    expect((button('הזזה') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a picture could not be shown and offers a retry, and says a missing file can be uploaded again', () => {
    const { props, rerenderWith } = renderCard({ status: { state: 'failed' } });
    expect(screen.getByRole('alert').textContent).toBe('לא הצלחנו להציג את התמונה. אפשר לנסות שוב, או להעלות אותה מחדש.');
    fireEvent.click(button('ניסיון נוסף'));
    expect(props.onRetry).toHaveBeenCalled();
    rerenderWith({ status: { state: 'missing' } });
    expect(screen.getByRole('alert').textContent).toBe('קובץ התמונה לא נמצא. אפשר להעלות אותו מחדש.');
  });

  it('says an uncalibrated picture’s scale is temporary, and every scale figure opens the calibration', () => {
    const { props } = renderCard();
    expect(screen.getByText('שרטוט המגרש.png')).toBeTruthy();
    expect(screen.getByText('לא כוילה')).toBeTruthy();
    expect(screen.getByText('קנה המידה זמני עד הכיול.')).toBeTruthy();
    fireEvent.click(button('כיול'));
    fireEvent.click(button(`מכסה על המפה ${LRI}26 × 19.5 מ׳${PDI}`));
    expect(props.onCalibrate).toHaveBeenCalledTimes(2);
    expect(screen.getByText('כשהתמונה מוצגת, היא נכללת גם בייצוא התמונה של המפה.')).toBeTruthy();
  });

  it('says what a calibrated picture was calibrated from, and offers to calibrate again', () => {
    const { props } = renderCard({ underlay: CALIBRATED });
    expect(screen.getByText(`כויל לפי ${LRI}26 מ׳${PDI} שסומנו על התמונה`)).toBeTruthy();
    expect(screen.queryByText('לא כוילה')).toBeNull();
    fireEvent.click(button('כיול מחדש'));
    expect(props.onCalibrate).toHaveBeenCalled();
    expect(screen.getByText('הכיול יתחיל מחדש')).toBeTruthy();
  });

  it('sets this viewer’s opacity, from 10% to 100% in tens, and names it for what it sets (review U1)', () => {
    const { props, rerenderWith } = renderCard();
    const slider = screen.getByRole('slider', { name: 'אטימות' }) as HTMLInputElement;
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual(['10', '100', '10', '50']);
    expect(slider.getAttribute('aria-valuetext')).toBe('50%');
    expect(screen.getByText(`אטימות ${LRI}50%${PDI}`)).toBeTruthy();
    fireEvent.change(slider, { target: { value: '30' } });
    expect(props.onOpacity).toHaveBeenCalledWith(0.3);
    // "אטימות 30%" is a picture 30% opaque — nearly see-through — which is what 0.3 draws.
    rerenderWith({ view: { shown: true, opacity: 0.3 } });
    expect(screen.getByText(`אטימות ${LRI}30%${PDI}`)).toBeTruthy();
    expect(screen.queryByText(/שקיפות/)).toBeNull();
  });

  it('moves, replaces and removes the picture', () => {
    const picked = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const { props } = renderCard();
    fireEvent.click(button('הזזה'));
    expect(props.onAlign).toHaveBeenCalled();
    fireEvent.click(button('החלפת תמונה'));
    expect(picked).toHaveBeenCalled();
    fireEvent.click(button('הסרת התמונה'));
    expect(props.onRemove).toHaveBeenCalled();
  });

  it('walks the calibration: the first point, the second, then the distance and the parallel box', () => {
    const { props, rerenderWith } = renderCard({ tool: 'calibrate' });
    expect(screen.getByRole('status').textContent).toBe('סימון הנקודה הראשונה על התמונה');
    expect(screen.getByText('הכיול נעשה בתצוגת תוכנית.')).toBeTruthy();
    rerenderWith({ tool: 'calibrate', draft: { points: [[0.1, 0.5]], refusal: null } });
    expect(screen.getByRole('status').textContent).toBe('סימון הנקודה השנייה');
    rerenderWith({ tool: 'calibrate', draft: { points: [[0.1, 0.5], [0.9, 0.5]], refusal: null } });
    fireEvent.change(screen.getByLabelText('המרחק בין שתי הנקודות, במטרים'), { target: { value: '26' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'הקו הזה מקביל לגדר' }));
    fireEvent.click(button('כיול'));
    expect(props.onApplyCalibration).toHaveBeenCalledWith('26', true);
    fireEvent.click(button('ביטול'));
    expect(props.onCancelCalibration).toHaveBeenCalled();
  });

  it('ends the calibration on Esc in its form, the distance box included (review U1)', () => {
    const { props } = renderCard({ tool: 'calibrate', draft: { points: [[0.1, 0.5], [0.9, 0.5]], refusal: null } });
    const distance = screen.getByLabelText('המרחק בין שתי הנקודות, במטרים');
    fireEvent.change(distance, { target: { value: '2' } });
    fireEvent.keyDown(distance, { key: 'Escape', code: 'Escape' });
    expect(props.onCancelCalibration).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('checkbox', { name: 'הקו הזה מקביל לגדר' }), { key: 'Escape', code: 'Escape' });
    expect(props.onCancelCalibration).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(distance, { key: 'Enter', code: 'Enter' });
    expect(props.onCancelCalibration).toHaveBeenCalledTimes(2);
  });

  it('shows a calibration refusal in Hebrew, beside the distance it is about', () => {
    renderCard({ tool: 'calibrate', draft: { points: [[0.1, 0.5], [0.12, 0.5]], refusal: 'שתי הנקודות קרובות מדי זו לזו. מרחק ארוך, כמו צלע של הגדר, נותן כיול מדויק יותר.' } });
    expect(screen.getByRole('alert').textContent).toBe('שתי הנקודות קרובות מדי זו לזו. מרחק ארוך, כמו צלע של הגדר, נותן כיול מדויק יותר.');
    expect(screen.getByLabelText('המרחק בין שתי הנקודות, במטרים').getAttribute('aria-invalid')).toBe('true');
  });

  it('aligns: a quarter turn either way, and done', () => {
    const { props } = renderCard({ tool: 'align' });
    expect(screen.getByText('גרירה מזיזה את התמונה · החצים — 10 ס״מ, עם Shift — מטר · Esc — סיום')).toBeTruthy();
    fireEvent.click(button('סיבוב רבע ימינה'));
    fireEvent.click(button('סיבוב רבע שמאלה'));
    expect(props.onTurn).toHaveBeenNthCalledWith(1, 1);
    expect(props.onTurn).toHaveBeenNthCalledWith(2, -1);
    fireEvent.click(button('סיום'));
    expect(props.onFinishAlign).toHaveBeenCalled();
  });

  it('closes', () => {
    const { props } = renderCard();
    fireEvent.click(button('סגירה'));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('names every control, and writes no Latin but the formats and keys spec §20 names', () => {
    for (const over of [
      { underlay: null, status: { state: 'none' } },
      {},
      { underlay: CALIBRATED },
      { status: { state: 'failed' } },
      { tool: 'calibrate', draft: { points: [[0.1, 0.5], [0.9, 0.5]], refusal: null } },
      { tool: 'align' },
    ] as Array<Partial<UnderlayCardProps>>) {
      const { container, unmount } = renderCard(over);
      expect(unnamedControls(container)).toEqual([]);
      // The file's own name ("שרטוט המגרש.png") is the lead's data, not copy: its extension is let through too.
      const latin = (container.textContent ?? '').match(/[A-Za-z]+/g) ?? [];
      expect(latin.filter((word) => !['PNG', 'JPEG', 'WebP', 'Shift', 'Esc', 'png'].includes(word))).toEqual([]);
      unmount();
    }
  });
});
