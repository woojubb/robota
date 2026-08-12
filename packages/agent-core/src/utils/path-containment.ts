/**
 * SEC-006 — the SSOT for "is this path inside that root?" when the answer is a SECURITY decision.
 *
 * `path.resolve` and `path.normalize` are purely lexical: they collapse `.` and `..` textually but do
 * not consult the filesystem, so they cannot see a symlink. A link sitting INSIDE the root and
 * pointing outside it therefore satisfies a `startsWith(root + sep)` check while the syscall that
 * follows — `open`, `readFile`, `writeFile` — follows the link straight out of the boundary.
 *
 * Symlinks are ordinary committed git content and ordinary build-output artifacts, so this is not a
 * theoretical hole: it was exploitable in both the file-tool sandbox and the CLI's monitor asset
 * server. Both now decide containment here, because two containment checks that can disagree are
 * their own defect.
 *
 * Every security-boundary containment check in the repo routes through here — the `agent-*` family
 * and the `dag-*` family alike. The dag side is not a cross-family exception: `dag-framework` already
 * declares `@robota-sdk/agent-core` in its runtime `dependencies`, so agent-core is in `dag-cli`'s
 * closure regardless, and a direct edge only makes that explicit.
 */
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

/**
 * Validate an authority root more strictly than candidate-path canonicalization.
 *
 * Candidate write paths may have a missing tail, but an authority root must already exist and be a
 * traversable directory. Keeping the contracts separate prevents a typo in a root from degrading to
 * a lexical boundary that the caller did not actually select.
 */
export function resolveTrustedExecutionRoot(input: unknown): string {
  if (typeof input !== 'string') {
    throw new TypeError('executionRoot must be a string');
  }
  if (input.trim().length === 0) {
    throw new TypeError('executionRoot must be a non-empty string');
  }
  if (!isAbsolute(input)) {
    throw new TypeError('executionRoot must be an absolute path');
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(input);
  } catch {
    throw new TypeError('executionRoot must name an existing accessible directory');
  }
  if (!statSync(canonicalRoot).isDirectory()) {
    throw new TypeError('executionRoot must name a directory');
  }
  try {
    accessSync(canonicalRoot, constants.R_OK | constants.X_OK);
  } catch {
    throw new TypeError('executionRoot directory must be readable and traversable');
  }
  return canonicalRoot;
}

/**
 * Resolve `p` to its canonical form, following symlinks, tolerating a path that does not exist yet.
 *
 * `realpathSync` throws on a missing path, but callers legitimately ask about files they are about to
 * CREATE (a write or an edit). So we walk up to the deepest ancestor that does exist, canonicalize
 * that, and re-attach the remaining segments — the re-attached tail cannot itself be a symlink,
 * because it does not exist.
 */
export function canonicalizePath(p: string): string {
  const tail: string[] = [];
  let current = resolve(p);
  for (;;) {
    try {
      return join(realpathSync(current), ...tail);
    } catch {
      const parent = dirname(current);
      // allow-fallback: nothing along the chain exists or is readable — fall back to the lexical
      // path, which `resolve()` has already fully normalized and which is therefore safe to compare.
      if (parent === current) return resolve(p);
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Whether `candidate` is `root` itself or lies beneath it, decided on the CANONICAL form of both.
 *
 * Canonicalizing the root as well as the candidate matters: a root that is itself reached through a
 * symlink (macOS `/tmp` -> `/private/tmp`, or a workspace under a symlinked home) would otherwise
 * spuriously reject every path inside it.
 */
export function isPathInside(root: string, candidate: string): boolean {
  const canonicalRoot = canonicalizePath(root);
  const canonicalCandidate = canonicalizePath(candidate);
  return canonicalCandidate === canonicalRoot || canonicalCandidate.startsWith(canonicalRoot + sep);
}
