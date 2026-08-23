import { readdirSync, realpathSync, symlinkSync } from 'node:fs';
import path from 'node:path';

import { makeTemp } from '../make-temp.mjs';

/**
 * A PATH in which the named tools genuinely do not exist.
 *
 * A shim that merely FAILS is a different scenario — the hooks branch on `command -v`, so a
 * present-but-broken tool exercises a path a tool-less host never takes. The farm therefore
 * symlinks every executable the real PATH offers except the hidden ones, which is the only way to
 * ask "what does this hook do on a host without jq" and get the host's answer.
 *
 * It is a module because two test files need the same farm and the question it answers — "do the
 * two arms of a reader agree" — is the subject of INFRA-081. A second copy of the thing that
 * decides which arm runs, in the PR whose subject is "one rule rather than one per installed tool",
 * would be the defect wearing the fix as a costume.
 */
export function pathWithout(hidden) {
  const dir = realpathSync(makeTemp('path-without-'));
  const seen = new Set();
  for (const entry of (process.env.PATH ?? '').split(':')) {
    if (!entry) continue;
    let names;
    try {
      names = readdirSync(entry);
    } catch {
      continue;
    }
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (hidden.includes(name)) continue;
      try {
        symlinkSync(path.join(entry, name), path.join(dir, name));
      } catch {
        // A duplicate or an unreadable entry is not the subject of any case here.
      }
    }
  }
  return dir;
}
