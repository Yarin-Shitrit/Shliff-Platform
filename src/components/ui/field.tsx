/**
 * C13, the kit's one multi-export file: `Field` and its six controls ship
 * together because a `Field` without its controls is an empty box and a
 * control outside a `Field` has no label.
 *
 * `Field` owns the hint and the error, so `Field` is what knows their ids —
 * and it injects them into its single child with `cloneElement`. A screen
 * writes `<Field error="…"><TextInput id="…" /></Field>` and nothing else;
 * it never repeats the error on the control. Each control declares the three
 * ARIA keys on `ControlShared` and forwards them untouched.
 *
 * R7: no control here carries `'use client'`. Each takes `defaultValue` for
 * the uncontrolled Server-Action case and `value`+`onChange` for the
 * controlled client case — the state, if any, lives in the caller.
 */
import {
  Children, cloneElement, isValidElement,
  type ReactElement, type ReactNode,
} from 'react';
import { Icon, type IconName } from '@/components/ui/icon';
import { cx } from './cx';
import styles from './field.module.css';

export type FieldProps = {
  /** The control's `id`. `Field` derives the hint's and the error's ids from it. */
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  /** A group of controls (Segmented, a set of checkboxes) labels itself with a
      `<span>` and `aria-labelledby`; a single control uses a real `<label for>`. */
  as?: 'label' | 'group';
  required?: boolean;
  children: ReactNode;
};

type ControlShared = {
  id: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  /** Injected by `Field`. A caller never sets these by hand. */
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-errormessage'?: string;
};

function ariaOf(props: ControlShared) {
  return {
    'aria-describedby': props['aria-describedby'],
    'aria-invalid': props['aria-invalid'],
    'aria-errormessage': props['aria-errormessage'],
  } as const;
}

export function hintId(id: string): string { return `${id}-hint`; }
export function errorId(id: string): string { return `${id}-error`; }
export function labelId(id: string): string { return `${id}-label`; }

export function Field({
  id, label, hint, error, as = 'label', required, children,
}: FieldProps): ReactElement {
  const described = [
    hint !== undefined ? hintId(id) : null,
    error !== undefined ? errorId(id) : null,
  ].filter((part): part is string => part !== null).join(' ');

  const child = Children.only(children);
  const control = isValidElement(child)
    ? cloneElement(child as ReactElement<Record<string, unknown>>, {
        'aria-describedby': described === '' ? undefined : described,
        'aria-invalid': error !== undefined ? true : undefined,
        'aria-errormessage': error !== undefined ? errorId(id) : undefined,
      })
    : child;

  return (
    <div className={styles.field}>
      {as === 'label' ? (
        <label className={styles.label} htmlFor={id}>
          {label}{required ? <span className={styles.required} aria-hidden="true"> *</span> : null}
        </label>
      ) : (
        <span className={styles.label} id={labelId(id)}>
          {label}{required ? <span className={styles.required} aria-hidden="true"> *</span> : null}
        </span>
      )}

      <div className={styles.control}>{control}</div>

      {hint !== undefined ? <span className={styles.hint} id={hintId(id)}>{hint}</span> : null}
      {error !== undefined ? (
        <p className={styles.error} id={errorId(id)} role="alert">{error}</p>
      ) : null}
    </div>
  );
}

export type TextInputProps = ControlShared & {
  value?: string; defaultValue?: string; placeholder?: string;
  onChange?: (value: string) => void;
  /** A leading icon inside the box. */
  icon?: IconName;
};

export function TextInput({ icon, onChange, ...props }: TextInputProps): ReactElement {
  const { id, name, disabled, required, value, defaultValue, placeholder } = props;
  return (
    <span className={styles.box}>
      {icon ? <span className={styles.boxIcon}><Icon name={icon} size={15} /></span> : null}
      <input
        className={styles.input}
        type="text" id={id} name={name} disabled={disabled} required={required}
        value={value} defaultValue={defaultValue} placeholder={placeholder}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        {...ariaOf(props)}
      />
    </span>
  );
}

/** LTR box, physically right-aligned, tabular numerals, `₪` as a trailing adornment. */
export type MoneyInputProps = ControlShared & {
  value?: string; defaultValue?: string; onChange?: (value: string) => void;
};

/**
 * The box carries `dir="ltr"` — the same tool `Money` and `DateText` use in
 * `src/components/format.tsx` for inherently left-to-right content — so the
 * `₪` renders as a trailing adornment after the digits. The digits themselves
 * reuse the global `.num` utility (the one place A10 documents a physical
 * `text-align`) rather than this stylesheet declaring a second one.
 */
