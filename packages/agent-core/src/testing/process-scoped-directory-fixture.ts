/**
 * Process-scoped directories as another run left them, for tests of a host's startup sweep.
 *
 * A sweep decides by the owner record inside each directory, so a fixture that only names a
 * directory for a pid is kept by every sweep; these write the record exactly as a real run does.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readCurrentProcessIdentity } from '../utils/process-identity.js';
import { serializeProcessOwnerRecord } from '../utils/process-owner-record.js';
import {
  PROCESS_OWNER_RECORD_NAME,
  processScopedDirectoryPrefix,
} from '../utils/process-scoped-directory.js';

import type { IProcessIdentity } from '../utils/process-identity.js';

/** A pid no process has, in this boot and pid namespace: an owner that is gone. */
export function goneProcessOwner(pid = 2_147_000_000): IProcessIdentity {
  return { ...readCurrentProcessIdentity(), pid, startTime: 'gone' };
}

/**
 * Create `<parent>/<prefix><owner pid>-<suffix>` holding `owner`'s record and some conversation
 * content, creating `parent` if needed. Returns the directory.
 */
export function leaveProcessScopedDirectory(
  parent: string,
  prefix: string,
  owner: IProcessIdentity,
  suffix = 'abc123',
): string {
  const directory = join(parent, `${processScopedDirectoryPrefix(prefix, owner.pid)}${suffix}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(directory, PROCESS_OWNER_RECORD_NAME), serializeProcessOwnerRecord(owner), {
    mode: 0o600,
  });
  writeFileSync(join(directory, 'content.txt'), 'conversation content');
  return directory;
}
