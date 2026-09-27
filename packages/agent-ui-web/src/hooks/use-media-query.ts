import { useEffect, useState } from 'react';

/**
 * Tracks whether `query` currently matches, reactively (#3289 §2 — the narrow-window session sheet
 * below `md`). A host without `window.matchMedia` (an older embedding, or a non-browser test) reports
 * `false` and never subscribes, rather than throwing.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(query);
    const onChange = (): void => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `md` breakpoint (768px) — below it, the session list is a sheet rather than a column. */
export const NARROW_WINDOW_QUERY = '(max-width: 767.98px)';
