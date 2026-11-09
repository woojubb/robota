import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalRealPath } from '../workspace-trust/canonical-real-path.js';

/**
 * A fresh temporary directory, spelled the way the host and the workspace identity spell a real path.
 * A Windows temporary directory carries an 8.3 short name (`RUNNER~1`) until it is resolved, so a
 * fixture root that is compared with either of them takes this form, not the JavaScript `realpathSync`.
 */
export function makeCanonicalTempDir(prefix: string): string {
  return canonicalRealPath(mkdtempSync(join(tmpdir(), prefix)));
}
