/**
 * Remove every trailing `/`, by index scan.
 *
 * Not `replace(/\/+$/, '')`: that run has no start anchor, so the engine retries it from every offset inside the
 * run and each retry re-scans to the end — 3.0 s on a 100 K run (`js/polynomial-redos`, SEC-003). The base URLs
 * this normalises are public constructor parameters, so their length is the caller's choice.
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}
