import { realpathSync } from 'node:fs';
import path from 'node:path';

/** Resolve a path through filesystem aliases when the target exists. */
export function canonicalPath(target) {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}
