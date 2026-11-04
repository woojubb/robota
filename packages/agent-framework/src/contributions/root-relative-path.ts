import { isRootedPath, joinPath } from '@robota-sdk/agent-core';

/** A located path stays under its root: absolute paths and `..` segments are refused. */
export function assertRootRelative(relativePath: string): void {
  if (isRootedPath(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
    throw new Error(`Not a root-relative path: ${relativePath}`);
  }
}

/**
 * Join root-relative segments with `/`, reading `\` as a separator too. A host builds its layout roots
 * with the separator of its own platform (`.claude\skills` on Windows), and `joinPath` reads a path
 * with no drive as POSIX, which would leave such a root mixed with `/`. Readers of a root-relative
 * path take either separator, so what is read and what is shown as a label share one spelling.
 */
export function joinRootRelative(...segments: readonly string[]): string {
  return joinPath(...segments.flatMap((segment) => segment.split(/[\\/]+/)));
}
