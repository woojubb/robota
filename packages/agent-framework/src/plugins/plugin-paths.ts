import { isAbsolute, resolve, sep } from 'node:path';

import type { IFileSystem } from '@robota-sdk/agent-core';

/**
 * SEC-018 (issue #2019's sibling, issue #2020) — plugin identifiers are PATH SEGMENTS, and they arrive
 * from a remote marketplace manifest or a registry file on disk.
 *
 * `marketplace.json`'s `name` selected the rename destination (`join(marketplacesDir, name)`), plugin
 * `name`/`version` formed installation paths, and a registry's `installPath` was passed to a recursive
 * `rmSync`. Each was cast to a TypeScript shape after only `typeof === 'object'` and `typeof name ===
 * 'string'`. A manifest named `../../escaped-market` therefore placed a marketplace outside its root,
 * and a tampered `installPath` deleted whatever it pointed at.
 *
 * This module is the boundary. It follows the shape SEC-006 established in
 * `packages/agent-session/src/session-id.ts`, for the reasons that file gives:
 *
 *   - **The guard lives at the boundary, not at each `join()`.** One value reaches several sinks — the
 *     rename, the copy, the loader and the recursive delete are four separate sinks on one name.
 *   - **REJECT rather than sanitize.** Rewriting `../x` to `__x` would alias two distinct identifiers
 *     onto one directory, quietly cross-linking plugins. A malformed identifier is a bug or an attack;
 *     both should be loud.
 *
 * What this file adds beyond SEC-006: session ids are single components by construction, so a segment
 * check was sufficient there. Here a value can also be a relative PATH (a local marketplace source, a
 * persisted install location), and a symlink inside an otherwise-valid root can redirect a mutation
 * outside it. So containment is checked against the CANONICAL form of both sides, not the lexical one.
 */

/**
 * A single, safe path component.
 *
 * Admits no `/`, no `\` and no `:`, so the value can introduce neither a path separator nor a Windows
 * drive or UNC qualifier; and because it must begin with an alphanumeric it can be neither `.` nor
 * `..`. With no separator available, an embedded `..` cannot form a traversal component. A NUL cannot
 * appear because the class is an explicit allowlist rather than a denylist of dangerous characters —
 * which is also why percent-encoded traversal (`%2e%2e%2f`) is rejected: `%` is simply not admitted.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Bounded well under every filesystem's per-component limit (255 bytes). */
const MAX_SEGMENT_LENGTH = 128;

/** Whether `value` is safe to interpolate into a filesystem path as a single component. */
export function isSafePluginSegment(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SEGMENT_LENGTH &&
    SAFE_SEGMENT.test(value)
  );
}

/**
 * Throw unless `value` is safe as a single path component.
 *
 * `field` names the source so the error says WHICH untrusted field was malformed — a manifest name and
 * a registry install location fail the same test and need different investigations.
 */
export function assertSafePluginSegment(value: unknown, field: string): asserts value is string {
  if (!isSafePluginSegment(value)) {
    throw new Error(
      `Invalid plugin ${field}: ${JSON.stringify(value)}. It is used as a filesystem path component, ` +
        `so it must be 1-${MAX_SEGMENT_LENGTH} characters of letters, digits, dot, underscore or ` +
        'hyphen, starting with a letter or digit.',
    );
  }
}

/**
 * The canonical form of `path`, resolving symlinks as far as the path exists.
 *
 * A destination that does not exist yet — the target of a rename or a clone — has no realpath, so the
 * nearest existing ancestor is canonicalised and the remaining components appended. That is what makes
 * the check meaningful BEFORE the mutation: canonicalising only existing paths would leave every
 * create-then-check window open, and checking after the write is checking after the damage.
 */
function canonicalize(path: string, fs: IFileSystem): string {
  let current = resolve(path);
  const trailing: string[] = [];
  // Bounded by the component count; `resolve` guarantees we reach the root.
  for (;;) {
    if (fs.existsSync(current)) return resolve(fs.realpathSync(current), ...trailing.reverse());
    const parent = resolve(current, '..');
    if (parent === current) return resolve(path);
    trailing.push(current.slice(parent.length + 1));
    current = parent;
  }
}

/**
 * Throw unless `candidate` is `root` itself or a descendant of it, comparing CANONICAL forms.
 *
 * Lexical containment is not enough: `<root>/link` may be a symlink to `/etc`, and
 * `resolve(root, 'link')` still starts with `root`. Both sides are canonicalised so a symlink cannot
 * redirect a copy, load, rename or recursive delete outside the tree it appears to be inside.
 *
 * The separator is appended before the prefix comparison so that `/a/plugins-evil` is not accepted as
 * a descendant of `/a/plugins`.
 */
export function assertContainedPath(
  root: string,
  candidate: string,
  what: string,
  fs: IFileSystem,
): void {
  const canonicalRoot = canonicalize(root, fs);
  const canonicalCandidate = canonicalize(candidate, fs);
  const contained =
    canonicalCandidate === canonicalRoot ||
    canonicalCandidate.startsWith(
      canonicalRoot.endsWith(sep) ? canonicalRoot : canonicalRoot + sep,
    );
  if (!contained) {
    throw new Error(
      `Refusing to ${what} outside the plugin root: ${JSON.stringify(candidate)} resolves to ` +
        `${JSON.stringify(canonicalCandidate)}, which is not inside ${JSON.stringify(canonicalRoot)}.`,
    );
  }
}

/**
 * Resolve an untrusted RELATIVE source against `root` and prove containment.
 *
 * An absolute path is refused outright rather than resolved: a marketplace source that names `/etc` is
 * not a containment question, it is a different kind of value than the field is for.
 */
export function resolveContainedRelative(
  root: string,
  relative: string,
  what: string,
  fs: IFileSystem,
): string {
  if (isAbsolute(relative)) {
    throw new Error(
      `Refusing to ${what} from an absolute path: ${JSON.stringify(relative)}. This field takes a ` +
        'path relative to the plugin root.',
    );
  }
  const candidate = resolve(root, relative);
  assertContainedPath(root, candidate, what, fs);
  return candidate;
}
