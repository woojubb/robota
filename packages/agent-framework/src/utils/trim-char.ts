/**
 * Linear edge trimming over a small character set.
 *
 * These exist instead of `replace(/[c]+$/, '')` / `replace(/^[c]+|[c]+$/g, '')`. A trailing-run regex has no start
 * anchor, so the engine retries the run from **every** offset inside it and each retry re-scans to the end: a
 * 400 KB run of the trimmed character cost ~50 s (`js/polynomial-redos`, SEC-003). An index scan is linear by
 * construction, not by an argument about how the regex engine backtracks.
 *
 * A leading-run regex (`/^[c]+/`) is not affected — the `^` anchor already limits it to one start offset — but
 * both ends are handled here so callers do not have to reason about which half was safe.
 *
 * `chars` is a **set of single characters**, matching a regex character class: `'_-'` trims both `_` and `-`.
 */

/** Remove every leading and trailing character in `chars`. Equivalent to `value.replace(/^[chars]+|[chars]+$/g, '')`. */
export function trimEdgeChars(value: string, chars: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value[start]!)) start += 1;
  while (end > start && chars.includes(value[end - 1]!)) end -= 1;
  return value.slice(start, end);
}

/** Remove every trailing character in `chars`. Equivalent to `value.replace(/[chars]+$/, '')`. */
export function trimTrailingChars(value: string, chars: string): string {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1]!)) end -= 1;
  return value.slice(0, end);
}
