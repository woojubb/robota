import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

import type { IToolInvocationResult } from '../types/tool-result.js';

/**
 * Canonicalize `p` so symlinks are resolved, tolerating a path that does not exist yet.
 *
 * `realpathSync` throws on a missing path, but `Write`/`Edit` legitimately target files that have not
 * been created. So we walk up to the deepest ancestor that DOES exist, canonicalize that, and re-attach
 * the remaining segments. The re-attached tail cannot itself be a symlink — it does not exist.
 */
function canonicalize(p: string): string {
  const tail: string[] = [];
  let current = p;
  for (;;) {
    try {
      return join(realpathSync(current), ...tail);
    } catch {
      const parent = dirname(current);
      // allow-fallback: nothing along the chain exists (or is readable) — fall back to the lexical
      // path, which is still fully normalized by `resolve()` and therefore safe to compare.
      if (parent === current) return p;
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Returns a JSON-serialized IToolInvocationResult error when filePath is outside cwd.
 * Returns undefined when the path is within cwd or cwd is not set.
 *
 * SEC-006: containment is decided on the CANONICAL (symlink-resolved) paths. `path.resolve()` alone is
 * purely lexical, so `<cwd>/link/secret` where `link -> /etc` satisfied `startsWith(cwd + sep)` while
 * the subsequent `readFile`/`writeFile` followed the link out of the sandbox. Symlinks are ordinary
 * committed git content, so pointing the agent at an untrusted clone was enough to escape the guard —
 * for `Write`/`Edit` that meant creating files anywhere the process could reach. Both sides are
 * canonicalized so a cwd that is itself behind a symlink (macOS `/tmp` -> `/private/tmp`) still matches.
 */
export function checkPathWithinCwd(filePath: string, cwd: string | undefined): string | undefined {
  if (cwd === undefined) return undefined;

  const resolved = canonicalize(resolve(filePath));
  const cwdResolved = canonicalize(resolve(cwd));

  if (resolved !== cwdResolved && !resolved.startsWith(cwdResolved + sep)) {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `Access denied: "${filePath}" is outside the working directory`,
    };
    return JSON.stringify(result);
  }

  return undefined;
}
