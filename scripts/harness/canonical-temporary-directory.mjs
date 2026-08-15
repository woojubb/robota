import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

/** Return the filesystem-canonical temporary root used by harness child processes. */
export function canonicalTemporaryDirectory(directory = tmpdir()) {
  return realpathSync(directory);
}
