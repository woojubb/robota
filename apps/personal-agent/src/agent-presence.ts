/** Keep a second agent from recovering work that another live agent still owns. */
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  ownerHasExited,
  removeDirectoryGuard,
  tryDirectoryLock,
} from './connectors/directory-lock.js';

const OWNER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.live$/u;

export function createAgentPresence(stateDir: string) {
  const root = join(realpathSync(stateDir), '.agent-presence');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const name = `${randomUUID()}.live`;
  const path = join(root, name);
  let active: { release(): void } | undefined;
  const stoppedPath = (id: string): string => join(root, `${id}.stopped`);
  const isStopped = (id: string): boolean => {
    try {
      return statSync(stoppedPath(id)).isDirectory();
    } catch {
      return false;
    }
  };
  const markExited = (id: string): boolean => {
    if (isStopped(id)) return true;
    const other = join(root, id);
    if (!ownerHasExited(other)) return false;
    try {
      renameSync(other, stoppedPath(id));
      return true;
    } catch {
      return isStopped(id);
    }
  };
  const others = (): boolean => {
    try {
      for (const entry of readdirSync(root)) {
        if (entry === name || !entry.endsWith('.live')) continue;
        if (!markExited(entry)) return true;
      }
      return false;
    } catch {
      // An unobservable agent may still own a prompt.
      return true;
    }
  };
  const locked = async <T>(work: () => Promise<T>): Promise<T> => {
    const startupPath = join(root, 'startup.lock');
    let startup: { release(): void } | undefined;
    for (let attempt = 0; attempt <= 100; attempt += 1) {
      startup = tryDirectoryLock(startupPath);
      if (startup !== undefined) break;
      if (attempt === 100)
        throw new Error('Agent startup is busy; recover the state folder offline');
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    if (startup === undefined) throw new Error('Agent startup cannot be locked');
    try {
      return await work();
    } finally {
      startup.release();
    }
  };
  return {
    id: name,
    ownerExited(ownerId: string): boolean {
      if (!OWNER_ID.test(ownerId) || ownerId === name) return false;
      return markExited(ownerId);
    },
    stoppedOwners(): string[] {
      try {
        return readdirSync(root)
          .filter((entry) => entry.endsWith('.stopped'))
          .map((entry) => entry.slice(0, -8))
          .filter((entry) => OWNER_ID.test(entry));
      } catch {
        return [];
      }
    },
    forgetStopped(ownerId: string): void {
      if (!OWNER_ID.test(ownerId)) return;
      removeDirectoryGuard(stoppedPath(ownerId));
      if (process.platform !== 'win32') {
        const fd = openSync(root, 'r');
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
    },
    others,
    async enter(recover: () => Promise<unknown>): Promise<void> {
      if (active !== undefined) throw new Error('The agent is already attached');
      await locked(async () => {
        active = tryDirectoryLock(path);
        if (active === undefined) throw new Error('The agent presence cannot be recorded');
        try {
          if (!others()) await recover();
        } catch (error) {
          active.release();
          active = undefined;
          throw error;
        }
      });
    },
    async whenAlone(work: () => Promise<void>): Promise<boolean> {
      return locked(async () => {
        if (others()) return false;
        await work();
        return true;
      });
    },
    close(retainEvidence = false): void {
      if (active === undefined) return;
      if (retainEvidence) {
        renameSync(path, stoppedPath(name));
        active = undefined;
        if (process.platform !== 'win32') {
          const fd = openSync(root, 'r');
          try {
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
        }
      } else {
        active.release();
        active = undefined;
      }
    },
  };
}
