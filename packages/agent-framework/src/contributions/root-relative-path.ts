import { isAbsolute } from 'node:path';

/** A located path stays under its root: absolute paths and `..` segments are refused. */
export function assertRootRelative(relativePath: string): void {
  if (isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
    throw new Error(`Not a root-relative path: ${relativePath}`);
  }
}
