import { realpathSync } from 'node:fs';
import path from 'node:path';

/** Compare an invoked script with its module filename through filesystem aliases. */
export function isEntryPoint(meta, argv = process.argv) {
  if (argv[1] === undefined) return false;
  try {
    return realpathSync(argv[1]) === realpathSync(meta.filename);
  } catch {
    return path.resolve(argv[1]) === path.resolve(meta.filename);
  }
}
