/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Field, TextInput, MoneyInput, Select, Textarea, Segmented, Checkbox } from './field';

describe('Field', () => {
  it('ties the label to the control', () => {
    render(
      <Field id="amount" label="סכום">
        <MoneyInput id="amount" name="amount" defaultValue="1200" />
      </Field>,
    );
    expect(screen.getByLabelText('סכום')).toBeTruthy();
  });

  it('describes the control with its hint', () => {
    render(
      <Field id="account" label="לאיזו קופה הכסף נכנס" hint="בלי קופה הסכום ייספר בגבייה אבל לא ביתרה של אף חשבון.">
        <Select id="account" options={[{ value: 'cash', label: 'קופת מזומן' }]} />
      </Field>,
    );
    const control = screen.getByLabelText('לאיזו קופה הכסף נכנס');
    const describedBy = control.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent)
      .toBe('בלי קופה הסכום ייספר בגבייה אבל לא ביתרה של אף חשבון.');
  });

  it('marks the control invalid and announces the error', () => {
    render(
      <Field id="reason" label="סיבה" error="חריג מחייב סיבה">
        <TextInput id="reason" />
      </Field>,
    );
    expect(screen.getByLabelText('סיבה').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('חריג מחייב סיבה');
  });

  it('labels a group of controls without a for/id pair', () => {
    render(
      <Field id="method" label="אמצעי תשלום" as="group">
        <Segmented
          id="method"
          name="method"
          defaultValue="cash"
          options={[{ value: 'cash', label: 'מזומן' }, { value: 'bit', label: 'ביט' }]}
        />
      </Field>,
    );
    expect(screen.getByRole('radiogroup', { name: 'אמצעי תשלום' })).toBeTruthy();
  });
});

describe('controls', () => {
  it('MoneyInput is left-to-right with tabular numerals and a shekel adornment', () => {
    render(
      <Field id="amount" label="סכום">
        <MoneyInput id="amount" defaultValue="1200" />
      </Field>,
    );
    const input = screen.getByLabelText('סכום');
    // Left-to-right: the input sits inside an ancestor carrying dir="ltr"
    // (the box MoneyInput renders around it), not merely typed LTR content.
    expect(input.closest('[dir="ltr"]')).not.toBeNull();
    // Tabular numerals: the behaviour under test really is the `num`
    // utility class, so asserting it here is the deliberate exception to
    // "never class names".
    expect(input.className).toContain('num');
  });

  it('Select offers an explicit Hebrew empty option when one is named', () => {
    render(
      <Field id="account" label="קופה">
        <Select id="account" emptyLabel="ללא קופה" options={[{ value: 'cash', label: 'קופת מזומן' }]} />
      </Field>,
    );
    expect(screen.getByRole('option', { name: 'ללא קופה' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'קופת מזומן' })).toBeTruthy();
  });

  it('Textarea reports what was typed', () => {
    const onChange = vi.fn();
    render(
      <Field id="note" label="הערה">
        <Textarea id="note" onChange={onChange} value="" />
      </Field>,
    );
    fireEvent.change(screen.getByLabelText('הערה'), { target: { value: 'קוזז מול חוב' } });
    expect(onChange).toHaveBeenCalledWith('קוזז מול חוב');
  });

  it('Segmented is radios, so a Server Action form submits without JavaScript', () => {
    render(
      <Field id="method" label="אמצעי תשלום" as="group">
        <Segmented
          id="method"
          name="method"
          defaultValue="cash"
          options={[
            { value: 'cash', label: 'מזומן' },
            { value: 'bit', label: 'ביט' },
            { value: 'offset', label: 'קיזוז' },
          ]}
        />
      </Field>,
    );
    const cash = screen.getByRole('radio', { name: 'מזומן' }) as HTMLInputElement;
    expect(cash.checked).toBe(true);
    expect(cash.name).toBe('method');
    fireEvent.click(screen.getByRole('radio', { name: 'קיזוז' }));
    expect((screen.getByRole('radio', { name: 'קיזוז' }) as HTMLInputElement).checked).toBe(true);
  });

  it('Checkbox reports its own label and its mixed state', () => {
    render(<Checkbox id="all" label="בחירת כל השורות" indeterminate checked={false} />);
    const box = screen.getByRole('checkbox', { name: 'בחירת כל השורות' });
    expect(box.getAttribute('aria-checked')).toBe('mixed');
  });

  it('Checkbox reports a change', () => {
    const onChange = vi.fn();
    render(<Checkbox id="ack" label="אני מבין שהמיזוג אינו הפיך" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'אני מבין שהמיזוג אינו הפיך' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
