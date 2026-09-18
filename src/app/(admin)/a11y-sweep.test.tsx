/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { focusableIn, unnamedControls } from '@/test/a11y';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/app/(admin)/shell/actions', () => ({
  loadShellCounts: async () => ({ openDecisions: 0, rosterSize: 0, understaffedTasks: 0 }),
}));
/** The rail is an async Server Component reaching the database; the shell's
 *  keyboard path is what this file is about, not the rail's contents. */
vi.mock('@/app/(admin)/shell/sidebar', () => ({ Sidebar: () => <nav aria-label="ראשי" /> }));

import AdminLayout from './layout';

const SRC = resolve(process.cwd(), 'src');
const rel = (path: string) => relative(process.cwd(), path);

function filesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(path, found);
    else found.push(path);
  }
  return found;
}

/**
 * E4, the part that is behaviour rather than a linter: the first Tab on every
 * screen reaches the content instead of walking fifteen rail links.
 */
describe('E4: the keyboard reaches the content in one press', () => {
  function shell() {
    /* The children carry the `<main>`: every page in this section renders its
       own, and the layout deliberately does not add a second landmark. */
    return render(<AdminLayout><main>תוכן</main></AdminLayout>);
  }

  it('puts a way past the rail first, before anything else can take focus', () => {
    const { container } = shell();
    const first = focusableIn(container)[0];
    expect(first.getAttribute('href')).toBe('#main');
    expect(first.textContent).toBe('דילוג לתוכן');
  });

  /**
   * A skip link pointing at a `<main>` that cannot take focus moves the
   * viewport and leaves the caret where it was, so the next Tab carries on
   * through the rail — which is the failure the link exists to prevent, made
   * invisible by the page appearing to scroll correctly.
   */
  it('gives the skip link somewhere to land', () => {
    const { container } = shell();
    const main = container.querySelector('#main');
    expect(main).toBeTruthy();
    expect(main?.getAttribute('tabindex')).toBe('-1');
  });

  it('keeps the main landmark, so it is reachable by landmark too', () => {
    shell();
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('leaves no anonymous control in the shell itself', () => {
    const { container } = shell();
    expect(unnamedControls(container).map((el) => el.outerHTML)).toEqual([]);
  });
});

/**
 * The two static halves of E4. Both are about a decision that looks local and
 * is not: a positive `tabIndex` reorders the whole page, and a removed focus
 * ring makes the keyboard path invisible on every screen it appears on.
 */
describe('E4: the rules that are netted rather than remembered', () => {
  it('leaves tab order to the DOM', () => {
    const offenders = filesUnder(SRC)
      .filter((path) => /\.tsx$/.test(path) && !/\.test\.tsx$/.test(path))
      .filter((path) => /tabIndex=\{[1-9]/.test(readFileSync(path, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  /**
   * A9: the focus ring is never removed, anywhere, for any control. Five
   * separate briefs in this redesign carried `outline: none` in their sample
   * CSS, and every one of them looked reasonable in the file it was in.
   */
  it('never removes a focus ring', () => {
    const offenders: string[] = [];
    for (const file of filesUnder(SRC).filter((path) => /\.css$/.test(path))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (/outline:\s*(none|0)\b/.test(line)) offenders.push(`${rel(file)}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('draws one in the foundation, so every control inherits it', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    const rule = css.slice(css.indexOf(':focus-visible {'));
    expect(rule).toContain('outline: 2px solid var(--focus)');
  });

  /**
   * Both nets above walk the filesystem, and a walk that found nothing passes
   * exactly like a repo with nothing to find.
   */
  it('is actually walking the source tree', () => {
    const files = filesUnder(SRC);
    expect(files.filter((path) => /\.tsx$/.test(path)).length).toBeGreaterThan(80);
    expect(files.filter((path) => /\.css$/.test(path)).length).toBeGreaterThan(15);
  });
});
