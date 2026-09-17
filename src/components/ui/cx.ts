/**
 * Joins CSS-Module class names. `styles.btn` is always a string; the variants
 * are conditional. One file so that fourteen components do not each grow their
 * own copy — and not a dependency, because R1 forbids one for twelve characters.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
