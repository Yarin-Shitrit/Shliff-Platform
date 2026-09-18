'use client';
/**
 * Client component: the search box holds what is being typed and writes it to
 * the URL on a 250ms debounce, so eight keystrokes leave one history entry
 * rather than eight (Ruling 2). Everything else in the bar is a link, per
 * Ruling 1 — every filter is a URL, and every chip is a link.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { Popover } from './popover';
import { cx } from './cx';
import styles from './filter-bar.module.css';

export type FilterOption = { id: string; label: string; href: string; current?: boolean };

export type FilterChip = {
  id: string;
  /** `שנה` */
  label: string;
  /** `ברן 26` — always shown, per C3: a chip carries its value. */
  value: string;
  /** The same list without this filter. Absent for a filter that cannot be removed. */
  clearHref?: string;
  /** The values this filter can take. Absent means the chip is a label only. */
  options?: readonly FilterOption[];
};

export type ColumnToggle = { id: string; label: string; href: string; shown: boolean };

export type FilterBarProps = {
  /** The search param this bar writes. Default 'q'. */
  searchParam?: string;
  searchValue: string;
  /** The box's accessible name, e.g. `חיפוש אנשים`. */
  searchLabel: string;
  searchPlaceholder: string;
  chips: readonly FilterChip[];
  addFilter?: { options: readonly FilterOption[] };
  sort?: { value: string; options: readonly FilterOption[] };
  columns?: readonly ColumnToggle[];
  /** Counted on the server over the whole filtered set, never `rows.length`. */
  rowCount: number;
};

const DEBOUNCE_MS = 250;

export function FilterBar({
  searchParam = 'q', searchValue, searchLabel, searchPlaceholder,
  chips, addFilter, sort, columns, rowCount,
}: FilterBarProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [typed, setTyped] = useState(searchValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  function onType(next: string) {
    setTyped(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const search = new URLSearchParams();
      for (const [key, value] of params) if (key !== searchParam) search.append(key, value);
      if (next !== '') search.set(searchParam, next);
      const query = search.toString();
      router.replace(query === '' ? pathname : `${pathname}?${query}`);
    }, DEBOUNCE_MS);
  }

  return (
    <div className={styles.bar}>
      <span className={styles.search}>
        <Icon name="search" size={15} />
        <input
          className={styles.searchInput}
          type="search"
          aria-label={searchLabel}
          placeholder={searchPlaceholder}
          value={typed}
          onChange={(event) => { onType(event.target.value); }}
        />
      </span>

      {chips.map((chip) => {
        const face = (
          <>
            {chip.label}: <b className={styles.chipValue}>{chip.value}</b>
          </>
        );
        return (
          <span className={styles.chipGroup} key={chip.id}>
            {chip.options === undefined ? (
              <span className={cx(styles.chip, styles.chipOn)}>{face}</span>
            ) : (
              // No `role="menu"`/`"menuitem"` on these options — they are
              // links that navigate, exactly the case `season-switch.tsx`
              // already ruled on. See `popover.tsx`'s docblock.
              <Popover id={`filter-${chip.id}`} label={`${chip.label}: ${chip.value}`} triggerContent={face}>
                {chip.options.map((option) => (
                  <Link key={option.id} className={styles.menuItem} href={option.href}>
                    {option.label}
                  </Link>
                ))}
              </Popover>
            )}
            {chip.clearHref === undefined ? null : (
              <Link
                className={styles.clear}
                href={chip.clearHref}
                aria-label={`הסרת הסינון ${chip.label}`}
              >
                <Icon name="x" size={14} />
              </Link>
            )}
          </span>
        );
      })}

      {addFilter === undefined ? null : (
        <Popover
          id="add-filter"
          label="סינון"
          triggerTone="chip-dashed"
          triggerContent={<><Icon name="plus" size={14} /> סינון</>}
        >
          {addFilter.options.map((option) => (
            <Link key={option.id} className={styles.menuItem} href={option.href}>
              {option.label}
            </Link>
          ))}
        </Popover>
      )}

      {sort === undefined ? null : (
        <Popover
          id="sort"
          label={`מיון: ${sort.value}`}
          triggerContent={<><Icon name="sort" size={14} /> מיון: <b className={styles.chipValue}>{sort.value}</b></>}
        >
          {sort.options.map((option) => (
            <Link key={option.id} className={styles.menuItem} href={option.href}>
              {option.label}
            </Link>
          ))}
        </Popover>
      )}

      {columns === undefined ? null : (
        <Popover
          id="columns"
          label="עמודות"
          triggerTone="ghost"
          align="end"
          triggerContent={<Icon name="columns" size={15} />}
        >
          {columns.map((column) => (
            <Link key={column.id} className={styles.menuItem} href={column.href}>
              {column.shown ? <Icon name="check" size={14} /> : <span className={styles.checkGap} />}
              {column.label}
            </Link>
          ))}
        </Popover>
      )}

      {/* The count and the word share one `<bdi>` isolate — the row count and
          its unit read as one phrase, the same reasoning MDN gives for
          isolating "N bottles of beer" rather than the digits alone. */}
      <span className={styles.count}><bdi>{rowCount} שורות</bdi></span>
    </div>
  );
}