export function MoneyInput({ onChange, ...props }: MoneyInputProps): ReactElement {
  const { id, name, disabled, required, value, defaultValue } = props;
  return (
    <span className={cx(styles.box, styles.money)} dir="ltr">
      <input
        className={cx(styles.input, 'num')}
        type="text" inputMode="decimal"
        id={id} name={name} disabled={disabled} required={required}
        value={value} defaultValue={defaultValue}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        {...ariaOf(props)}
      />
      <span className={styles.adornment}>₪</span>
    </span>
  );
}

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectProps = ControlShared & {
  options: readonly SelectOption[];
  value?: string; defaultValue?: string;
  onChange?: (value: string) => void;
  /** The empty option's Hebrew text, e.g. `ללא קופה`. Omitted means no empty option. */
  emptyLabel?: string;
};

export function Select({ options, emptyLabel, onChange, ...props }: SelectProps): ReactElement {
  const { id, name, disabled, required, value, defaultValue } = props;
  return (
    <span className={styles.box}>
      <select
        className={styles.input}
        id={id} name={name} disabled={disabled} required={required}
        value={value} defaultValue={defaultValue}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        {...ariaOf(props)}
      >
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export type TextareaProps = ControlShared & {
  value?: string; defaultValue?: string; placeholder?: string; rows?: number;
  onChange?: (value: string) => void;
};

export function Textarea({ onChange, rows = 2, ...props }: TextareaProps): ReactElement {
  const { id, name, disabled, required, value, defaultValue, placeholder } = props;
  return (
    <textarea
      className={cx(styles.box, styles.textarea)}
      id={id} name={name} disabled={disabled} required={required} rows={rows}
      value={value} defaultValue={defaultValue} placeholder={placeholder}
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      {...ariaOf(props)}
    />
  );
}

export type SegmentedOption = { value: string; label: string; icon?: IconName };
export type SegmentedProps = Omit<ControlShared, 'required'> & {
  /** The radio group's shared `name` — it is what a Server Action reads. */
  name: string;
  /** Matches the `Field`'s `id`, so `aria-labelledby` lines up. */
  id: string;
  options: readonly SegmentedOption[];
  value?: string; defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
};

/**
 * Radios, not `aria-pressed` buttons: D5's payment-method picker sits inside a
 * Server Action form and has to submit its value with no JavaScript at all. A
 * radio group does that, gets `aria-checked` for free, and gets arrow-key
 * navigation from the browser natively.
 */
export function Segmented({
  name, id, options, value, defaultValue, onChange, disabled, ...rest
}: SegmentedProps): ReactElement {
  return (
    <span
      className={styles.segmented}
      role="radiogroup"
      aria-labelledby={labelId(id)}
      {...ariaOf({ id, ...rest })}
    >
      {options.map((option) => (
        <label key={option.value} className={styles.segment}>
          <input
            className={styles.segmentInput}
            type="radio" name={name} value={option.value} disabled={disabled}
            checked={value === undefined ? undefined : value === option.value}
            defaultChecked={value === undefined ? defaultValue === option.value : undefined}
            onChange={onChange ? () => onChange(option.value) : undefined}
          />
          <span className={styles.segmentFace}>
            {option.icon ? <Icon name={option.icon} size={14} /> : null}
            {option.label}
          </span>
        </label>
      ))}
    </span>
  );
}

export type CheckboxProps = {
  id: string;
  name?: string;
  label: string;
  checked?: boolean; defaultChecked?: boolean;
  /** The header "select all" third state (`aria-checked="mixed"`). */
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
};

/**
 * The mixed state is announced through `aria-checked="mixed"` alone, never
 * through the DOM `indeterminate` property: setting that property needs a
 * ref and an effect, which would make every form that uses it a client tree.
 * `Table`'s header checkbox already relies on the same trick.
 */
export function Checkbox({
  id, name, label, checked, defaultChecked, indeterminate, onChange, disabled,
}: CheckboxProps): ReactElement {
  return (
    <label className={styles.checkbox} htmlFor={id}>
      <input
        className={styles.checkboxInput}
        type="checkbox" id={id} name={name} disabled={disabled}
        checked={checked} defaultChecked={defaultChecked}
        aria-checked={indeterminate === true ? 'mixed' : undefined}
        onChange={onChange ? (event) => onChange(event.target.checked) : undefined}
      />
      <span className={styles.checkboxLabel}>{label}</span>
    </label>
  );
}
