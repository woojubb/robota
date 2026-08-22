import { formatCliUpdateNotice } from './update-check.js';

import type { ICliUpdateNotice } from './update-check.js';

/**
 * The update notice as a shell actually holds it: a promise that may be absent, resolving to a
 * notice that may be absent.
 *
 * Both absences mean "say nothing", and collapsing them here keeps the double-optional out of the
 * caller's option literal — where it read as three lines of ternary beside thirty lines of unrelated
 * wiring, and where the shape of the check was easier to misread than the thing it checked.
 */
export function resolveCliUpdateNotice(
  pending: Promise<ICliUpdateNotice | undefined> | undefined,
): Promise<string | undefined> | undefined {
  return pending?.then((notice) => (notice ? formatCliUpdateNotice(notice) : undefined));
}
