import { isRootedPath } from '@robota-sdk/agent-core';

/** A located path stays under its root: absolute paths and `..` segments are refused. */
export function assertRootRelative(relativePath: string): void {
  if (isRootedPath(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
    throw new Error(`Not a root-relative path: ${relativePath}`);
  }
}
