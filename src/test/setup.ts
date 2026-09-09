import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Global test setup, wired via vitest.config.ts's `setupFiles`.
 *
 * `@testing-library/react`'s own auto-cleanup only self-registers when it
 * detects a global `afterEach` (e.g. via `test.globals: true`). This project
 * keeps `globals: false` and imports test functions explicitly, so without
 * this, every React-rendering test file would need to opt in to cleanup by
 * hand or leak DOM between `it()` blocks in the same file.
 *
 * Safe for non-DOM (`environment: 'node'`) test files too: `cleanup()` is a
 * no-op when nothing has been rendered via `@testing-library/react`.
 */
afterEach(() => {
  cleanup();
});
