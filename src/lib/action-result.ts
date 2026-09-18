/**
 * What every server action in the admin sections returns.
 *
 * `T` is what the caller needs back in order to *undo* the write — E2's rule
 * that undo is the domain's own inverse, never a UI stack. `recordPaymentAction`
 * returns the new payment's id so the toast can offer `deletePaymentAction(id)`,
 * which restores the exact prior state; an action with no undo leaves `T` at
 * `never` and returns a bare `{ ok: true }`.
 *
 * `value` is optional for that reason, and the widening is additive: every
 * existing `Promise<ActionResult>` signature and every `return { ok: true }`
 * still compiles untouched.
 */
export type ActionResult<T = never> =
  | { ok: true; value?: T }
  | { ok: false; error: string };
