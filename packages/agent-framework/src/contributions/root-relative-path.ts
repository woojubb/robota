import { isRootedPath, joinPath } from '@robota-sdk/agent-core';

/** A located path stays under its root: absolute paths and `..` segments are refused. */
export function assertRootRelative(relativePath: string): void {
  if (isRootedPath(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
    throw new Error(`Not a root-relative path: ${relativePath}`);
  }
}

/**
 * Join directory entries onto a layout root. A host builds its layout roots with the separator of its
 * own platform (`.claude\skills` on Windows), and `joinPath` reads a path with no drive as POSIX, which
 * would leave such a root mixed with `/`; readers take either separator, so the root's separators are
 * normalised to `/` and what is read and what is shown as a label share one spelling.
 *
 * The names are left exactly as they are. A name read from a directory is data: on POSIX it may hold
 * `\` or look like `..\..\x`, and it must reach the reader's refusal of parent-directory segments as
 * the one literal segment it is, not be split and collapsed away first. A rooted root is passed on
 * unchanged, so it stays rooted for the same refusal.
 */
export function joinRootRelative(root: string, ...names: readonly string[]): string {
  return joinPath(isRootedPath(root) ? root : root.replaceAll('\\', '/'), ...names);
}
