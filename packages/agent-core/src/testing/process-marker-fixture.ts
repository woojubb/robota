/**
 * Process markers as another process left them, for tests of a store or a command that meets one.
 *
 * A marker is judged by the owner record inside it, so a fixture writes the record exactly as a
 * publish does; whether it stands then depends only on whether that owner is alive.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROCESS_MARKER_SUFFIX } from '../utils/process-marker.js';
import { processOwnerRecordFields } from '../utils/process-owner-record.js';

import type { IProcessIdentity } from '../interfaces/process-marker.js';

/** Leave `<directory>/<name>.owner` naming `owner`, carrying `leaseDigest` when given. Returns its path. */
export function leaveProcessMarker(
  directory: string,
  name: string,
  owner: IProcessIdentity,
  leaseDigest?: string,
): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${name}${PROCESS_MARKER_SUFFIX}`);
  const fields = processOwnerRecordFields(owner);
  writeFileSync(
    path,
    JSON.stringify(leaseDigest === undefined ? fields : { ...fields, leaseDigest }),
    { mode: 0o600 },
  );
  return path;
}
