/**
 * "The tree I govern is missing" is an ERROR, never a pass (HARNESS-052).
 *
 * The defect this exists to end, measured across the harness: a finder opens its governed directory,
 * finds it absent, and returns `[]` — which every caller reads as "clean". 30 of the 50 registered
 * finders behaved that way when handed a root without their subject, including the three guarding
 * `.github/workflows`, the directory at the centre of half the incidents that started this item.
 * A guard that reports success over ground it never covered is the exact shape it was written to
 * catch, one level up.
 *
 * WHY A SHARED HELPER rather than 30 bespoke `if (!existsSync(...)) throw` lines. The message is the
 * product here: whoever hits this needs to know WHICH tree was missing, which root was searched, and
 * why its absence is not "nothing to check". One implementation keeps those three facts in every
 * message, and makes the rule greppable — `requireGovernedTree` is the answer to "which scans have
 * been through the HARNESS-052 sweep".
 *
 * WHAT IT DOES NOT DO. It says nothing about whether a scan's rules are correct when the tree IS
 * present, and it must not be added to a finder that is a pure ENUMERATOR whose empty result is an
 * honest answer its caller renders a verdict on (`findVitestConfigs`, `findTransportNames`). Forcing
 * those to throw would certify a fail-closed property they neither have nor need — see the ledger in
 * `scan-guard-scope-fail-closed.mjs`, which records each measurement rather than assuming one.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Throw unless every governed path exists under `root`.
 *
 * @param {string} root         Workspace root the scan was pointed at.
 * @param {string|string[]} relPaths  Workspace-relative path(s) the scan cannot judge without.
 * @param {{scan: string, why: string}} context  Scan name, and why absence is not emptiness.
 */
export function requireGovernedTree(root, relPaths, { scan, why }) {
  const required = Array.isArray(relPaths) ? relPaths : [relPaths];
  if (required.length === 0) {
    throw new Error(
      `${scan}: requireGovernedTree was called with no paths. A fail-closed check over an empty ` +
        'requirement list is the vacuity it exists to prevent.',
    );
  }
  const missing = required.filter((rel) => !existsSync(path.join(root, rel)));
  if (missing.length === 0) return;
  throw new Error(
    `${scan}: ${missing.join(', ')} missing from ${root}. ${why} Reporting "no findings" here would ` +
      'mean "nothing was examined", which is not the claim this scan makes (HARNESS-052).',
  );
}
