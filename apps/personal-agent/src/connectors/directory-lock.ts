import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { ConnectorRefusedError } from '@robota-sdk/agent-product/personal';

interface IOwner {
  readonly host: string;
  readonly pid: number;
  readonly token: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function hostIdentity(): string {
  try {
    const token =
      process.platform === 'linux'
        ? readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim().toLowerCase()
        : process.platform === 'darwin'
          ? execFileSync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], { encoding: 'utf8' })
              .trim()
              .toLowerCase()
          : '';
    if (!UUID.test(token)) throw new Error('invalid host identity');
    const namespace = process.platform === 'linux' ? readlinkSync('/proc/self/ns/pid') : '';
    return `${process.platform}:${namespace}:${token}`;
  } catch {
    // A different identity prevents unsafe automatic recovery if the local identity is unavailable.
    return `${process.platform}:${randomUUID()}`;
  }
}

const HOST = hostIdentity();

function ownerOf(path: string): IOwner | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const owner = value as { host?: unknown; pid?: unknown; token?: unknown };
    if (
      typeof owner.host !== 'string' ||
      typeof owner.pid !== 'number' ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      typeof owner.token !== 'string' ||
      !UUID.test(owner.token)
    )
      return undefined;
    return { host: owner.host, pid: owner.pid, token: owner.token };
  } catch {
    return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** True only when this PID namespace can prove that the guard's owner has exited. */
export function ownerHasExited(path: string): boolean {
  const owner = ownerOf(path);
  return owner !== undefined && owner.host === HOST && !isAlive(owner.pid);
}

function removeOwned(path: string, token: string): void {
  if (ownerOf(path)?.token !== token) throw new ConnectorRefusedError('The settings lock changed');
  const retired = `${path}.${randomUUID()}.retired`;
  renameSync(path, retired);
  try {
    rmSync(join(retired, 'owner.json'), { force: true });
    rmdirSync(retired);
  } catch {
    // The fixed lock path is already released; preserve unexpected retired contents.
  }
}

/** Remove an owned marker after its operation has completed or its owner has been proved dead. */
export function removeDirectoryGuard(path: string): void {
  const owner = ownerOf(path);
  if (owner === undefined) throw new ConnectorRefusedError('The settings marker cannot be read');
  removeOwned(path, owner.token);
}

function acquireFresh(path: string): { release(): void } | undefined {
  const owner: IOwner = { host: HOST, pid: process.pid, token: randomUUID() };
  const candidate = `${path}.${owner.token}.candidate`;
  try {
    mkdirSync(candidate, { mode: 0o700 });
    writeFileSync(join(candidate, 'owner.json'), `${JSON.stringify(owner)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    // The destination is always non-empty, so rename cannot replace an existing guard.
    renameSync(candidate, path);
  } catch (error) {
    try {
      rmSync(join(candidate, 'owner.json'), { force: true });
      rmdirSync(candidate);
    } catch {
      /* Preserve unexpected candidate contents. */
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ENOTEMPTY') return undefined;
    throw new ConnectorRefusedError('The settings lock cannot be created');
  }
  return { release: () => removeOwned(path, owner.token) };
}

/** Acquire an atomic directory guard. Stale guards on another host are never stolen. */
export function tryDirectoryLock(path: string): { release(): void } | undefined {
  const guard = acquireFresh(path);
  if (guard !== undefined || !ownerHasExited(path)) return guard;
  try {
    const owner = ownerOf(path);
    if (owner !== undefined && owner.host === HOST && !isAlive(owner.pid)) {
      // Keep the non-empty tombstone: a second delayed recovery for this owner cannot replace it
      // with a new live guard after the fixed path is acquired again.
      renameSync(path, `${path}.${owner.token}.stale`);
    }
  } catch {
    // A competing recovery or an unprovable owner leaves the guard closed.
  }
  return undefined;
}
