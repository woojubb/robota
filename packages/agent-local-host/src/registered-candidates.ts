import { lstatSync, readdirSync } from 'node:fs';

import {
  SUPERVISED_ID_PATTERN, probeRegisteredPid, readRegisteredProcessStartTime,
  readRegistration, sessionDirectory, verifyExistingDirectory,
} from './supervised-control-carrier.js';

import type { IWorkspaceDaemonCandidate } from './workspace-daemon-proof.js';

export interface IRegisteredCandidate extends IWorkspaceDaemonCandidate {
  readonly problem?: 'invalid-registration';
}

/** Public registration metadata is untrusted; an unprobed row still requires authenticated proof. */
export async function listRegisteredCandidates(root: string, signal?: AbortSignal): Promise<readonly IRegisteredCandidate[]> {
  signal?.throwIfAborted();
  try { verifyExistingDirectory(root); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const ids = readdirSync(root).filter((name) => SUPERVISED_ID_PATTERN.test(name));
  if (ids.length > 256) throw new Error('Too many supervised session records to list safely.');
  const rows: IRegisteredCandidate[] = [];
  for (const id of ids.sort((a, b) => a.localeCompare(b))) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    signal?.throwIfAborted();
    const directory = sessionDirectory(root, id);
    let record: ReturnType<typeof readRegistration>;
    try { record = readRegistration(directory, id); }
    catch {
      try { lstatSync(directory); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; }
      rows.push({ id, liveness: 'unknown', control: 'unavailable', activity: 'unknown', problem: 'invalid-registration' });
      continue;
    }
    const started = readRegisteredProcessStartTime(record.pid);
    const liveness = started === undefined
      ? probeRegisteredPid(record.pid) === 'absent' ? 'dead' : 'unknown'
      : started === record.startedAt ? 'alive' : 'dead';
    rows.push(liveness === 'alive' && record.generation !== undefined
      ? { id, liveness, generation: record.generation, control: 'unprobed', activity: 'unknown' }
      : { id, liveness, control: 'unavailable', activity: 'unknown' });
  }
  signal?.throwIfAborted();
  return rows;
}
